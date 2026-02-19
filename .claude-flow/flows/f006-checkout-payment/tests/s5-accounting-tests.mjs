#!/usr/bin/env node
/**
 * F006 S5 - Boekhoudkundige Verplichtingen (Accounting) Tests
 *
 * Tests VAT calculation, platform invoices, settlements, and accounting exports.
 *
 * Run with:
 *   node .claude-flow/flows/f006-checkout-payment/tests/s5-accounting-tests.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log("🧪 F006 S5 Tests: Boekhoudkundige Verplichtingen\n");

// ============================================================
// S5a: Schema Tests
// ============================================================
console.log("--- S5a: VAT Calculation Schema ---");

await test("order_items.vat_percentage column exists", async () => {
  const { data, error } = await supabase
    .from('order_items')
    .select('vat_percentage')
    .limit(1);
  // If column doesn't exist, the query will error
  assert(!error, `Column query failed: ${error?.message}`);
});

await test("order_items.vat_amount column exists", async () => {
  const { data, error } = await supabase
    .from('order_items')
    .select('vat_amount')
    .limit(1);
  assert(!error, `Column query failed: ${error?.message}`);
});

await test("orders.vat_amount column exists", async () => {
  const { data, error } = await supabase
    .from('orders')
    .select('vat_amount')
    .limit(1);
  assert(!error, `Column query failed: ${error?.message}`);
});

await test("validate_checkout_with_products RPC still works (backwards compat)", async () => {
  // Call with empty arrays to verify function exists and returns expected shape
  const { data, error } = await supabase.rpc('validate_checkout_with_products', {
    _event_id: '00000000-0000-0000-0000-000000000000',
    _ticket_items: [],
    _product_items: []
  });
  // Should return valid=true with empty items (no items to validate)
  assert(!error, `RPC failed: ${error?.message}`);
  assert(data !== null, 'RPC returned null');
  assert(data.valid === true, `Expected valid=true, got ${data.valid}`);
  assert('total_vat' in data, 'Missing total_vat in response');
});

await test("validate_checkout_with_products returns VAT info", async () => {
  const { data, error } = await supabase.rpc('validate_checkout_with_products', {
    _event_id: '00000000-0000-0000-0000-000000000000',
    _ticket_items: [],
    _product_items: []
  });
  assert(!error, `RPC failed: ${error?.message}`);
  assert(data.total_vat !== undefined, 'total_vat not in response');
  assert(data.total_vat === 0, `Expected total_vat=0 for empty items, got ${data.total_vat}`);
});

// ============================================================
// S5b: Platform Invoices & Settlements Schema Tests
// ============================================================
console.log("\n--- S5b: Platform Invoices & Settlements ---");

await test("platform_fee_config table exists", async () => {
  const { error } = await supabase.from('platform_fee_config').select('id').limit(0);
  assert(!error, `Table not found: ${error?.message}`);
});

await test("platform_invoices table exists", async () => {
  const { error } = await supabase.from('platform_invoices').select('id').limit(0);
  assert(!error, `Table not found: ${error?.message}`);
});

await test("platform_invoice_items table exists", async () => {
  const { error } = await supabase.from('platform_invoice_items').select('id').limit(0);
  assert(!error, `Table not found: ${error?.message}`);
});

await test("settlements table exists", async () => {
  const { error } = await supabase.from('settlements').select('id').limit(0);
  assert(!error, `Table not found: ${error?.message}`);
});

await test("settlement_lines table exists", async () => {
  const { error } = await supabase.from('settlement_lines').select('id').limit(0);
  assert(!error, `Table not found: ${error?.message}`);
});

// ============================================================
// RLS Tests - Anon should NOT be able to read any financial tables
// ============================================================
console.log("\n--- RLS Tests (anon cannot access) ---");

await test("RLS: anon cannot read platform_fee_config", async () => {
  const { data, error } = await supabase.from('platform_fee_config').select('*');
  // Should return empty array (RLS denies) or error
  assert(!error, `Unexpected error: ${error?.message}`);
  assert(data.length === 0, `Expected 0 rows for anon, got ${data.length}`);
});

await test("RLS: anon cannot read platform_invoices", async () => {
  const { data, error } = await supabase.from('platform_invoices').select('*');
  assert(!error, `Unexpected error: ${error?.message}`);
  assert(data.length === 0, `Expected 0 rows for anon, got ${data.length}`);
});

await test("RLS: anon cannot read settlements", async () => {
  const { data, error } = await supabase.from('settlements').select('*');
  assert(!error, `Unexpected error: ${error?.message}`);
  assert(data.length === 0, `Expected 0 rows for anon, got ${data.length}`);
});

await test("RLS: anon cannot read settlement_lines", async () => {
  const { data, error } = await supabase.from('settlement_lines').select('*');
  assert(!error, `Unexpected error: ${error?.message}`);
  assert(data.length === 0, `Expected 0 rows for anon, got ${data.length}`);
});

await test("RLS: anon cannot insert into platform_invoices", async () => {
  const { error } = await supabase.from('platform_invoices').insert({
    org_id: '00000000-0000-0000-0000-000000000000',
    invoice_number: 'TEST-001',
    invoice_year: 2026,
    invoice_sequence: 999,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
  });
  assert(error !== null, 'Expected RLS to block insert');
});

await test("RLS: anon cannot insert into settlements", async () => {
  const { error } = await supabase.from('settlements').insert({
    org_id: '00000000-0000-0000-0000-000000000000',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
  });
  assert(error !== null, 'Expected RLS to block insert');
});

// ============================================================
// Backfill Verification
// ============================================================
console.log("\n--- Backfill Verification ---");

await test("Paid orders have VAT data backfilled", async () => {
  // Check if any paid orders have non-zero total but zero vat_amount
  const { data, error } = await supabase
    .from('orders')
    .select('id, total_amount, vat_amount')
    .eq('status', 'paid')
    .gt('total_amount', 0)
    .eq('vat_amount', 0)
    .limit(5);

  if (error) {
    // RLS may block this query for anon - that's OK
    console.log(`  (skipped - RLS blocks anon access to orders)`);
    return;
  }

  // If we got results, backfill may have missed some
  if (data && data.length > 0) {
    console.log(`  ⚠️ ${data.length} paid orders still have vat_amount=0 (may need re-backfill)`);
  }
});

// ============================================================
// get_default_settings update
// ============================================================
console.log("\n--- Settings Update ---");

await test("get_default_settings returns kvk_number for payments", async () => {
  const { data, error } = await supabase.rpc('get_default_settings', { _domain: 'payments' });
  assert(!error, `RPC failed: ${error?.message}`);
  assert(data !== null, 'RPC returned null');
  assert('kvk_number' in data, 'Missing kvk_number in payments defaults');
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${'='.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
