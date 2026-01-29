/**
 * admin-retry-webhook - Delete payment event and retry webhook
 * TEMPORARY - Remove after debugging
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors, corsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase.ts'

serve(async (req: Request) => {
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    try {
        const url = new URL(req.url)
        const paymentId = url.searchParams.get('payment_id')

        if (!paymentId) {
            return new Response(JSON.stringify({ error: 'Missing payment_id' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        const supabase = getServiceClient()

        // Delete existing payment events for this payment
        const { data: deleted, error: deleteError } = await supabase
            .from('payment_events')
            .delete()
            .eq('provider_payment_id', paymentId)
            .select()

        if (deleteError) {
            return new Response(JSON.stringify({
                error: deleteError.message,
                step: 'delete_events'
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Call the webhook endpoint
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mollie-webhook`
        const formData = new URLSearchParams()
        formData.append('id', paymentId)

        const webhookResponse = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        })

        const webhookResult = await webhookResponse.text()

        return new Response(JSON.stringify({
            success: true,
            deleted_events: deleted?.length || 0,
            webhook_status: webhookResponse.status,
            webhook_result: webhookResult
        }, null, 2), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: String(error) }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
