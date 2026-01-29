/**
 * admin-fix-order - Fix order status directly
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
        const newStatus = url.searchParams.get('status') || 'paid'

        if (!orderId) {
            return new Response(JSON.stringify({ error: 'Missing order_id' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        const supabase = getServiceClient()

        // Update order status
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', orderId)
            .select()
            .single()

        if (orderError) {
            return new Response(JSON.stringify({
                error: orderError.message,
                step: 'update_order'
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Update payment status
        const { error: paymentError } = await supabase
            .from('payments')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('order_id', orderId)

        return new Response(JSON.stringify({
            success: true,
            order: order,
            payment_updated: !paymentError,
            payment_error: paymentError?.message
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
