/**
 * create-refund Edge Function
 *
 * Creates a refund for an order via Mollie Refunds API.
 *
 * Features:
 * - Full or partial refunds
 * - Idempotency via idempotency_key
 * - Mollie API integration
 * - Audit logging
 *
 * Security:
 * - Only org admins/owners can create refunds
 * - Validates refund amount doesn't exceed remaining
 * - Idempotent: same key returns same result
 *
 * @endpoint POST /functions/v1/create-refund
 * @auth Required (org admin/owner)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";

const MOLLIE_API_URL = "https://api.mollie.com/v2";

interface CreateRefundRequest {
  order_id: string;
  amount_cents?: number;
  items?: { order_item_id: string; quantity: number }[];
  reason?: string;
  internal_note?: string;
  idempotency_key: string;
}

serve(async (req: Request) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const logger = createLogger("create-refund");
  logger.info("Function invoked");

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Setup
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const mollieApiKey = Deno.env.get("MOLLIE_API_KEY");

    if (!mollieApiKey) {
      logger.error("Missing MOLLIE_API_KEY");
      return new Response(
        JSON.stringify({ error: "MOLLIE_NOT_CONFIGURED" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED", message: "Missing auth header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user from token
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED", message: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logger.info("User authenticated", { userId: user.id });

    // Parse request
    const body: CreateRefundRequest = await req.json();
    const { order_id, amount_cents, reason, internal_note, idempotency_key } = body;

    if (!order_id || !idempotency_key) {
      return new Response(
        JSON.stringify({ error: "MISSING_PARAMS", message: "order_id and idempotency_key required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for existing refund with same idempotency key
    const { data: existingRefund } = await supabase
      .from("refunds")
      .select("*")
      .eq("idempotency_key", idempotency_key)
      .single();

    if (existingRefund) {
      logger.info("Idempotent request - returning existing refund", { refundId: existingRefund.id });
      return new Response(
        JSON.stringify({
          success: true,
          idempotent: true,
          refund: {
            id: existingRefund.id,
            status: existingRefund.status,
            amount_cents: existingRefund.amount_cents,
            mollie_refund_id: existingRefund.mollie_refund_id,
            is_full_refund: existingRefund.is_full_refund,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get order with payment info and permission check
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id, org_id, status, total_amount, email,
        payments!inner(id, provider_payment_id, status)
      `)
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      logger.warn("Order not found", { orderId: order_id });
      return new Response(
        JSON.stringify({ error: "ORDER_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check user has permission (org admin/owner)
    const { data: membership } = await supabase
      .from("org_members")
      .select("role")
      .eq("org_id", order.org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN", message: "Must be org admin or owner" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check order is paid
    if (order.status !== "paid") {
      return new Response(
        JSON.stringify({ error: "ORDER_NOT_PAID", message: `Order status is ${order.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
    const molliePaymentId = payment?.provider_payment_id;

    if (!molliePaymentId) {
      return new Response(
        JSON.stringify({ error: "NO_PAYMENT", message: "No Mollie payment found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate refundable amount
    const orderTotalCents = Math.round(order.total_amount * 100);

    // Get existing refunds
    const { data: existingRefunds } = await supabase
      .from("refunds")
      .select("amount_cents, status")
      .eq("order_id", order_id)
      .in("status", ["pending", "queued", "processing", "refunded"]);

    const totalRefundedCents = (existingRefunds || []).reduce(
      (sum, r) => sum + r.amount_cents,
      0
    );
    const remainingRefundableCents = orderTotalCents - totalRefundedCents;

    // Determine refund amount
    let refundAmountCents: number;
    let isFullRefund: boolean;

    if (amount_cents !== undefined) {
      // Partial refund
      if (amount_cents <= 0) {
        return new Response(
          JSON.stringify({ error: "INVALID_AMOUNT", message: "Amount must be positive" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (amount_cents > remainingRefundableCents) {
        return new Response(
          JSON.stringify({
            error: "EXCEEDS_REFUNDABLE",
            message: `Max refundable: ${remainingRefundableCents} cents`,
            remaining_refundable_cents: remainingRefundableCents,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      refundAmountCents = amount_cents;
      isFullRefund = refundAmountCents === remainingRefundableCents;
    } else {
      // Full refund
      if (remainingRefundableCents <= 0) {
        return new Response(
          JSON.stringify({ error: "ALREADY_REFUNDED", message: "Order is fully refunded" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      refundAmountCents = remainingRefundableCents;
      isFullRefund = true;
    }

    logger.info("Creating refund", {
      orderId: order_id,
      amountCents: refundAmountCents,
      isFullRefund,
    });

    // Create refund record (pending)
    const { data: refund, error: refundError } = await supabase
      .from("refunds")
      .insert({
        org_id: order.org_id,
        order_id: order_id,
        payment_id: payment.id,
        mollie_payment_id: molliePaymentId,
        amount_cents: refundAmountCents,
        currency: "EUR",
        status: "pending",
        reason: reason || null,
        internal_note: internal_note || null,
        description: `Refund for order ${order_id.substring(0, 8)}`,
        idempotency_key: idempotency_key,
        is_full_refund: isFullRefund,
        created_by: user.id,
      })
      .select()
      .single();

    if (refundError) {
      logger.error("Failed to create refund record", refundError);
      return new Response(
        JSON.stringify({ error: "DB_ERROR", message: refundError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Mollie Refunds API
    const mollieAmount = (refundAmountCents / 100).toFixed(2);
    let mollieRefund: any;

    try {
      const mollieResponse = await fetch(
        `${MOLLIE_API_URL}/payments/${molliePaymentId}/refunds`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mollieApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: {
              currency: "EUR",
              value: mollieAmount,
            },
            description: reason || `Refund for order ${order_id.substring(0, 8)}`,
            metadata: {
              refund_id: refund.id,
              order_id: order_id,
              org_id: order.org_id,
            },
          }),
        }
      );

      if (!mollieResponse.ok) {
        const errorData = await mollieResponse.json();
        logger.error("Mollie API error", errorData);

        // Update refund as failed
        await supabase
          .from("refunds")
          .update({ status: "failed" })
          .eq("id", refund.id);

        return new Response(
          JSON.stringify({
            error: "MOLLIE_ERROR",
            message: errorData.detail || "Mollie API error",
            mollie_error: errorData,
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      mollieRefund = await mollieResponse.json();
      logger.info("Mollie refund created", { mollieRefundId: mollieRefund.id });
    } catch (mollieErr) {
      logger.error("Mollie API call failed", mollieErr);

      // Keep refund as pending - can be retried or handled manually
      return new Response(
        JSON.stringify({
          error: "MOLLIE_UNREACHABLE",
          message: "Could not reach Mollie API",
          refund_id: refund.id,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update refund with Mollie ID and initial status
    const mollieStatus = mollieRefund.status || "pending";
    await supabase
      .from("refunds")
      .update({
        mollie_refund_id: mollieRefund.id,
        status: mollieStatus === "refunded" ? "refunded" : mollieStatus === "queued" ? "queued" : "processing",
        refunded_at: mollieStatus === "refunded" ? new Date().toISOString() : null,
      })
      .eq("id", refund.id);

    // Audit log
    try {
      await supabase.from("audit_log").insert({
        org_id: order.org_id,
        user_id: user.id,
        action: "refund_created",
        resource_type: "refund",
        resource_id: refund.id,
        entity_type: "refund",
        entity_id: refund.id,
        details: {
          order_id: order_id,
          amount_cents: refundAmountCents,
          is_full_refund: isFullRefund,
          mollie_refund_id: mollieRefund.id,
          reason: reason,
        },
      });
    } catch (auditErr) {
      logger.warn("Audit log failed (non-fatal)", auditErr);
    }

    logger.info("Refund created successfully", {
      refundId: refund.id,
      mollieRefundId: mollieRefund.id,
      status: mollieStatus,
    });

    return new Response(
      JSON.stringify({
        success: true,
        refund: {
          id: refund.id,
          status: mollieStatus,
          amount_cents: refundAmountCents,
          mollie_refund_id: mollieRefund.id,
          is_full_refund: isFullRefund,
        },
        message: isFullRefund
          ? "Full refund initiated"
          : `Partial refund of €${mollieAmount} initiated`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Unexpected error", message);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
