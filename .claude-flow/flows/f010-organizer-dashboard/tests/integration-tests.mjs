#!/usr/bin/env node
/**
 * Integration Tests: F010 Organizer Dashboard
 * Sprint S1: Data Layer & Stats
 *
 * Tests the dashboard RPCs:
 * - get_org_dashboard_stats
 * - get_event_dashboard_stats
 * - get_event_participant_stats
 *
 * Run: node .claude-flow/flows/f010-organizer-dashboard/tests/integration-tests.mjs
 */

import { createClient } from "@supabase/supabase-js";

// === CONFIG ===
const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === TEST HELPERS ===
let passed = 0;
let failed = 0;

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
console.log("🧪 F010 Dashboard Integration Tests (S1 + S2)\n");
console.log("=".repeat(50));
console.log("Sprint S1: Dashboard Stats RPCs");
console.log("=".repeat(50));

// ------------------------------------------
// Test 1: RPC get_org_dashboard_stats exists
// ------------------------------------------
await test("RPC get_org_dashboard_stats exists", async () => {
  const { data, error } = await supabase.rpc("get_org_dashboard_stats", {
    _org_id: crypto.randomUUID(),
  });

  // Should not throw "function does not exist" error
  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  // With random UUID, should return NOT_AUTHORIZED (anon user)
  // or NOT_FOUND, which proves the function exists and runs
  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND",
    `Expected NOT_AUTHORIZED or NOT_FOUND, got: ${JSON.stringify(data)}`
  );
});

// ------------------------------------------
// Test 2: RPC get_event_dashboard_stats exists
// ------------------------------------------
await test("RPC get_event_dashboard_stats exists", async () => {
  const { data, error } = await supabase.rpc("get_event_dashboard_stats", {
    _event_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND",
    `Expected NOT_AUTHORIZED or NOT_FOUND, got: ${JSON.stringify(data)}`
  );
});

// ------------------------------------------
// Test 3: RPC get_event_participant_stats exists
// ------------------------------------------
await test("RPC get_event_participant_stats exists", async () => {
  const { data, error } = await supabase.rpc("get_event_participant_stats", {
    _event_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND",
    `Expected NOT_AUTHORIZED or NOT_FOUND, got: ${JSON.stringify(data)}`
  );
});

// ------------------------------------------
// Test 4: Anonymous user cannot access org stats
// ------------------------------------------
await test("Anonymous blocked from org dashboard", async () => {
  // Try to access with a random org_id
  const { data } = await supabase.rpc("get_org_dashboard_stats", {
    _org_id: crypto.randomUUID(),
  });

  // Should be blocked
  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND",
    "Anonymous user should be blocked"
  );
});

// ------------------------------------------
// Test 5: Anonymous user cannot access event stats
// ------------------------------------------
await test("Anonymous blocked from event dashboard", async () => {
  const { data } = await supabase.rpc("get_event_dashboard_stats", {
    _event_id: crypto.randomUUID(),
  });

  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND",
    "Anonymous user should be blocked"
  );
});

// ------------------------------------------
// Test 6: View v_event_ticket_stats exists
// ------------------------------------------
await test("View v_event_ticket_stats queryable", async () => {
  const { error } = await supabase
    .from("v_event_ticket_stats")
    .select("event_id")
    .limit(1);

  // View should exist (may return empty or data depending on RLS)
  if (error?.code === "42P01") {
    throw new Error("View does not exist");
  }
  // PGRST116 means no rows found, which is OK
  if (error && error.code !== "PGRST116") {
    throw new Error(`Unexpected error: ${error.message}`);
  }
});

// ------------------------------------------
// Test 7: View v_ticket_type_stats exists
// ------------------------------------------
await test("View v_ticket_type_stats queryable", async () => {
  const { error } = await supabase
    .from("v_ticket_type_stats")
    .select("ticket_type_id")
    .limit(1);

  if (error?.code === "42P01") {
    throw new Error("View does not exist");
  }
  if (error && error.code !== "PGRST116") {
    throw new Error(`Unexpected error: ${error.message}`);
  }
});

// ------------------------------------------
// Test 8: View v_event_checkin_stats exists
// ------------------------------------------
await test("View v_event_checkin_stats queryable", async () => {
  const { error } = await supabase
    .from("v_event_checkin_stats")
    .select("event_id")
    .limit(1);

  if (error?.code === "42P01") {
    throw new Error("View does not exist");
  }
  if (error && error.code !== "PGRST116") {
    throw new Error(`Unexpected error: ${error.message}`);
  }
});

// ------------------------------------------
// Test 9: Response structure for org stats
// ------------------------------------------
await test("Org stats response has correct error structure", async () => {
  const { data } = await supabase.rpc("get_org_dashboard_stats", {
    _org_id: crypto.randomUUID(),
  });

  // Should have error and message fields
  assert(
    typeof data === "object" && data !== null,
    "Response should be an object"
  );
  assert(
    "error" in data || "org" in data,
    "Response should have error or org field"
  );
});

// ------------------------------------------
// Test 10: Response structure for event stats
// ------------------------------------------
await test("Event stats response has correct error structure", async () => {
  const { data } = await supabase.rpc("get_event_dashboard_stats", {
    _event_id: crypto.randomUUID(),
  });

  assert(
    typeof data === "object" && data !== null,
    "Response should be an object"
  );
  assert(
    "error" in data || "event" in data,
    "Response should have error or event field"
  );
});

// ------------------------------------------
// S2 Tests: Excel Export + Bulk Check-in
// ------------------------------------------
console.log("\n" + "=".repeat(50));
console.log("Sprint S2: Excel Export + Bulk Check-in");
console.log("=".repeat(50));

// Test 11: RPC export_registrations_xlsx_data exists
await test("RPC export_registrations_xlsx_data exists", async () => {
  const { data, error } = await supabase.rpc("export_registrations_xlsx_data", {
    _event_id: crypto.randomUUID(),
    _filters: {}
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  // Should return NOT_FOUND or NOT_AUTHORIZED
  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND" || data?.error === "FORBIDDEN",
    `Expected auth error, got: ${JSON.stringify(data)}`
  );
});

// Test 12: RPC bulk_checkin_participants exists
await test("RPC bulk_checkin_participants exists", async () => {
  const { data, error } = await supabase.rpc("bulk_checkin_participants", {
    _event_id: crypto.randomUUID(),
    _ticket_instance_ids: []
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND",
    `Expected auth error, got: ${JSON.stringify(data)}`
  );
});

// Test 13: Excel export requires admin role
await test("Excel export requires authorization", async () => {
  const { data } = await supabase.rpc("export_registrations_xlsx_data", {
    _event_id: crypto.randomUUID(),
    _filters: {}
  });

  assert(
    data?.error !== undefined,
    "Anonymous should be blocked from export"
  );
});

// Test 14: Bulk check-in requires org membership
await test("Bulk check-in requires authorization", async () => {
  const { data } = await supabase.rpc("bulk_checkin_participants", {
    _event_id: crypto.randomUUID(),
    _ticket_instance_ids: [crypto.randomUUID()]
  });

  assert(
    data?.error === "NOT_AUTHORIZED" || data?.error === "NOT_FOUND",
    "Anonymous should be blocked from bulk check-in"
  );
});

// Test 15: Excel export response structure
await test("Excel export response has correct error structure", async () => {
  const { data } = await supabase.rpc("export_registrations_xlsx_data", {
    _event_id: crypto.randomUUID(),
    _filters: {}
  });

  assert(
    typeof data === "object" && data !== null,
    "Response should be an object"
  );
  assert(
    "error" in data || "rows" in data,
    "Response should have error or rows field"
  );
});

// Test 16: Bulk check-in response structure
await test("Bulk check-in response has correct error structure", async () => {
  const { data } = await supabase.rpc("bulk_checkin_participants", {
    _event_id: crypto.randomUUID(),
    _ticket_instance_ids: []
  });

  assert(
    typeof data === "object" && data !== null,
    "Response should be an object"
  );
  assert(
    "error" in data || "success_count" in data,
    "Response should have error or success_count field"
  );
});

// === SUMMARY ===
console.log("\n" + "=".repeat(50));
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log("=".repeat(50));

process.exit(failed > 0 ? 1 : 0);
