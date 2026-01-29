/**
 * admin-fix-all-orders - Fix ALL pending orders to paid
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
        const eventId = url.searchParams.get('event_id')

        const supabase = getServiceClient()

        // Build query
        let query = supabase
            .from('orders')
            .select('id, email, status, total_amount')
            .eq('status', 'pending')

        if (eventId) {
            query = query.eq('event_id', eventId)
        }

        const { data: pendingOrders, error: fetchError } = await query

        if (fetchError) {
            return new Response(JSON.stringify({ error: fetchError.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        const results = []

        for (const order of pendingOrders || []) {
            // Update order status to paid
            const { error: orderError } = await supabase
                .from('orders')
                .update({ status: 'paid', updated_at: new Date().toISOString() })
                .eq('id', order.id)

            // Update payment status if exists
            await supabase
                .from('payments')
                .update({ status: 'paid', updated_at: new Date().toISOString() })
                .eq('order_id', order.id)

            results.push({
                id: order.id,
                email: order.email,
                total_amount: order.total_amount,
                success: !orderError,
                error: orderError?.message
            })
        }

        return new Response(JSON.stringify({
            fixed_count: results.filter(r => r.success).length,
            total_pending: pendingOrders?.length || 0,
            results
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
