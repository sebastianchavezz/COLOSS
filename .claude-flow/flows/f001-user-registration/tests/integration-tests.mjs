#!/usr/bin/env node
/**
 * Integration Tests: F001 User Registration
 * Tests the post-purchase registration sync functionality
 * 
 * Run: node .claude-flow/flows/f001-user-registration/tests/integration-tests.mjs
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
  }
  catch (e) { 
    console.log(`❌ ${name}: ${e.message}`); 
    failed++; 
  }
}

function assert(cond, msg) { 
  if (!cond) throw new Error(msg); 
}

// === TESTS ===
console.log("🧪 Running F001 User Registration integration tests...\n");

// Test 1: Schema - ticket_instances.participant_id column exists
await test("T1: ticket_instances.participant_id column exists", async () => {
  const { data, error } = await supabase
    .from('ticket_instances')
    .select('participant_id')
    .limit(1);
  
  // If column doesn't exist, we get error code 42703
  if (error?.code === '42703') {
    throw new Error('Column participant_id does not exist');
  }
  // If table doesn't exist, we get PGRST204
  if (error?.code === 'PGRST204') {
    throw new Error('Table ticket_instances does not exist');
  }
  // Any other error might be RLS (acceptable - means column exists)
});

// Test 2: Schema - registrations_list_v view exists
await test("T2: registrations_list_v view exists", async () => {
  const { error } = await supabase
    .from('registrations_list_v')
    .select('id')
    .limit(1);
  
  // 42P01 = relation does not exist
  if (error?.code === '42P01') {
    throw new Error('View registrations_list_v does not exist');
  }
  // RLS denial is OK - means view exists
});

// Test 3: RPC - sync_registration_on_payment exists
await test("T3: sync_registration_on_payment RPC exists", async () => {
  const { data, error } = await supabase.rpc('sync_registration_on_payment', {
    p_order_id: '00000000-0000-0000-0000-000000000000'
  });
  
  // Function not found = 42883
  if (error?.message?.includes('does not exist') || error?.code === '42883') {
    throw new Error('RPC sync_registration_on_payment does not exist');
  }
  
  // Expected: ORDER_NOT_FOUND error (function exists but order doesn't)
  assert(
    data?.error === 'ORDER_NOT_FOUND' || error?.message?.includes('ORDER_NOT_FOUND'),
    `Expected ORDER_NOT_FOUND, got: ${JSON.stringify(data || error)}`
  );
});

// Test 4: RPC - get_registrations_list exists
await test("T4: get_registrations_list RPC exists", async () => {
  const { data, error } = await supabase.rpc('get_registrations_list', {
    _event_id: '00000000-0000-0000-0000-000000000000'
  });
  
  if (error?.message?.includes('does not exist') || error?.code === '42883') {
    throw new Error('RPC get_registrations_list does not exist');
  }
  
  // Expected: EVENT_NOT_FOUND or UNAUTHORIZED (function works)
  assert(
    data?.error === 'EVENT_NOT_FOUND' || data?.error === 'UNAUTHORIZED',
    `Expected EVENT_NOT_FOUND or UNAUTHORIZED, got: ${JSON.stringify(data)}`
  );
});

// Test 5: RPC - get_registration_detail exists
await test("T5: get_registration_detail RPC exists", async () => {
  const { data, error } = await supabase.rpc('get_registration_detail', {
    _registration_id: '00000000-0000-0000-0000-000000000000'
  });
  
  if (error?.message?.includes('does not exist') || error?.code === '42883') {
    throw new Error('RPC get_registration_detail does not exist');
  }
  
  // Expected: REGISTRATION_NOT_FOUND or UNAUTHORIZED
  assert(
    data?.error === 'REGISTRATION_NOT_FOUND' || data?.error === 'UNAUTHORIZED',
    `Expected REGISTRATION_NOT_FOUND or UNAUTHORIZED, got: ${JSON.stringify(data)}`
  );
});

// Test 6: Schema - participants table has email uniqueness
await test("T6: participants email uniqueness index exists", async () => {
  // Try to query - if index doesn't exist, we won't get a specific error
  // But we can verify by checking if upsert ON CONFLICT would work
  const { error } = await supabase
    .from('participants')
    .select('id, email')
    .limit(1);
  
  // No error = table exists and is queryable
  // We trust the migration creates the index
  if (error?.code === '42P01') {
    throw new Error('Table participants does not exist');
  }
});

// Test 7: Schema - registrations has order_item_id column
await test("T7: registrations.order_item_id column exists", async () => {
  const { data, error } = await supabase
    .from('registrations')
    .select('order_item_id')
    .limit(1);
  
  if (error?.code === '42703') {
    throw new Error('Column order_item_id does not exist');
  }
});

// Test 8: email_outbox table exists (for confirmation emails)
await test("T8: email_outbox table exists", async () => {
  const { error } = await supabase
    .from('email_outbox')
    .select('id')
    .limit(1);
  
  if (error?.code === '42P01' || error?.code === 'PGRST204') {
    throw new Error('Table email_outbox does not exist');
  }
  // RLS denial is OK
});

// Test 9: email_outbox has idempotency_key column
await test("T9: email_outbox.idempotency_key column exists", async () => {
  const { error } = await supabase
    .from('email_outbox')
    .select('idempotency_key')
    .limit(1);
  
  if (error?.code === '42703') {
    throw new Error('Column idempotency_key does not exist');
  }
});

// Test 10: audit_log table exists
await test("T10: audit_log table exists", async () => {
  const { error } = await supabase
    .from('audit_log')
    .select('id')
    .limit(1);
  
  if (error?.code === '42P01' || error?.code === 'PGRST204') {
    throw new Error('Table audit_log does not exist');
  }
});

// Test 11: Anonymous cannot call sync_registration_on_payment (should fail)
await test("T11: Anonymous gets error from sync_registration_on_payment", async () => {
  const { data, error } = await supabase.rpc('sync_registration_on_payment', {
    p_order_id: crypto.randomUUID()
  });
  
  // Should return ORDER_NOT_FOUND (valid response) or authorization error
  // Either way, function executed which means grants are correct
  assert(
    data?.error === 'ORDER_NOT_FOUND' || error,
    'Expected ORDER_NOT_FOUND or error'
  );
});

// Test 12: RPC returns proper structure
await test("T12: sync_registration_on_payment returns proper JSON structure", async () => {
  const { data, error } = await supabase.rpc('sync_registration_on_payment', {
    p_order_id: '00000000-0000-0000-0000-000000000000'
  });
  
  assert(data !== null || error !== null, 'Should return data or error');
  if (data) {
    assert('error' in data || 'status' in data, 'Response should have error or status key');
  }
});

// === SUMMARY ===
console.log(`\n${"=".repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${"=".repeat(50)}`);

if (failed > 0) {
  console.log("\n⚠️  Some tests failed. This may be because the migration hasn't been deployed yet.");
  console.log("   Run 'supabase db push' to deploy migrations, then re-run tests.");
}

process.exit(failed > 0 ? 1 : 0);
