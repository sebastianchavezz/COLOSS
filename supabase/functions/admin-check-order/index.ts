/**
 * admin-check-order - Debug endpoint to check order status in DB
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
        const orderId = url.searchParams.get('order_id')

        if (!orderId) {
            return new Response(JSON.stringify({ error: 'Missing order_id' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        const supabase = getServiceClient()

        // Get order
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single()

        // Get payments
        const { data: payments } = await supabase
            .from('payments')
            .select('*')
            .eq('order_id', orderId)

        // Get payment events
        const { data: events } = await supabase
            .from('payment_events')
            .select('*')
            .or(`provider_payment_id.eq.tr_c3EuKewd2CVUZ6nmH3PLJ,payload->metadata->>order_id.eq.${orderId}`)
            .limit(10)

        return new Response(JSON.stringify({
            order: order || { error: orderError?.message },
            payments: payments || [],
            payment_events: events || [],
            debug: {
                orderId,
                timestamp: new Date().toISOString()
            }
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
