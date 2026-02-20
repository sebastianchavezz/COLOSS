# F006 S7 Review: Ticket Flow Waterdicht

## Review Status: APPROVED (after fixes)

## Issues Found & Resolved

### Critical (Fixed)
1. **email_outbox wrong column names** - INSERT used `template_type`, `recipient_email`, `scheduled_for` which don't exist. Fixed to use correct schema: `idempotency_key`, `from_name`, `from_email`, `to_email`, `subject`, `html_body`, `scheduled_at`.
2. **CTE gen_random_uuid duplicate UUIDs** - `generate_series` in SELECT list with scalar `gen_random_uuid()` evaluates UUID once, not per row. Fixed using `CROSS JOIN LATERAL` to ensure unique UUID per row.

### Warnings (Fixed)
1. **ROW_COUNT always zero** - UPDATE and GET DIAGNOSTICS were in separate DO blocks. Merged into single block.
2. **cleanup-jobs authentication bypassable** - No-auth requests passed through, empty service key matched everything. Fixed with strict Bearer token check.
3. **transfer_token in plaintext response** - Sender could accept own transfer. Removed from response; token only travels via email.
4. **No recipient email verification** - Any user with token could accept. Added email match check in accept-transfer.
5. **Garbage participant names** - Email prefix used as first_name. Fixed to use user_metadata or empty strings.

### Pre-existing Issues (Not in scope)
- `auth.ts` debug logging and unsafe JWT fallback decode path (affects all Edge Functions)
- UPDATE policy on ticket_instances allows org members to change owner_user_id
- These should be addressed in a separate security sprint.

## Security Checklist
- [x] RLS INSERT policies locked (WITH CHECK false) on ticket_instances and tickets
- [x] SECURITY DEFINER functions bypass RLS correctly
- [x] Transfer token not leaked to sender
- [x] Recipient email verified on accept
- [x] cleanup-jobs requires service role Bearer token
- [x] Overbooked email uses correct schema with idempotency_key

## Backwards Compatibility
- [x] Existing tickets backfilled with correct token_hash
- [x] Legacy `tickets` table not removed
- [x] handle_payment_webhook signature unchanged
- [x] scan_ticket function not modified (F015 S3 version already correct)
