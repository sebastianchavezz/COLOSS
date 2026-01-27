---

## 🟢 SPRINT 0 — Settings Fundament (DONE)

### 🎯 Doel
Een **veilig, uitbreidbaar settings-platform** bouwen waarop alle toekomstige configuratie steunt.

### Backend — ✅ VOLTOOID
- `get_event_config`  
  → merged config (system → org → event)
- `set_event_config`  
  → PATCH-semantics (merge, geen replace)  
  → audit logging
- `reset_event_config_domain`
- `get_event_config_permissions`
- Event overrides losgekoppeld van defaults
- Audit trail voor settings-wijzigingen
- Bugfix: `entity_id` UUID/text mismatch

### RBAC — ✅ VOLTOOID
| Domein | Rollen |
|------|-------|
| Payments | owner, admin, finance |
| Transfers | owner, admin, support |
| Communication | owner, admin, support |

### Frontend — ✅ VOLTOOID
- Settings tabs: Payments / Transfers / Communication
- Disabled fields bij onvoldoende rechten
- “Reset to defaults” per domein
- Inline validatie
- Toast notifications
- Debug panel via `?debug=1`

**Status:** 🟢 DONE  
**Opmerking:** Dit is architecturaal **sterker dan Atleta**, dat geen echte merge-logica heeft.

---

## 🟢 SPRINT 1 — Governance & Legal (DONE)

> Lage UI-kost, hoge juridische & security impact

### Settings-domeinen
- `governance` (visibility)
- `legal` (terms & conditions)

### Backend — ✅ VOLTOOID
- `governance.is_private` toggle
- `public_events` view (excludes private events)
- `is_event_public()` helper function
- Terms & Conditions modes:
  - `none`
  - `pdf` (+ pdf_file_id)
  - `url` (+ url field)
  - `inline_text` (+ i18n text per locale)
- Domain constraint uitgebreid naar 5 domeinen
- RBAC: alleen owner/admin kan governance/legal wijzigen
- Validatie in `validate_setting_domain()`
- **DB-level enforcement via BEFORE trigger** ✅
  - `enforce_event_settings_validation` trigger
  - `enforce_org_settings_validation` trigger
  - Voorkomt invalid data via direct INSERT/UPDATE
- Audit logging voor alle wijzigingen

### RBAC — ✅ VOLTOOID
| Domein | Rollen |
|------|-------|
| Governance | owner, admin |
| Legal | owner, admin |

### Frontend — ✅ VOLTOOID
- Nieuwe "Governance" tab (eerste positie)
- Toggle "Besloten evenement" met uitleg
- Terms mode dropdown (none/pdf/url/inline_text)
- Conditional inputs:
  - PDF: file ID veld
  - URL: link input
  - Inline: textarea per locale (nl/en)
- Disabled fields voor support/finance
- Reset to defaults per sectie

### Enforcement
- `public_events` view: excludes is_private=true
- `is_event_public()`: helper voor queries
- **Validation triggers op DB-niveau** ✅
- Checkout enforcement: TODO (volgt in checkout feature)

### Verificatie
- `verify_sprint1_governance.sql` beschikbaar
- `verify_settings_trigger.sql` beschikbaar ✅
- Edge cases getest:
  - Invalid mode → ERROR ✅
  - Valid mode → SUCCESS ✅
  - RBAC check support role ✅

**Status:** 🟢 DONE

---

## ✅ SPRINT 2 — Content & Communicatie (DONE)

**Testresultaten: SUCCESVOL** 🎉

> Multilocale content, bewust **zonder zware editors** in v1

---

### Overzicht

Sprint 2 (Content & Communicatie) is **volledig getest** op database-niveau en alle validaties, constraints en businessregels werken zoals ontworpen.

---

### Settings-domeinen
- `basic_info` (event naam, omschrijving, contact)
- `content_communication` (checkout message, email subject/body, extra recipients)

---

### Backend — Validatie & Data-integriteit (SQL)

**i18n / Locale validatie**
- Toegestane locales: `nl, en, fr, de, es, it, pt`
- Ongeldige locale (bv. `"xx"`) → **hard reject** ✅
  > `ERROR: Invalid locale key "xx"`

**basic_info**
- Meertalige `name` en `description` werken correct ✅
- `contact_email` en `website` correct opgeslagen ✅

**content_communication**
- Meertalige velden:
  - `checkout_message`
  - `email_subject`
  - `email_body`
  → alle correct gevalideerd per locale ✅

**extra_recipients**
- Maximaal **5** e-mailadressen → enforced ✅
- Meer dan 5 → **ERROR** ✅
- Duplicaten → **ERROR** ✅
- Ongeldig e-mailformaat → **ERROR** ✅
- Geldige lijst (≤5, uniek, geldig formaat) → **SUCCES** ✅

**Triggers & Validatie**
- `trigger_validate_setting()` actief op `event_settings` ✅
- Alle writes (INSERT/UPDATE) lopen via `validate_setting_domain()` ✅
- Ongeldige data kan **niet** meer in de database terechtkomen ✅

**Data-veiligheid**
- Mislukte writes laten bestaande geldige data intact ✅
- Laatst geldige `content_communication` configuratie blijft behouden ✅

---

### RBAC — ✅ VOLTOOID
| Domein | Rollen |
|------|-------|
| basic_info | owner, admin |
| content_communication | owner, admin |

---

### Frontend — ✅ VOLTOOID
- Nieuwe "Content" tab (tweede positie)
- **Locale switcher** (NL/EN/FR tabs)
- Event naam/omschrijving per locale
- Contact email + website velden
- Checkout bevestigingsbericht per locale
- E-mail onderwerp + body per locale
- 5 input velden voor extra notificatie-ontvangers
- Disabled fields voor support/finance
- Reset to defaults per sectie

---

### Bewuste beperkingen
- ❌ Geen mail template editor
- ❌ Geen variabelen-UI
- ❌ Geen preview engine
- ❌ Geen HTML sanitization

---

### Verificatie
- `verify_sprint2_content.sql` beschikbaar ✅

---

### Conclusie

- ✅ Sprint 2 backend is **correct, robuust en production-ready**
- ✅ Alle functionele en negatieve testcases zijn geslaagd
- ✅ Validatie wordt **op DB-niveau afgedwongen**, onafhankelijk van frontend
- ✅ Geen regressies of datacorruptie vastgesteld

**Status:** 🟢 DONE

---

## ✅ SPRINT 3 — Branding (Light) (DONE)

**Testresultaten: SUCCESVOL** 🎉

> Branding zonder checkout preview engine

---

### Settings-domeinen
- `branding` (hero_image_id, logo_image_id, primary_color)

---

### Backend — Validatie & Data-integriteit (SQL)

| Test | Resultaat |
|------|-----------|
| `branding` domain toegestaan | ✅ |
| Geldige hex kleur #RRGGBB | ✅ |
| Short hex (#FFF) geweigerd | ✅ |
| `hero_image_id` UUID validatie | ✅ |
| `logo_image_id` UUID validatie | ✅ |
| Geldige UUID's geaccepteerd | ✅ |
| Triggers (`trigger_validate_setting`) actief | ✅ |
| Ongeldige data kan DB niet binnen | ✅ |

**Helpers & Defaults**
- `is_valid_hex_color()` function werkt correct ✅
- Default kleur `#4F46E5` blijft valide fallback ✅

**Data-integriteit**
- Foutieve updates worden geblokkeerd ✅
- Geldige bestaande data blijft intact ✅
- JSON-merge gedrag werkt correct (`jsonb_set`) ✅

---

### TODO (Future Sprint)
- ⚠️ Storage existence validation via Edge Function + service_role
- ⚠️ Mime-type validatie tegen storage metadata
- ⚠️ File size validatie (hero: 5MB, logo: 2MB)
- ⚠️ Herverificatie bij checkout/PDF generatie

---

### RBAC — ✅ VOLTOOID
| Domein | Rollen |
|------|-------|
| branding | owner, admin |

---

### Frontend — ✅ VOLTOOID
- Nieuwe "Branding" tab (derde positie)
- Hero image ID input (UUID)
- Logo image ID input (UUID)
- Native color picker + hex input
- Inline validatie (#RRGGBB formaat)
- Disabled fields voor support/finance
- Reset to defaults

---

### Verificatie
- `verify_sprint3_branding.sql` beschikbaar ✅

---

### Bewuste beperkingen
- ❌ Geen preview engine
- ❌ Geen image cropping
- ❌ Geen file upload UI (komt in toekomstige sprint)
- ❌ Geen storage existence check (TODO)

---

### Conclusie

- ✅ Sprint 3 is **production-ready**
- ✅ Branding settings zijn **veilig, strikt gevalideerd en uitbreidbaar**
- ✅ Alle functionele en negatieve testcases zijn geslaagd
- ✅ Geen regressies in Sprint 0–2

**Status:** 🟢 DONE

---

## ✅ SPRINT 4 — Wachtlijst & Interesselijst (DONE)

**Testresultaten: SUCCESVOL** 🎉

> Settings en enforcement logic voor wachtlijst en interesselijst

---

### Backend – Validatie & Enforcement

Alles werkt exact zoals ontworpen.

**Waitlist**
- `waitlist.enabled = true` → correct opgeslagen ✅
- Ongeldige key (`{"invalid": true}`) → hard reject ✅
- `can_join_waitlist(event_id)`:
  - Werkt correct met auth-context
  - Geeft `true` terug wanneer enabled ✅

**Interest List**
- `interest_list.enabled = true` → correct opgeslagen ✅
- Ongeldige key → hard reject ✅
- `can_join_interest_list(event_id)`:
  - Werkt correct met auth-context
  - Geeft `true` terug wanneer enabled ✅

**RBAC**
- Alleen org owner/admin mag configs lezen/wijzigen ✅
- Enforcement helpers zijn correct beschermd via `get_event_config()` + `is_org_member()` ✅

**Validatie**
- Key whitelist (`enabled` only) correct afgedwongen ✅
- Default gedrag (`enabled = false` indien geen row) correct ✅
- Triggers (`trigger_validate_setting`) werken voor beide domeinen ✅

---

### Frontend — ✅ VOLTOOID
- Nieuwe "Wachtlijst & Interesse" tab
- Toggle voor Wachtlijst
- Toggle voor Interesselijst
- Duidelijke uitleg per sectie
- Disabled fields voor support/finance
- Reset to defaults

---

**Status:** 🟢 DONE

---

## 🔒 SPRINT 5 — Deelnemersdashboard & Mutaties (GEPAUZEERD)

> Hoog risico, afhankelijk van refunds & upgrades

### Settings-domeinen
- `participant_dashboard`
- `ticket_permissions`

### Vereist
- Lock dates
- Per-ticket overrides
- Mutation policies

**Status:** 🔒 ON HOLD  
**Reden:** afhankelijk van toekomstige refund/upgrade flows

---

## ✅ SPRINT 6 — Ticket-PDF & Privacy (DONE)

**Testresultaten: SUCCESVOL** 🎉

> Settings voor ticket beschikbaarheid en privacy

---

### Settings-domeinen
- `ticket_pdf` (available_from, banner_image_id)
- `ticket_privacy` (show whitelist)

---

### Backend — Validatie & Enforcement (SQL)

| Test | Resultaat |
|------|-----------|
| `ticket_pdf` domain toegestaan | ✅ |
| `ticket_privacy` domain toegestaan | ✅ |
| `available_from` ISO-8601 validatie | ✅ |
| `banner_image_id` UUID validatie | ✅ |
| Privacy keys whitelist enforcement | ✅ |
| Privacy values boolean enforcement | ✅ |

**Enforcement Helpers**
- `are_tickets_available()` (Time-based check) ✅
- `get_ticket_privacy()` (Returns whitelist) ✅

**RBAC**
- Owner/Admin only (Support/Finance read-only) ✅

---

### Frontend — ✅ VOLTOOID
- Nieuwe "Tickets & Privacy" tab
- Datetime picker voor `available_from`
- Checkbox matrix voor privacy fields
- Banner Image ID input
- Disabled fields voor support/finance
- Reset to defaults

---

### Verificatie
- `verify_sprint6_ticket_pdf_privacy.sql` beschikbaar ✅

**Status:** 🟢 DONE

---

## ❄️ SPRINT 7 — Wachtrij (OPTIONEEL)

> Infra-intensief, niet MVP-kritisch

**Status:** ❄️ ON HOLD

---

## ❌ Bewust uitgesloten uit MVP Settings

| Feature | Reden |
|------|------|
| Checkout preview engine | UX-heavy |
| Full WYSIWYG editors | Security + scope |
| Partner attribution UI | Reporting eerst |
| Marketing automation | Post-MVP |
| Realtime settings updates | Nice-to-have |

---

## 🧠 Strategische Samenvatting

- ✅ Jullie hebben **exact de juiste basis** gelegd (Sprint 0)
- ✅ Settings functioneren als **policy engine**, niet als formulier
- ✅ Enforcement gebeurt **altijd backend-first**
- 🚀 Dit model schaalt verder dan Atleta

**Aanbevolen volgende stap:**  
➡️ **Sprint 1 (Governance & Legal) volledig implementeren**

---

## 📁 Aanbevolen bestandsnaam