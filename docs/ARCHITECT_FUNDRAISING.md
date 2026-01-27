# Fundraising Module Architectuur (Laag 7 - Decorator)

**Auteur:** Antigravity (Senior Backend Architect)
**Datum:** 19-01-2026
**Status:** Draft

Dit document beschrijft de architectuur voor de **Fundraising Module**. Deze module fungeert als een **decorator** bovenop de core registratie- en ticketflows. Het doel is om deelnemers in staat te stellen geld in te zamelen voor goede doelen via een externe partner (bv. Supporta), zonder dat de core logica van het platform vervuild raakt.

---

## 1. Fundraising Architectuuroverzicht

De fundraising module is strikt gescheiden van de core. We volgen het **"Sidecar Pattern"**: de fundraising tabellen "hangen" aan de core tabellen, maar de core tabellen weten niets van fundraising.

### Kernprincipes

1.  **Non-blocking:** Als de fundraising module faalt of de externe partner down is, moet de verkoop van tickets gewoon doorgaan.
2.  **Decorator:** We voegen functionaliteit toe aan `events`, `ticket_types` en `registrations` via aparte tabellen met foreign keys naar de core.
3.  **Source of Truth:** De database bevat de configuratie (welke doelen, verplicht/optioneel) en de status van de koppeling (actiepagina URL). Het daadwerkelijke geld en de donaties leven bij de externe partner.
4.  **Asynchroon:** Het aanmaken van actiepaginas gebeurt via een background job (Edge Function) getriggerd door een database event of webhook.

---

## 2. Datamodel (DDL)

We introduceren een nieuw schema of prefix (hier `fundraising_`) om de scheiding duidelijk te maken.

### 2.1 Configuratie (Event & Ticket niveau)

```sql
-- Global of Org-level goede doelen (master list)
create table public.fundraising_charities (
    id uuid not null default gen_random_uuid(),
    org_id uuid not null, -- Charity behoort tot een organisatie (of is globaal als null)
    name text not null,
    external_id text not null, -- ID bij externe partner (Supporta)
    description text,
    logo_url text,
    
    constraint fundraising_charities_pkey primary key (id),
    constraint fundraising_charities_org_fkey foreign key (org_id) references public.orgs(id)
);

-- Event-level configuratie
create type fundraising_mode as enum ('disabled', 'optional', 'required');

create table public.fundraising_event_settings (
    event_id uuid not null, -- 1-op-1 met core.events
    mode fundraising_mode not null default 'disabled',
    
    -- Timing & Gedrag
    create_page_timing text not null default 'post_registration', -- 'during_registration', 'post_registration'
    allow_charity_selection boolean not null default true, -- Mag deelnemer kiezen?
    
    -- Metadata
    title text, -- Titel voor fundraising blok
    description text,
    
    constraint fundraising_event_settings_pkey primary key (event_id),
    constraint fundraising_event_settings_event_fkey foreign key (event_id) references public.events(id) on delete cascade
);

-- Welke charities zijn beschikbaar voor dit event?
create table public.fundraising_event_charities (
    event_id uuid not null,
    charity_id uuid not null,
    is_default boolean not null default false,
    is_exclusive boolean not null default false, -- Als true: alleen deze mag gekozen worden
    
    constraint fundraising_event_charities_pkey primary key (event_id, charity_id),
    constraint fundraising_event_charities_event_fkey foreign key (event_id) references public.events(id) on delete cascade,
    constraint fundraising_event_charities_charity_fkey foreign key (charity_id) references public.fundraising_charities(id)
);

-- Ticket-level overrides (Specifieke tickets kunnen fundraising verplichten)
create table public.fundraising_ticket_overrides (
    ticket_type_id uuid not null, -- 1-op-1 met core.ticket_types
    mode fundraising_mode not null default 'required', -- Vaak 'required' bij override
    
    -- Als dit ticket gekozen wordt, is dit specifieke doel verplicht?
    forced_charity_id uuid, 
    
    constraint fundraising_ticket_overrides_pkey primary key (ticket_type_id),
    constraint fundraising_ticket_overrides_ticket_fkey foreign key (ticket_type_id) references public.ticket_types(id) on delete cascade,
    constraint fundraising_ticket_overrides_charity_fkey foreign key (forced_charity_id) references public.fundraising_charities(id)
);
```

### 2.2 Operationeel (Deelnemer status)

```sql
-- De link tussen een registratie en de externe fundraising wereld
create table public.fundraising_participations (
    id uuid not null default gen_random_uuid(),
    registration_id uuid not null, -- 1-op-1 met core.registrations
    charity_id uuid not null, -- Het gekozen doel
    
    -- Status
    external_page_id text, -- ID van pagina bij Supporta
    external_page_url text, -- URL naar actiepagina
    status text not null default 'pending', -- 'pending', 'active', 'closed'
    
    -- Cache voor display (niet source of truth!)
    total_raised_cents bigint default 0,
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint fundraising_participations_pkey primary key (id),
    constraint fundraising_participations_reg_fkey foreign key (registration_id) references public.registrations(id) on delete cascade,
    constraint fundraising_participations_charity_fkey foreign key (charity_id) references public.fundraising_charities(id),
    constraint fundraising_participations_unique_reg unique (registration_id)
);
```

---

## 3. RLS-Strategie

We hanteren strikte isolatie.

### `fundraising_event_settings` & `fundraising_event_charities`
*   **Select:**
    *   `public` (iedereen) mag lezen als het gekoppelde event `published` is.
    *   `org_members` mogen altijd lezen.
*   **Insert/Update/Delete:**
    *   Alleen `org_admins` en `org_owners` van de betreffende organisatie.

### `fundraising_participations`
*   **Select:**
    *   `public` mag lezen (want actiepaginas zijn vaak publiek, of we tonen "X heeft al Y opgehaald" op de event site).
    *   *Alternatief:* Alleen de owner (`auth.uid()`) en `org_members` mogen details zien. Voor publieke display gebruiken we een `security definer` view of functie.
*   **Insert:**
    *   `authenticated` users mogen inserten voor hun *eigen* registratie (`registration.participant.user_id = auth.uid()`).
    *   Service role (Edge Functions) mag inserten.
*   **Update:**
    *   Alleen Service role (Edge Functions) mag `external_page_url` en `total_raised` updaten (vanuit webhooks).
    *   User mag eventueel `charity_id` wijzigen zolang status `pending` is.

---

## 4. Integratie-flow

We gebruiken het **Outbox Pattern** om synchronisatie met de externe partner te garanderen.

### Scenario: Deelnemer kiest voor fundraising (of is verplicht)

1.  **Trigger:**
    *   Deelnemer vinkt "Maak actiepagina" aan tijdens checkout, OF
    *   Deelnemer koopt een ticket met `fundraising_ticket_overrides` (mode=required).
2.  **Database Actie:**
    *   Er wordt een record aangemaakt in `fundraising_participations` met status `pending`.
    *   Er wordt een record aangemaakt in de algemene `integration_queue` (of `outbox`) tabel.
        *   `type`: `create_fundraising_page`
        *   `payload`: `{ registration_id, charity_id, user_email, user_name }`
3.  **Verwerking (Edge Function):**
    *   Een cronjob of webhook trigger pakt de job uit de queue.
    *   Roept API van externe partner aan (POST /pages).
    *   Ontvangt `external_page_id` en `url`.
4.  **Callback/Update:**
    *   Edge Function update `fundraising_participations`:
        *   `external_page_id` = ...
        *   `external_page_url` = ...
        *   `status` = 'active'
    *   (Optioneel) Stuurt e-mail naar deelnemer met de link.

### Scenario: Donatie ontvangen (Webhook)

1.  Externe partner stuurt webhook naar ons (`/webhooks/fundraising/donation`).
2.  Edge Function verifieert signature.
3.  Update `fundraising_participations.total_raised_cents`.
4.  Logt event in `audit_log`.

---

## 5. Edge Cases & Failure Scenarios

### 5.1 Event offline, maar fundraising link actief
*   **Gedrag:** De actiepagina bij de externe partner blijft bestaan. Donaties gaan naar het goede doel.
*   **Platform:** In ons dashboard tonen we de status, maar nieuwe registraties zijn niet mogelijk.
*   **Oplossing:** Geen actie nodig, dit is gewenst gedrag (geld gaat naar doel).

### 5.2 Fundraising uitgeschakeld na eerdere registraties
*   **Situatie:** Organizer zet `mode` van 'optional' naar 'disabled'.
*   **Gedrag:** Bestaande `fundraising_participations` blijven bestaan en actief. Nieuwe registraties krijgen de optie niet meer.
*   **UI:** Frontend verbergt de optie. Backend API weigert nieuwe inserts in `fundraising_participations`.

### 5.3 Ticket upgrade met override
*   **Situatie:** Deelnemer upgradet van "Basis" (geen fundraising) naar "Charity Ticket" (verplicht fundraising).
*   **Flow:**
    *   Bij de upgrade-transactie detecteert de backend de nieuwe ticket-regel.
    *   Backend maakt *automatisch* een `fundraising_participations` record aan.
    *   Trigger de outbox job.
    *   Deelnemer krijgt e-mail met "Je actiepagina is aangemaakt!".

### 5.4 Deelnemer zonder pagina bij 'Required'
*   **Risico:** Door een fout in de integratie is de pagina niet aangemaakt, maar het ticket is wel verkocht.
*   **Mitigatie:**
    *   De `integration_queue` heeft retries.
    *   Een dagelijkse "Sanity Check" job zoekt naar registraties die horen bij een 'Required' ticket maar geen entry in `fundraising_participations` hebben, en herstelt dit.

---

## 6. Expliciete Aannames

1.  **Externe Partner API:** We gaan ervan uit dat de externe partner een API heeft om pagina's aan te maken en webhooks stuurt voor updates.
2.  **Geen Geldstromen:** Wij raken geen geld aan. Donaties gaan direct van donateur naar partner/doel. Wij tonen alleen de teller.
3.  **Gebruiker:** De `participant` heeft een geldig e-mailadres dat we mogen delen met de externe partner voor het aanmaken van de pagina.
4.  **Ticket Types:** De `ticket_types` tabel bestaat en heeft een stabiele ID.

---
