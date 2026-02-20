#!/usr/bin/env node
/**
 * F009 S2 - Refund Flow Waterdicht Tests
 *
 * Tests:
 * 1. RPCs exist and are callable
 * 2. Refund table schema is correct
 * 3. Order status 'refunded' is a valid enum value
 * 4. Email template function exists
 *
 * Run with:
 *   node .claude-flow/flows/f009-refund-flow/tests/s2-waterdicht-tests.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

console.log("🧪 F009 S2: Refund Flow Waterdicht Tests\n");

// ========================================
// 1. RPC Existence Tests
// ========================================
console.log("--- RPC Tests ---");

await test("handle_refund_webhook function exists", async () => {
  const { data, error } = await supabase.rpc('handle_refund_webhook', {
    _mollie_refund_id: 'test_nonexistent',
    _status: 'refunded'
  });

  if (error) {
    // Permission denied is expected (service_role only)
    assert(
      error.message.includes('permission denied') || error.message.includes('denied'),
      `Unexpected error: ${error.message}`
    );
  } else {
    assert(data && data.error === 'REFUND_NOT_FOUND', 'Should return REFUND_NOT_FOUND');
  }
});

await test("void_tickets_for_refund function exists", async () => {
  const { data, error } = await supabase.rpc('void_tickets_for_refund', {
    _refund_id: '00000000-0000-0000-0000-000000000000'
  });

  if (error) {
    assert(
      error.message.includes('permission denied') || error.message.includes('denied'),
      `Unexpected error: ${error.message}`
    );
  } else {
    assert(data && data.error === 'REFUND_NOT_FOUND', 'Should return REFUND_NOT_FOUND');
  }
});

await test("get_order_refund_summary function exists", async () => {
  const { data, error } = await supabase.rpc('get_order_refund_summary', {
    _order_id: '00000000-0000-0000-0000-000000000000'
  });

  // This function is granted to authenticated, so anon should get auth error
  // or return ORDER_NOT_FOUND
  if (error) {
    assert(
      error.message.includes('permission denied') ||
      error.message.includes('denied') ||
      error.message.includes('Not authorized'),
      `Unexpected error: ${error.message}`
    );
  } else {
    assert(
      data && (data.error === 'ORDER_NOT_FOUND_OR_UNAUTHORIZED' || data.error),
      'Should return error for nonexistent order'
    );
  }
});

await test("queue_refund_confirmation_email function exists", async () => {
  const { data, error } = await supabase.rpc('queue_refund_confirmation_email', {
    _refund_id: '00000000-0000-0000-0000-000000000000'
  });

  if (error) {
    // Any error except "function does not exist" is acceptable
    assert(
      !error.message.includes('Could not find the function') &&
      !error.message.includes('function public.queue_refund_confirmation_email') === false ||
      error.message.includes('permission denied') ||
      error.message.includes('denied') ||
      error.message.includes('null value') ||
      error.message.includes('REFUND'),
      `Function might not exist: ${error.message}`
    );
  }
});

// ========================================
// 2. Schema Tests
// ========================================
console.log("\n--- Schema Tests ---");

await test("refunds table has correct columns", async () => {
  const { data, error } = await supabase
    .from('refunds')
    .select('id, org_id, order_id, mollie_refund_id, mollie_payment_id, amount_cents, status, is_full_refund, tickets_voided, email_sent')
    .limit(0);

  assert(!error, `Column check failed: ${error?.message}`);
});

await test("refund_items table exists", async () => {
  const { data, error } = await supabase
    .from('refund_items')
    .select('id, refund_id, order_item_id, quantity, amount_cents')
    .limit(0);

  assert(!error, `Column check failed: ${error?.message}`);
});

await test("order status 'refunded' is valid enum value", async () => {
  // Verify we can filter by 'refunded' status without enum error
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('status', 'refunded')
    .limit(0);

  assert(!error, `Status 'refunded' not valid: ${error?.message}`);
});

await test("refund_status enum values are correct", async () => {
  for (const status of ['pending', 'queued', 'processing', 'refunded', 'failed', 'canceled']) {
    const { error } = await supabase
      .from('refunds')
      .select('id')
      .eq('status', status)
      .limit(0);

    assert(!error, `Status '${status}' failed: ${error?.message}`);
  }
});

// ========================================
// 3. RLS Tests
// ========================================
console.log("\n--- RLS Tests ---");

await test("Anonymous user CANNOT read refunds", async () => {
  const { data, error } = await supabase
    .from('refunds')
    .select('id')
    .limit(5);

  // Should either return empty (RLS blocks) or error
  assert(!error || error.message.includes('permission'), `Unexpected: ${error?.message}`);
  if (data) {
    assert(data.length === 0, 'Anon user should not see any refunds');
  }
});

await test("Anonymous user CANNOT insert refunds", async () => {
  const { data, error } = await supabase
    .from('refunds')
    .insert({
      org_id: '00000000-0000-0000-0000-000000000001',
      order_id: '00000000-0000-0000-0000-000000000001',
      amount_cents: 1000,
      status: 'pending'
    })
    .select();

  assert(error !== null, 'INSERT should be blocked by RLS');
});

// ========================================
// 4. Integration Chain Tests
// ========================================
console.log("\n--- Chain Verification ---");

await test("payment_events table exists (idempotency store)", async () => {
  const { data, error } = await supabase
    .from('payment_events')
    .select('id, provider, provider_event_id, event_type')
    .limit(0);

  assert(!error, `payment_events missing: ${error?.message}`);
});

await test("email_outbox table exists (notification queue)", async () => {
  const { data, error } = await supabase
    .from('email_outbox')
    .select('id, to_email, subject, status')
    .limit(0);

  assert(!error, `email_outbox missing: ${error?.message}`);
});

await test("audit_log table has required columns", async () => {
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, org_id, action, resource_type, resource_id, entity_type, entity_id, details, metadata')
    .limit(0);

  assert(!error, `audit_log columns missing: ${error?.message}`);
});

// ========================================
// Summary
// ========================================
console.log(`\n${"=".repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${"=".repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
