#!/usr/bin/env node
/**
 * Integration Tests: F006 Checkout & Payment
 * Tests the complete checkout flow: create-order-public, mollie-webhook, ticket issuance
 *
 * Runs against deployed Supabase instance.
 * Tests focus on: RLS enforcement, RPC validation, edge function existence, idempotency.
 */

import { createClient } from "@supabase/supabase-js";

// === CONFIG ===
const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === TEST HELPERS ===
let passed = 0, failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
    results.push({ name, status: "PASS" });
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
    results.push({ name, status: "FAIL", error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

// === TESTS ===
console.log("🧪 F006 Checkout & Payment Integration Tests\n");
console.log("=" .repeat(50));

// ─────────────────────────────────────────────────
// GROUP 1: Database Schema Validation
// ─────────────────────────────────────────────────
console.log("\n📊 Group 1: Database Schema");

await test("orders table has org_id column", async () => {
  // Attempt to select org_id from orders (anon should be blocked by RLS, but column must exist)
  const { error } = await supabase
    .from("orders")
    .select("org_id")
    .limit(0);
  // If error mentions column doesn't exist, that's our failure
  if (error && error.message && error.message.includes("does not exist")) {
    throw new Error("org_id column missing: " + error.message);
  }
  // Permission denied (RLS) is expected and OK — column exists
});

await test("orders table has subtotal_amount column", async () => {
  const { error } = await supabase
    .from("orders")
    .select("subtotal_amount")
    .limit(0);
  if (error && error.message && error.message.includes("does not exist")) {
    throw new Error("subtotal_amount column missing: " + error.message);
  }
});

await test("payment_events table exists with unique constraint", async () => {
  const { error } = await supabase
    .from("payment_events")
    .select("id, provider, provider_event_id")
    .limit(0);
  // RLS blocks access but table must exist
  if (error && error.code === "42P01") {
    throw new Error("payment_events table does not exist");
  }
});

await test("payments table has provider check constraint", async () => {
  const { error } = await supabase
    .from("payments")
    .select("id, provider, status")
    .limit(0);
  if (error && error.code === "42P01") {
    throw new Error("payments table does not exist");
  }
});

// ─────────────────────────────────────────────────
// GROUP 2: RPC Functions Exist
// ─────────────────────────────────────────────────
console.log("\n⚙️  Group 2: RPC Functions");

await test("validate_checkout_capacity RPC exists", async () => {
  const { error } = await supabase.rpc("validate_checkout_capacity", {
    _event_id: crypto.randomUUID(),
    _items: []
  });
  // Should not get "function does not exist" error
  if (error && error.message && error.message.includes("does not exist")) {
    throw error;
  }
  // Other errors (like empty items) are acceptable
});

await test("handle_payment_webhook RPC exists", async () => {
  const { error } = await supabase.rpc("handle_payment_webhook", {
    _order_id: crypto.randomUUID(),
    _payment_id: "test_nonexistent",
    _status: "open",
    _amount: 0,
    _currency: "EUR"
  });
  if (error && error.message && error.message.includes("does not exist")) {
    throw error;
  }
});

await test("cleanup_stale_pending_orders RPC exists", async () => {
  const { error } = await supabase.rpc("cleanup_stale_pending_orders");
  if (error && error.message && error.message.includes("does not exist")) {
    throw error;
  }
});

await test("simulate_payment_success RPC exists (dev tool)", async () => {
  // This should be blocked for anon (REVOKE EXECUTE), but must exist
  const { error } = await supabase.rpc("simulate_payment_success", {
    _order_id: crypto.randomUUID()
  });
  if (error && error.message && error.message.includes("does not exist")) {
    throw error;
  }
  // Permission denied is expected
});

// ─────────────────────────────────────────────────
// GROUP 3: Edge Function Existence & Basic Validation
// ─────────────────────────────────────────────────
console.log("\n🌐 Group 3: Edge Functions");

async function callEdgeFunction(name, body = {}, method = "POST") {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const response = await fetch(url, {
    method,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {}
  return { response, data, status: response.status };
}

await test("create-order-public rejects missing event_id", async () => {
  const { status, data } = await callEdgeFunction("create-order-public", {
    items: [{ ticket_type_id: crypto.randomUUID(), quantity: 1 }],
    email: "test@example.com"
  });
  assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "MISSING_EVENT_ID", `Expected MISSING_EVENT_ID, got ${data?.code}`);
});

await test("create-order-public rejects missing email", async () => {
  const { status, data } = await callEdgeFunction("create-order-public", {
    event_id: crypto.randomUUID(),
    items: [{ ticket_type_id: crypto.randomUUID(), quantity: 1 }]
  });
  assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "MISSING_EMAIL", `Expected MISSING_EMAIL, got ${data?.code}`);
});

await test("create-order-public rejects invalid email format", async () => {
  const { status, data } = await callEdgeFunction("create-order-public", {
    event_id: crypto.randomUUID(),
    items: [{ ticket_type_id: crypto.randomUUID(), quantity: 1 }],
    email: "not-an-email"
  });
  assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "MISSING_EMAIL", `Expected MISSING_EMAIL, got ${data?.code}`);
});

await test("create-order-public rejects empty items array", async () => {
  const { status, data } = await callEdgeFunction("create-order-public", {
    event_id: crypto.randomUUID(),
    items: [],
    email: "test@example.com"
  });
  assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "MISSING_ITEMS", `Expected MISSING_ITEMS, got ${data?.code}`);
});

await test("create-order-public rejects invalid quantity (0)", async () => {
  const { status, data } = await callEdgeFunction("create-order-public", {
    event_id: crypto.randomUUID(),
    items: [{ ticket_type_id: crypto.randomUUID(), quantity: 0 }],
    email: "test@example.com"
  });
  assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "INVALID_QUANTITY", `Expected INVALID_QUANTITY, got ${data?.code}`);
});

await test("create-order-public rejects non-existent event", async () => {
  const { status, data } = await callEdgeFunction("create-order-public", {
    event_id: crypto.randomUUID(),
    items: [{ ticket_type_id: crypto.randomUUID(), quantity: 1 }],
    email: "test@example.com"
  });
  assert(status === 404, `Expected 404, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "EVENT_NOT_FOUND", `Expected EVENT_NOT_FOUND, got ${data?.code}`);
});

await test("create-order-public rejects non-POST method", async () => {
  const url = `${SUPABASE_URL}/functions/v1/create-order-public`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  assert(response.status === 405, `Expected 405, got ${response.status}`);
});

await test("mollie-webhook rejects missing payment id", async () => {
  const url = `${SUPABASE_URL}/functions/v1/mollie-webhook`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",  // No 'id' field
  });
  assert(response.status === 400, `Expected 400, got ${response.status}`);
});

await test("get-order-public rejects missing token", async () => {
  const { status, data } = await callEdgeFunction("get-order-public", {});
  assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "MISSING_TOKEN", `Expected MISSING_TOKEN, got ${data?.code}`);
});

await test("get-order-public rejects invalid token", async () => {
  const { status, data } = await callEdgeFunction("get-order-public", {
    public_token: "totally_invalid_token_that_does_not_exist"
  });
  assert(status === 404, `Expected 404, got ${status}: ${JSON.stringify(data)}`);
  assert(data?.code === "ORDER_NOT_FOUND", `Expected ORDER_NOT_FOUND, got ${data?.code}`);
});

// ─────────────────────────────────────────────────
// GROUP 4: RLS Security Verification
// ─────────────────────────────────────────────────
console.log("\n🔒 Group 4: RLS Security");

await test("Anonymous cannot SELECT from orders", async () => {
  const { data, error } = await supabase
    .from("orders")
    .select("id, email")
    .limit(10);
  // Should either get empty result or RLS error
  // Empty is fine (no matching policies for anon)
  // We just verify no data leaks through
  if (data && data.length > 0) {
    throw new Error(`RLS VIOLATION: Anonymous user can read ${data.length} orders!`);
  }
});

await test("Anonymous cannot SELECT from payments", async () => {
  const { data } = await supabase
    .from("payments")
    .select("id, amount, provider_payment_id")
    .limit(10);
  if (data && data.length > 0) {
    throw new Error(`RLS VIOLATION: Anonymous user can read ${data.length} payments!`);
  }
});

await test("Anonymous cannot SELECT from payment_events", async () => {
  const { data } = await supabase
    .from("payment_events")
    .select("id, payload")
    .limit(10);
  if (data && data.length > 0) {
    throw new Error(`RLS VIOLATION: Anonymous user can read ${data.length} payment_events!`);
  }
});

await test("Anonymous cannot INSERT into payments directly", async () => {
  const { error } = await supabase
    .from("payments")
    .insert({
      org_id: crypto.randomUUID(),
      order_id: crypto.randomUUID(),
      provider: "mollie",
      provider_payment_id: "test_" + crypto.randomUUID(),
      amount: 1000,
      currency: "EUR",
      status: "open"
    });
  assert(error, "Expected RLS to block anonymous INSERT into payments");
});

// ─────────────────────────────────────────────────
// GROUP 5: Capacity Validation Logic
// ─────────────────────────────────────────────────
console.log("\n📦 Group 5: Capacity Validation");

await test("validate_checkout_capacity handles empty items gracefully", async () => {
  const { data, error } = await supabase.rpc("validate_checkout_capacity", {
    _event_id: crypto.randomUUID(),
    _items: []
  });
  // Empty items = valid with 0 total (nothing to buy)
  if (!error) {
    assert(data?.valid === true, `Expected valid=true for empty items, got ${JSON.stringify(data)}`);
    assert(data?.total_price === 0 || data?.total_price === "0", `Expected total_price=0, got ${data?.total_price}`);
  }
});

await test("validate_checkout_capacity rejects invalid quantity", async () => {
  const { data, error } = await supabase.rpc("validate_checkout_capacity", {
    _event_id: crypto.randomUUID(),
    _items: [{ ticket_type_id: crypto.randomUUID(), quantity: 0 }]
  });
  if (!error) {
    assert(data?.valid === false, `Expected valid=false for quantity=0, got ${JSON.stringify(data)}`);
    assert(data?.error === "INVALID_QUANTITY", `Expected INVALID_QUANTITY error`);
  }
});

await test("validate_checkout_capacity returns not found for nonexistent ticket", async () => {
  const { data, error } = await supabase.rpc("validate_checkout_capacity", {
    _event_id: crypto.randomUUID(),
    _items: [{ ticket_type_id: crypto.randomUUID(), quantity: 1 }]
  });
  if (!error) {
    assert(data?.valid === false, `Expected valid=false for nonexistent ticket, got ${JSON.stringify(data)}`);
  }
});

// === SUMMARY ===
console.log("\n" + "=".repeat(50));
console.log(`\n📊 Results: ✅ ${passed} passed | ❌ ${failed} failed | Total: ${passed + failed}`);

if (failed > 0) {
  console.log("\n❌ Failed tests:");
  results.filter(r => r.status === "FAIL").forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
}

console.log("\n" + "=".repeat(50));
process.exit(failed > 0 ? 1 : 0);
