/**
 * bulk-email Edge Function
 *
 * Starts a bulk email campaign by creating a message batch and queuing recipients.
 * Filters out unsubscribed/bounced emails before adding to the batch.
 *
 * Features:
 * - JWT authentication with org role verification (owner/admin only)
 * - Recipient filtering by ticket type or custom list
 * - Automatic filtering of unsubscribed/bounced emails via is_email_deliverable()
 * - Batch tracking with progress monitoring
 *
 * Security: Requires JWT with owner/admin role on the org
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser, isOrgMember } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// Input types
interface RecipientFilterAll {
    type: 'all'
}

interface RecipientFilterTicketType {
    type: 'ticket_type'
    ticket_type_id: string
}

interface RecipientFilterCustom {
    type: 'custom'
    participant_ids: string[]
}

type RecipientFilter = RecipientFilterAll | RecipientFilterTicketType | RecipientFilterCustom

interface BulkEmailRequest {
    event_id: string
    name: string
    subject: string
    html_body: string
    text_body?: string
    recipient_filter: RecipientFilter
    scheduled_at?: string
}

interface Recipient {
    participant_id: string
    email: string
    first_name: string | null
    last_name: string | null
}

const MAX_RECIPIENTS_PER_CAMPAIGN = 10000

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('bulk-email')
    logger.info('Function invoked')

    try {
        // 1. AUTHENTICATE
        const { user, error: authError } = await authenticateUser(req)
        if (authError || !user) {
            return errorResponse('Unauthorized', authError || 'NO_USER', 401)
        }

        logger.info('User authenticated', user.id)

        // 2. PARSE INPUT
        let body: Partial<BulkEmailRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { event_id, name, subject, html_body, text_body, recipient_filter, scheduled_at } = body

        // Validate required fields
        if (!event_id || !name || !subject || !html_body || !recipient_filter) {
            return errorResponse(
                'Missing required fields: event_id, name, subject, html_body, recipient_filter',
                'MISSING_FIELDS',
                400
            )
        }

        // Validate recipient filter
        if (!['all', 'ticket_type', 'custom'].includes(recipient_filter.type)) {
            return errorResponse('Invalid recipient_filter type', 'INVALID_FILTER_TYPE', 400)
        }

        // 3. SETUP ADMIN CLIENT
        const supabaseAdmin = getServiceClient()

        // 4. GET EVENT AND ORG INFO
        const { data: event, error: eventError } = await supabaseAdmin
            .from('events')
            .select('id, org_id, name')
            .eq('id', event_id)
            .single()

        if (eventError || !event) {
            logger.error('Event not found', eventError)
            return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
        }

        const orgId = event.org_id

        // 5. VERIFY ORG ROLE (owner/admin only)
        const hasRole = await isOrgMember(supabaseAdmin, orgId, user.id, ['owner', 'admin'])
        if (!hasRole) {
            logger.warn('User does not have required role', { userId: user.id, orgId })
            return errorResponse('Insufficient permissions. Owner or admin role required.', 'FORBIDDEN', 403)
        }

        logger.info('Authorization verified', { orgId, role: 'owner/admin' })

        // 6. FETCH RECIPIENTS BASED ON FILTER
        let recipients: Recipient[] = []

        if (recipient_filter.type === 'all') {
            // All participants with registrations for this event
            const { data, error } = await supabaseAdmin
                .from('registrations')
                .select(`
                    participant_id,
                    participants!inner(
                        id,
                        email,
                        first_name,
                        last_name
                    )
                `)
                .eq('event_id', event_id)
                .in('status', ['pending', 'paid', 'confirmed'])

            if (error) {
                logger.error('Failed to fetch recipients', error)
                return errorResponse('Failed to fetch recipients', 'FETCH_RECIPIENTS_FAILED', 500)
            }

            recipients = (data || []).map((r: any) => ({
                participant_id: r.participant_id,
                email: r.participants.email,
                first_name: r.participants.first_name,
                last_name: r.participants.last_name
            }))

        } else if (recipient_filter.type === 'ticket_type') {
            const ticketTypeFilter = recipient_filter as RecipientFilterTicketType

            // Participants with tickets of specific type
            const { data, error } = await supabaseAdmin
                .from('tickets')
                .select(`
                    registration_id,
                    registrations!inner(
                        participant_id,
                        participants!inner(
                            id,
                            email,
                            first_name,
                            last_name
                        )
                    )
                `)
                .eq('ticket_type_id', ticketTypeFilter.ticket_type_id)
                .eq('status', 'valid')

            if (error) {
                logger.error('Failed to fetch recipients by ticket type', error)
                return errorResponse('Failed to fetch recipients', 'FETCH_RECIPIENTS_FAILED', 500)
            }

            recipients = (data || []).map((t: any) => ({
                participant_id: t.registrations.participant_id,
                email: t.registrations.participants.email,
                first_name: t.registrations.participants.first_name,
                last_name: t.registrations.participants.last_name
            }))

        } else if (recipient_filter.type === 'custom') {
            const customFilter = recipient_filter as RecipientFilterCustom

            // Specific participants by ID
            const { data, error } = await supabaseAdmin
                .from('participants')
                .select('id, email, first_name, last_name')
                .in('id', customFilter.participant_ids)

            if (error) {
                logger.error('Failed to fetch custom recipients', error)
                return errorResponse('Failed to fetch recipients', 'FETCH_RECIPIENTS_FAILED', 500)
            }

            recipients = (data || []).map((p: any) => ({
                participant_id: p.id,
                email: p.email,
                first_name: p.first_name,
                last_name: p.last_name
            }))
        }

        // Deduplicate by email
        const uniqueRecipients = Array.from(
            new Map(recipients.map(r => [r.email.toLowerCase(), r])).values()
        )

        logger.info(`Found ${uniqueRecipients.length} unique recipients before filtering`)

        // 7. FILTER OUT UNSUBSCRIBED/BOUNCED EMAILS
        // Check deliverability for each email
        const deliverableRecipients: Recipient[] = []

        for (const recipient of uniqueRecipients) {
            // Call is_email_deliverable function
            const { data: isDeliverable, error: deliverabilityError } = await supabaseAdmin
                .rpc('is_email_deliverable', {
                    _email: recipient.email.toLowerCase(),
                    _org_id: orgId,
                    _email_type: 'marketing'
                })

            if (deliverabilityError) {
                logger.warn(`Failed to check deliverability for ${recipient.email}`, deliverabilityError)
                // Include recipient if we can't check (fail open for deliverability check only)
                deliverableRecipients.push(recipient)
            } else if (isDeliverable) {
                deliverableRecipients.push(recipient)
            } else {
                logger.debug(`Skipping undeliverable email: ${recipient.email}`)
            }
        }

        const filteredCount = uniqueRecipients.length - deliverableRecipients.length
        logger.info(`Filtered out ${filteredCount} undeliverable emails`)

        // 8. CHECK LIMITS
        if (deliverableRecipients.length === 0) {
            return errorResponse('No deliverable recipients found', 'NO_RECIPIENTS', 400)
        }

        if (deliverableRecipients.length > MAX_RECIPIENTS_PER_CAMPAIGN) {
            return errorResponse(
                `Too many recipients. Maximum is ${MAX_RECIPIENTS_PER_CAMPAIGN}`,
                'TOO_MANY_RECIPIENTS',
                400
            )
        }

        // 9. CREATE MESSAGE BATCH
        const { data: batch, error: batchError } = await supabaseAdmin
            .from('message_batches')
            .insert({
                org_id: orgId,
                event_id: event_id,
                name: name,
                email_type: 'marketing',
                subject: subject,
                html_body: html_body,
                text_body: text_body || null,
                recipient_filter: recipient_filter,
                status: 'queued',
                total_recipients: deliverableRecipients.length,
                queued_count: deliverableRecipients.length,
                scheduled_at: scheduled_at || null,
                created_by: user.id
            })
            .select()
            .single()

        if (batchError || !batch) {
            logger.error('Failed to create batch', batchError)
            return errorResponse('Failed to create batch', 'BATCH_CREATION_FAILED', 500)
        }

        logger.info('Batch created', { batchId: batch.id, recipients: deliverableRecipients.length })

        // 10. INSERT BATCH ITEMS
        const batchItems = deliverableRecipients.map(recipient => ({
            batch_id: batch.id,
            participant_id: recipient.participant_id,
            email: recipient.email.toLowerCase(),
            variables: {
                first_name: recipient.first_name || '',
                last_name: recipient.last_name || '',
                event_name: event.name
            },
            status: 'pending'
        }))

        // Insert in chunks to avoid hitting limits
        const CHUNK_SIZE = 500
        for (let i = 0; i < batchItems.length; i += CHUNK_SIZE) {
            const chunk = batchItems.slice(i, i + CHUNK_SIZE)
            const { error: itemsError } = await supabaseAdmin
                .from('message_batch_items')
                .insert(chunk)

            if (itemsError) {
                logger.error(`Failed to insert batch items chunk ${i / CHUNK_SIZE}`, itemsError)
                // Mark batch as failed
                await supabaseAdmin
                    .from('message_batches')
                    .update({ status: 'failed' })
                    .eq('id', batch.id)

                return errorResponse('Failed to queue recipients', 'BATCH_ITEMS_FAILED', 500)
            }
        }

        logger.info('All batch items inserted')

        // 11. RETURN SUCCESS
        return jsonResponse({
            success: true,
            batch_id: batch.id,
            total_recipients: deliverableRecipients.length,
            filtered_out: filteredCount,
            message: `Bulk email campaign queued with ${deliverableRecipients.length} recipients`
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
