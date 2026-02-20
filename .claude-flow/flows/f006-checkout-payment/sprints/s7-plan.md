# F006 S7: Ticket Flow Waterdicht

## Doel
Fix alle kritieke bugs in de ticket flow (QR codes, refunds, RLS, transfers, capacity counting, cleanup jobs) om het systeem productie-waardig te maken.

## Scope

### P0 - KRITIEK (Sprint 1)
1. **Fix QR code generatie** - token_hash en qr_code uit 1 UUID afleiden
2. **Fix void_tickets_for_refund** - verkeerde enum + niet-bestaande kolommen
3. **Lock-down INSERT RLS** - ticket_instances en tickets INSERT policies dichtgooien
4. **Herschrijf transfer Edge Functions** - initiate-transfer en accept-transfer tegen V2 schema

### P1 - HOOG (Sprint 1 cont.)
5. **Unificeer capacity counting** - checkout + webhook moeten zelfde telling gebruiken
6. **Overbooked order handling** - auto-refund queue + notificatie
7. **Cleanup jobs** - expired transfers + stale pending orders scheduling
8. **Fix scan_ticket** - kolom referentie (al gefixed in F015 S3, verificatie)

## Bestanden die wijzigen

### Nieuwe Migration
- `supabase/migrations/20260220100000_f006_s7_ticket_flow_waterdicht.sql`

### Edge Functions (herschrijving)
- `supabase/functions/initiate-transfer/index.ts`
- `supabase/functions/accept-transfer/index.ts`

## Backwards Compatibility
- Legacy `tickets` tabel wordt NIET verwijderd (P2 - toekomstige sprint)
- Bestaande scans blijven werken (token_hash verandert niet voor reeds uitgegeven tickets)
- Nieuwe tickets krijgen correcte token_hash/qr_code relatie

## Risico's
- Bestaande tickets in productie hebben mismatched token_hash/qr_code
- Migration moet bestaande tickets repareren (backfill)
