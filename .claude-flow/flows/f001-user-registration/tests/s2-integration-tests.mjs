#!/usr/bin/env node
/**
 * F001 S2 - End User Registration Upgrade Tests
 *
 * Tests the S2 upgrade: profile retrieval, profile update, participant creation.
 * Run AFTER deploying migration: 20260205100000_f001_s2_user_registration_upgrade.sql
 *
 * Run with:
 *   node .claude-flow/flows/f001-user-registration/tests/s2-integration-tests.mjs
 */

import { createClient } from "@supabase/supabase-js";

// === CONFIG ===
const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === TEST HELPERS ===
let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e.message}`); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// === TESTS ===
console.log("🧪 F001 S2 - End User Registration Upgrade Tests\n");

// ============================================================
// Group 1: RPC Function Existence
// ============================================================
console.log("📋 Group 1: RPC Function Existence");

await test("get_my_participant_profile RPC exists", async () => {
  const { data, error } = await supabase.rpc("get_my_participant_profile");
  if (error?.message?.includes("does not exist")) throw new Error("RPC missing: " + error.message);
  assert(data?.error === 'NOT_AUTHENTICATED' || data?.status === 'OK' || data?.status === 'NO_PARTICIPANT',
    `Unexpected: ${JSON.stringify(data)}`);
});

await test("update_my_participant_profile RPC exists", async () => {
  const { data, error } = await supabase.rpc("update_my_participant_profile", {
    p_first_name: "Test"
  });
  if (error?.message?.includes("does not exist")) throw new Error("RPC missing: " + error.message);
  if (error?.message?.includes("No function matches")) throw new Error("Signature mismatch: " + error.message);
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    `Unexpected: ${JSON.stringify(data || error)}`
  );
});

await test("create_or_link_participant RPC still exists (backwards compat)", async () => {
  const { data, error } = await supabase.rpc("create_or_link_participant", {
    p_first_name: "Test",
    p_last_name: "User"
  });
  if (error?.message?.includes("does not exist")) throw new Error("RPC missing: " + error.message);
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    `Unexpected: ${JSON.stringify(data || error)}`
  );
});

await test("link_current_user_to_participant RPC still exists (backwards compat)", async () => {
  const { data, error } = await supabase.rpc("link_current_user_to_participant");
  if (error?.message?.includes("does not exist")) throw new Error("RPC missing: " + error.message);
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    `Unexpected: ${JSON.stringify(data || error)}`
  );
});

// ============================================================
// Group 2: Anonymous Access Protection
// ============================================================
console.log("\n📋 Group 2: Anonymous Access Protection");

await test("Anonymous cannot get profile", async () => {
  const { data, error } = await supabase.rpc("get_my_participant_profile");
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    "Anonymous should be blocked"
  );
});

await test("Anonymous cannot update profile", async () => {
  const { data, error } = await supabase.rpc("update_my_participant_profile", {
    p_first_name: "Hacker"
  });
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    "Anonymous should be blocked"
  );
});

await test("Anonymous cannot create participant", async () => {
  const { data, error } = await supabase.rpc("create_or_link_participant", {
    p_first_name: "Hacker",
    p_last_name: "User"
  });
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    "Anonymous should be blocked"
  );
});

// ============================================================
// Group 3: Parameter Acceptance
// ============================================================
console.log("\n📋 Group 3: RPC Parameter Acceptance");

await test("update_my_participant_profile accepts all parameters", async () => {
  const { data, error } = await supabase.rpc("update_my_participant_profile", {
    p_first_name: "Test",
    p_last_name: "User",
    p_phone: "+31612345678",
    p_birth_date: "1990-01-01",
    p_gender: "M",
    p_address: "Teststraat 1",
    p_city: "Amsterdam",
    p_country: "NL"
  });
  if (error?.message?.includes("does not exist")) throw new Error("Parameter mismatch: " + error.message);
  if (error?.message?.includes("No function matches")) throw new Error("Signature mismatch: " + error.message);
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    `Unexpected: ${JSON.stringify(data || error)}`
  );
});

await test("update_my_participant_profile accepts partial parameters", async () => {
  const { data, error } = await supabase.rpc("update_my_participant_profile", {
    p_first_name: "Test"
  });
  if (error?.message?.includes("does not exist")) throw new Error("Parameter mismatch: " + error.message);
  if (error?.message?.includes("No function matches")) throw new Error("Signature mismatch: " + error.message);
  assert(
    data?.error === 'NOT_AUTHENTICATED' || error?.message?.includes('permission denied'),
    `Unexpected: ${JSON.stringify(data || error)}`
  );
});

// ============================================================
// Group 4: Table Structure
// ============================================================
console.log("\n📋 Group 4: Participants Table Structure");

await test("Participants table exists", async () => {
  const { error } = await supabase.from("participants").select("id").limit(1);
  if (error?.code === "42P01") throw new Error("Table does not exist");
});

await test("Participants table has all profile columns", async () => {
  const { error } = await supabase
    .from("participants")
    .select("id,email,first_name,last_name,phone,birth_date,gender,address,city,country,user_id")
    .limit(0);
  if (error?.message?.includes("does not exist")) {
    throw new Error("Missing columns: " + error.message);
  }
});

// ============================================================
// Group 5: S1 Regression Tests
// ============================================================
console.log("\n📋 Group 5: S1 Regression Tests");

await test("sync_registration_on_payment RPC still works", async () => {
  const { data, error } = await supabase.rpc('sync_registration_on_payment', {
    p_order_id: '00000000-0000-0000-0000-000000000000'
  });
  if (error?.message?.includes('does not exist')) throw new Error('RPC missing');
  assert(
    data?.error === 'ORDER_NOT_FOUND' || error,
    'Expected ORDER_NOT_FOUND or error'
  );
});

await test("audit_log table exists", async () => {
  const { error } = await supabase.from('audit_log').select('id').limit(1);
  if (error?.code === '42P01') throw new Error('Table missing');
});

// === SUMMARY ===
console.log(`\n${"=".repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${"=".repeat(50)}`);

if (failed > 0) {
  console.log("\n⚠️  Some tests failed.");
  console.log("   If migration not deployed yet, run: supabase db push --linked");
}

process.exit(failed > 0 ? 1 : 0);
