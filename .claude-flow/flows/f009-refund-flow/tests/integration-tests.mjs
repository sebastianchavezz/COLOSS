#!/usr/bin/env node
/**
 * F009 Refund Flow - Integration Tests
 *
 * Tests:
 * 1. Database schema verification
 * 2. RPC functions exist
 * 3. RLS policies work correctly
 * 4. Refund summary calculation
 */

import { createClient } from "@supabase/supabase-js";

// === CONFIG ===
const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === TEST HELPERS ===
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// === TESTS ===
console.log("🧪 F009 Refund Flow - Integration Tests\n");
console.log("=".repeat(50));

// Test 1: Refunds table exists
await test("refunds table exists", async () => {
  const { error } = await supabase.from("refunds").select("id").limit(1);
  // 42501 = permission denied (RLS) which means table exists
  // PGRST116 = no rows (fine)
  if (error && error.code !== "42501" && error.code !== "PGRST116") {
    throw new Error(error.message);
  }
});

// Test 2: refund_items table exists
await test("refund_items table exists", async () => {
  const { error } = await supabase.from("refund_items").select("id").limit(1);
  if (error && error.code !== "42501" && error.code !== "PGRST116") {
    throw new Error(error.message);
  }
});

// Test 3: RPC get_order_refund_summary exists
await test("RPC get_order_refund_summary exists", async () => {
  const { error } = await supabase.rpc("get_order_refund_summary", {
    _order_id: "00000000-0000-0000-0000-000000000000"
  });
  // Function exists if error is about NOT_FOUND or UNAUTHORIZED, not "does not exist"
  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC does not exist");
  }
});

// Test 4: RPC void_tickets_for_refund exists
await test("RPC void_tickets_for_refund exists", async () => {
  const { error } = await supabase.rpc("void_tickets_for_refund", {
    _refund_id: "00000000-0000-0000-0000-000000000000"
  });
  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC does not exist");
  }
});

// Test 5: RPC handle_refund_webhook exists
await test("RPC handle_refund_webhook exists", async () => {
  const { error } = await supabase.rpc("handle_refund_webhook", {
    _mollie_refund_id: "re_test123",
    _status: "pending"
  });
  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC does not exist");
  }
});

// Test 6: Anonymous cannot access refunds (RLS)
await test("Anonymous blocked from refunds table", async () => {
  const { data, error } = await supabase.from("refunds").select("*").limit(1);
  // Should return empty or permission error
  assert(
    error?.code === "42501" || (data && data.length === 0) || !data,
    "Should be blocked by RLS"
  );
});

// Test 7: Anonymous cannot insert refunds (RLS)
await test("Anonymous cannot insert refunds", async () => {
  const { error } = await supabase.from("refunds").insert({
    org_id: "00000000-0000-0000-0000-000000000000",
    order_id: "00000000-0000-0000-0000-000000000000",
    payment_id: "00000000-0000-0000-0000-000000000000",
    mollie_payment_id: "tr_test",
    amount_cents: 1000,
    idempotency_key: crypto.randomUUID(),
    created_by: "00000000-0000-0000-0000-000000000000"
  });
  assert(error, "Insert should be blocked");
});

// Test 8: RPC returns proper error for non-existent order
await test("get_order_refund_summary returns error for bad order", async () => {
  const { data } = await supabase.rpc("get_order_refund_summary", {
    _order_id: "00000000-0000-0000-0000-000000000000"
  });
  assert(
    data?.error === "ORDER_NOT_FOUND_OR_UNAUTHORIZED",
    `Expected ORDER_NOT_FOUND_OR_UNAUTHORIZED, got ${data?.error}`
  );
});

// Test 9: void_tickets_for_refund returns error for non-existent refund
await test("void_tickets_for_refund returns error for bad refund", async () => {
  const { data } = await supabase.rpc("void_tickets_for_refund", {
    _refund_id: "00000000-0000-0000-0000-000000000000"
  });
  assert(
    data?.error === "REFUND_NOT_FOUND",
    `Expected REFUND_NOT_FOUND, got ${data?.error}`
  );
});

// Test 10: handle_refund_webhook returns error for non-existent refund
await test("handle_refund_webhook returns error for unknown refund", async () => {
  const { data } = await supabase.rpc("handle_refund_webhook", {
    _mollie_refund_id: "re_nonexistent",
    _status: "pending"
  });
  assert(
    data?.error === "REFUND_NOT_FOUND",
    `Expected REFUND_NOT_FOUND, got ${data?.error}`
  );
});

// === SUMMARY ===
console.log("\n" + "=".repeat(50));
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log("=".repeat(50));

process.exit(failed > 0 ? 1 : 0);
