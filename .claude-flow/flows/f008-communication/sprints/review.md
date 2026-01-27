# Code Review: Communication Module

**Reviewer:** @reviewer agent  
**Date:** 2025-01-27  
**Files Reviewed:**
- `supabase/migrations/20250127000001_communication_outbox.sql`
- `supabase/migrations/20250127000002_communication_settings_extension.sql`
- `supabase/functions/process-outbox/index.ts`
- `supabase/functions/resend-webhook/index.ts`
- `supabase/functions/bulk-email/index.ts`
- `supabase/functions/unsubscribe/index.ts`
- `supabase/functions/_shared/email.ts`

---

## Verdict: APPROVED WITH MINOR CHANGES REQUESTED

Overall is dit een solide implementatie van een email outbox pattern met goede security practices. Er zijn enkele kleine verbeterpunten maar geen kritieke security issues.

---

## Critical (MUST FIX)

| Issue | File | Line | Fix |
|-------|------|------|-----|
| Geen kritieke issues gevonden | - | - | - |

---

## Warnings

### 1. `USING (true)` Policy op email_unsubscribes

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20250127000001_communication_outbox.sql`  
**Line:** 402-404

```sql
CREATE POLICY "Public can check unsubscribe status"
    ON public.email_unsubscribes FOR SELECT
    USING (true);
```

**Issue:** Deze policy staat toe dat iedereen alle unsubscribe records kan lezen. Hoewel de comment uitlegt dat dit nodig is voor compliance checks, is dit een potentieel privacy-risico. Iemand kan systematisch email adressen checken om te zien of ze bestaan.

**Aanbeveling:** Overweeg om de lookup te beperken tot alleen het eigen email adres of via een SECURITY DEFINER functie die alleen een boolean teruggeeft:

```sql
-- Optie 1: Beperkt tot eigen email (via participants link)
CREATE POLICY "Users can check own unsubscribe status"
    ON public.email_unsubscribes FOR SELECT
    USING (
        email = (SELECT email FROM public.participants WHERE user_id = auth.uid())
    );

-- Of behoud huidige policy maar documenteer de risk-acceptance
```

**Verdict:** ACCEPTABEL met documentatie - de functie `is_email_deliverable` draait als SECURITY DEFINER en is de primaire consumer. Publieke SELECT is nodig voor self-service unsubscribe pagina's.

---

### 2. `any` Type in bulk-email function

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/functions/bulk-email/index.ts`  
**Lines:** 150, 183, 204

```typescript
recipients = (data || []).map((r: any) => ({
```

**Issue:** Meerdere `any` type casts voor database responses.

**Fix:** Definieer proper interfaces voor de database responses:

```typescript
interface RegistrationWithParticipant {
    participant_id: string
    participants: {
        id: string
        email: string
        first_name: string | null
        last_name: string | null
    }
}

recipients = (data || []).map((r: RegistrationWithParticipant) => ({
    // ...
}))
```

---

### 3. Missing INSERT/UPDATE/DELETE Policies

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20250127000001_communication_outbox.sql`

**Issue:** Alle RLS policies zijn alleen voor SELECT. Dit is correct als alle writes via Edge Functions (service role) gaan, maar zou expliciet gedocumenteerd moeten worden.

**Tables zonder write policies:**
- `message_templates`
- `message_batches`
- `email_outbox`
- `email_outbox_events`
- `message_batch_items`
- `email_unsubscribes`
- `email_bounces`

**Aanbeveling:** Voeg expliciete comment toe:

```sql
-- NOTE: All INSERT/UPDATE/DELETE operations on communication tables
-- are performed via Edge Functions using service role (bypasses RLS).
-- Only SELECT policies are needed for client-side read access.
```

---

### 4. Race Condition in process-outbox Lock

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/functions/process-outbox/index.ts`  
**Lines:** 108-121

```typescript
const { error: lockError } = await supabaseAdmin
    .from('email_outbox')
    .update({
        status: 'processing',
        last_attempt_at: new Date().toISOString()
    })
    .eq('id', email.id)
    .in('status', ['queued', 'soft_bounced'])
```

**Issue:** De lock update checkt niet of de row daadwerkelijk geupdate is. Twee concurrent workers kunnen dezelfde email oppakken als de timing verkeerd is.

**Fix:** Gebruik `RETURNING` of check affected rows:

```typescript
const { data: lockResult, error: lockError } = await supabaseAdmin
    .from('email_outbox')
    .update({
        status: 'processing',
        last_attempt_at: new Date().toISOString()
    })
    .eq('id', email.id)
    .in('status', ['queued', 'soft_bounced'])
    .select('id')
    .single()

if (lockError || !lockResult) {
    // Another worker already locked this email
    result.skipped_count++
    continue
}
```

---

### 5. Potentiele XSS in unsubscribe HTML Response

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/functions/unsubscribe/index.ts`  
**Line:** 92-165

**Issue:** De `htmlResponse` functie genereert HTML. Hoewel de huidige implementatie geen user input direct injecteert, is het een best practice om HTML te escapen.

**Huidige code is VEILIG** omdat:
- `title` en `message` komen uit hardcoded strings
- Geen user input wordt direct in de HTML geplaatst

**Aanbeveling:** Voeg een comment toe die dit bevestigt of implementeer escape functie voor toekomstig gebruik.

---

## Suggestions

### 1. Performance: N+1 Query in bulk-email

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/functions/bulk-email/index.ts`  
**Lines:** 222-241

```typescript
for (const recipient of uniqueRecipients) {
    const { data: isDeliverable, error: deliverabilityError } = await supabaseAdmin
        .rpc('is_email_deliverable', { ... })
```

**Issue:** Bij grote batches wordt `is_email_deliverable` voor elke recipient apart aangeroepen. Bij 10.000 recipients zijn dit 10.000 database calls.

**Suggestie:** Maak een batch variant van de functie:

```sql
CREATE OR REPLACE FUNCTION public.filter_deliverable_emails(
    _emails text[],
    _org_id uuid,
    _email_type text
)
RETURNS text[]
-- Returns only the deliverable emails from the input array
```

---

### 2. Logging Enhancement

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/functions/process-outbox/index.ts`

**Suggestie:** Voeg structured logging toe met correlation IDs voor debugging:

```typescript
logger.info('Processing email', {
    emailId: email.id,
    toEmail: email.to_email.substring(0, 3) + '***', // Mask for privacy
    attempt: email.attempt_count + 1
})
```

---

### 3. Retry Configuration Niet Gebruikt

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20250127000002_communication_settings_extension.sql`

**Issue:** De retry configuratie in communication settings (`retry.max_attempts`, `retry.initial_delay_ms`, etc.) wordt niet gebruikt door `process-outbox`. Die functie heeft hardcoded waarden.

**Suggestie:** Laad de retry config uit de org_settings in de Edge Function.

---

### 4. Missing Index op email_unsubscribes.email

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20250127000001_communication_outbox.sql`

**Issue:** Er is een composite unique index maar geen simpele index op alleen `email` voor snelle lookups op global unsubscribes.

**Suggestie:** 

```sql
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_email
    ON public.email_unsubscribes(email);
```

---

### 5. TypeScript Type Export

**File:** `/Users/sebastianchavez/Desktop/COLOSS/supabase/functions/_shared/email.ts`

**Suggestie:** Exporteer ook de interface types zodat ze in andere functions gebruikt kunnen worden:

```typescript
export interface UnsubscribeTokenPayload {
    email: string
    org_id: string
    email_type: string
    exp: number
}
```

---

## Good Practices Observed

1. **RLS Correct Enabled:** Alle 7 nieuwe tabellen hebben `ENABLE ROW LEVEL SECURITY` - dit is correct.

2. **Webhook Signature Verification:** De `resend-webhook` functie verifieert Svix signatures correct met timestamp check (5 minuten tolerance).

3. **Idempotency:** 
   - `email_outbox.idempotency_key` met UNIQUE constraint
   - `email_outbox_events.provider_event_id` met UNIQUE index
   - Webhook handler checkt voor bestaande events

4. **No Hardcoded Secrets:** Alle API keys worden uit environment variables geladen (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SERVICE_ROLE_KEY`).

5. **auth.uid() Correct:** De `is_org_member` helper functie gebruikt `auth.uid()` correct in de RLS policies.

6. **SECURITY DEFINER met search_path:** Alle database functies met SECURITY DEFINER hebben `SET search_path = public` om search_path injection te voorkomen.

7. **Input Validation:** Email format wordt gevalideerd via regex constraints en in TypeScript code.

8. **Event Sourcing:** `email_outbox_events` tabel biedt volledige audit trail van alle status changes.

9. **GDPR Compliance:** Unsubscribe functionaliteit is correct geimplementeerd met source tracking.

10. **Exponential Backoff:** Retry logic gebruikt exponential backoff met configureerbare parameters.

11. **JWT Authentication:** `bulk-email` functie verifieert JWT en checkt org role permissions correct.

12. **Parameterized Queries:** Alle database queries gebruiken Supabase client met parameterized queries (geen SQL injection risk).

---

## Security Checklist

- [x] Alle tabellen hebben RLS enabled
- [x] `USING (true)` heeft valide reden (unsubscribe compliance)
- [x] `auth.uid()` correct gebruikt in policies
- [x] Geen hardcoded API keys of secrets
- [x] Webhook signature verificatie aanwezig (Svix)
- [x] JWT verificatie correct in bulk-email
- [x] SQL injection preventie (parameterized queries)
- [x] XSS preventie in email content (geen user input in HTML)
- [x] SECURITY DEFINER functies hebben `SET search_path`

---

## Summary

De Communication Module is goed geimplementeerd met sterke security practices. De belangrijkste aanbeveling is om de race condition in `process-outbox` te fixen door te verifieren dat de lock update daadwerkelijk een row heeft geaffecteerd. De andere warnings en suggesties zijn nice-to-haves die de code quality verbeteren maar niet kritiek zijn voor production.

**Totaal Issues:**
- Critical: 0
- Warnings: 5 (1 acceptabel met documentatie, 4 should fix)
- Suggestions: 5

