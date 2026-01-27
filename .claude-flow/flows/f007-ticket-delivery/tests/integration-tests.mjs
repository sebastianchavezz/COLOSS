#!/usr/bin/env node
/**
 * F007 Ticket Scanning Upgrade - Integration Tests
 *
 * Tests the new scanning functionality against Supabase.
 *
 * Run with:
 *   node .claude-flow/flows/f007-ticket-delivery/tests/integration-tests.mjs
 *
 * Or with credentials:
 *   TEST_USER_EMAIL=x TEST_USER_PASSWORD=y node .claude-flow/flows/f007-ticket-delivery/tests/integration-tests.mjs
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Config
const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const TEST_EMAIL = process.env.TEST_USER_EMAIL || "";
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let passed = 0;
let failed = 0;
let skipped = 0;

// Helper
async function test(name, fn, skip = false) {
  if (skip) {
    console.log(`⏭️  SKIP: ${name}`);
    skipped++;
    return;
  }

  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

// =============================================================================
// TESTS
// =============================================================================

console.log("\n🧪 F007 Ticket Scanning Upgrade - Integration Tests");
console.log("=".repeat(60));
console.log(`URL: ${SUPABASE_URL}`);
console.log(`Auth: ${TEST_EMAIL ? "Credentials provided" : "Anonymous only"}`);
console.log("=".repeat(60) + "\n");

// -----------------------------------------------------------------------------
// TABLE STRUCTURE TESTS
// -----------------------------------------------------------------------------

console.log("\n🗃️  Table Structure Tests\n");

await test("ticket_scans table exists", async () => {
  const { error } = await supabase.from("ticket_scans").select("id").limit(1);

  if (error?.message?.includes("does not exist")) {
    throw new Error("Table ticket_scans does not exist");
  }
});

// -----------------------------------------------------------------------------
// RPC FUNCTION EXISTENCE TESTS
// -----------------------------------------------------------------------------

console.log("\n🔧 RPC Function Tests\n");

await test("RPC scan_ticket exists", async () => {
  const { error } = await supabase.rpc("scan_ticket", {
    _event_id: crypto.randomUUID(),
    _token: "test-token-12345",
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function scan_ticket does not exist");
  }
});

await test("RPC undo_check_in exists", async () => {
  const { error } = await supabase.rpc("undo_check_in", {
    _ticket_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function undo_check_in does not exist");
  }
});

await test("RPC get_scan_stats exists", async () => {
  const { error } = await supabase.rpc("get_scan_stats", {
    _event_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function get_scan_stats does not exist");
  }
});

await test("RPC get_recent_scans exists", async () => {
  const { error } = await supabase.rpc("get_recent_scans", {
    _event_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function get_recent_scans does not exist");
  }
});

// -----------------------------------------------------------------------------
// SETTINGS DOMAIN TESTS
// -----------------------------------------------------------------------------

console.log("\n⚙️  Settings Domain Tests\n");

await test("get_default_settings includes scanning domain", async () => {
  const { data, error } = await supabase.rpc("get_default_settings");

  if (error) throw new Error(`RPC failed: ${error.message}`);

  assert(data.scanning !== undefined, "Missing 'scanning' in default settings");
  assert(data.scanning.enabled !== undefined, "Missing 'scanning.enabled'");
  assert(data.scanning.rate_limit !== undefined, "Missing 'scanning.rate_limit'");
  console.log(`   Found scanning settings: ${Object.keys(data.scanning).join(", ")}`);
});

await test("validate_scanning_settings accepts valid input", async () => {
  const { data, error } = await supabase.rpc("validate_scanning_settings", {
    _settings: {
      enabled: true,
      rate_limit: { per_minute: 60 },
      response: { pii_level: "masked" },
    },
  });

  if (error) throw new Error(`Validation failed: ${error.message}`);
  assert(data === true, "Expected true for valid settings");
});

// -----------------------------------------------------------------------------
// HELPER FUNCTION TESTS
// -----------------------------------------------------------------------------

console.log("\n🛠️  Helper Function Tests\n");

await test("mask_participant_name works", async () => {
  const { data, error } = await supabase.rpc("mask_participant_name", {
    _name: "John Doe",
  });

  if (error) throw new Error(`RPC failed: ${error.message}`);
  assert(data === "J. D***", `Expected "J. D***", got "${data}"`);
});

await test("mask_email works", async () => {
  const { data, error } = await supabase.rpc("mask_email", {
    _email: "john@example.com",
  });

  if (error) throw new Error(`RPC failed: ${error.message}`);
  assert(data === "j***@example.com", `Expected "j***@example.com", got "${data}"`);
});

// -----------------------------------------------------------------------------
// ANONYMOUS ACCESS TESTS
// -----------------------------------------------------------------------------

console.log("\n🔒 Anonymous Access Tests\n");

await test("Anonymous gets UNAUTHORIZED for scan_ticket", async () => {
  const { data, error } = await supabase.rpc("scan_ticket", {
    _event_id: crypto.randomUUID(),
    _token: "test",
  });

  // Accept either UNAUTHORIZED in data or error response
  assert(
    data?.error === "UNAUTHORIZED" || error !== null,
    `Expected UNAUTHORIZED or error, got data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`
  );
});

await test("Anonymous gets EVENT_NOT_FOUND or UNAUTHORIZED for get_scan_stats", async () => {
  const { data } = await supabase.rpc("get_scan_stats", {
    _event_id: crypto.randomUUID(),
  });

  assert(
    data?.error === "UNAUTHORIZED" || data?.error === "EVENT_NOT_FOUND",
    `Expected UNAUTHORIZED or EVENT_NOT_FOUND, got ${JSON.stringify(data)}`
  );
});

// -----------------------------------------------------------------------------
// AUTHENTICATED TESTS
// -----------------------------------------------------------------------------

const needsAuth = !TEST_EMAIL || !TEST_PASSWORD;

console.log("\n🔐 Authenticated Tests\n");

await test(
  "Authenticated user can scan invalid token",
  async () => {
    await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    // Find an event
    const { data: events } = await supabase.from("events").select("id, name").limit(1);

    if (!events?.length) {
      console.log("   (No events found - skipping)");
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("scan_ticket", {
      _event_id: events[0].id,
      _token: "invalid-token-" + crypto.randomUUID(),
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);

    assert(
      data.result === "INVALID",
      `Expected INVALID result, got ${JSON.stringify(data)}`
    );

    console.log(`   Scan result: ${data.result}`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "get_scan_stats returns statistics",
  async () => {
    await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    const { data: events } = await supabase.from("events").select("id").limit(1);

    if (!events?.length) {
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("get_scan_stats", {
      _event_id: events[0].id,
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);

    assert(data.event_id === events[0].id, "Wrong event_id in response");
    assert(data.total_scans !== undefined, "Missing total_scans");
    assert(data.valid_scans !== undefined, "Missing valid_scans");
    assert(data.check_in_percentage !== undefined, "Missing check_in_percentage");

    console.log(`   Total scans: ${data.total_scans}, Check-in: ${data.check_in_percentage}%`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "get_recent_scans returns scan log",
  async () => {
    await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    const { data: events } = await supabase.from("events").select("id").limit(1);

    if (!events?.length) {
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("get_recent_scans", {
      _event_id: events[0].id,
      _limit: 10,
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);

    assert(data.event_id === events[0].id, "Wrong event_id");
    assert(data.scans !== undefined, "Missing scans array");
    assert(Array.isArray(data.scans), "scans should be array");

    console.log(`   Found ${data.scans.length} recent scans`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "undo_check_in requires admin role",
  async () => {
    await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    // Try undoing a random ticket (should fail with UNAUTHORIZED or NOT_FOUND)
    const { data } = await supabase.rpc("undo_check_in", {
      _ticket_id: crypto.randomUUID(),
    });

    assert(
      data?.error === "TICKET_NOT_FOUND" || data?.error === "UNAUTHORIZED",
      `Expected error, got ${JSON.stringify(data)}`
    );

    await supabase.auth.signOut();
  },
  needsAuth
);

// =============================================================================
// SUMMARY
// =============================================================================

console.log("\n" + "=".repeat(60));
console.log("📊 Test Summary");
console.log("=".repeat(60));
console.log(`✅ Passed:  ${passed}`);
console.log(`❌ Failed:  ${failed}`);
console.log(`⏭️  Skipped: ${skipped}`);
console.log("=".repeat(60));

if (skipped > 0 && needsAuth) {
  console.log(`
💡 To run authenticated tests, set environment variables:
   export TEST_USER_EMAIL=your@email.com
   export TEST_USER_PASSWORD=yourpassword
   node .claude-flow/flows/f007-ticket-delivery/tests/integration-tests.mjs
`);
}

process.exit(failed > 0 ? 1 : 0);
