-- 1. Verify initial state (Pending Transfer)
SELECT 
    tt.id as transfer_id,
    tt.status,
    tt.from_participant_id,
    tt.to_participant_id,
    tt.to_email,
    ti.owner_user_id as current_ticket_owner,
    p_from.user_id as from_user_id,
    p_to.user_id as to_user_id
FROM public.ticket_transfers tt
JOIN public.ticket_instances ti ON tt.ticket_instance_id = ti.id
LEFT JOIN public.participants p_from ON tt.from_participant_id = p_from.id
LEFT JOIN public.participants p_to ON tt.to_participant_id = p_to.id
WHERE tt.status = 'pending'
-- AND tt.id = 'YOUR_TRANSFER_ID' -- Uncomment to filter by specific ID
LIMIT 1;

-- 2. Simulate Accept (This would be the RPC call)
-- SELECT public.accept_ticket_transfer('YOUR_TRANSFER_ID');

-- 3. Verify after accept
SELECT 
    tt.id as transfer_id,
    tt.status,
    tt.accepted_at,
    tt.accepted_by_user_id,
    ti.owner_user_id as new_ticket_owner,
    p_to.user_id as expected_owner_id
FROM public.ticket_transfers tt
JOIN public.ticket_instances ti ON tt.ticket_instance_id = ti.id
LEFT JOIN public.participants p_to ON tt.to_participant_id = p_to.id
WHERE tt.id = 'YOUR_TRANSFER_ID';
