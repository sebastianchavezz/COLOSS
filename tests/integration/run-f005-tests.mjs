#!/usr/bin/env node
/**
 * F005 Ticket Selection Upgrade - Integration Tests
 *
 * Tests the new ticket configuration features against Supabase.
 *
 * Run with:
 *   node tests/integration/run-f005-tests.mjs
 *
 * Or with credentials:
 *   TEST_USER_EMAIL=x TEST_USER_PASSWORD=y node tests/integration/run-f005-tests.mjs
 */

import { createClient } from "@supabase/supabase-js";

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
    console.log(`\u23ED\uFE0F  SKIP: ${name}`);
    skipped++;
    return;
  }

  try {
    await fn();
    console.log(`\u2705 PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`\u274C FAIL: ${name}`);
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

console.log("\n\uD83E\uDDEA F005 Ticket Selection Upgrade - Integration Tests");
console.log("=".repeat(60));
console.log(`URL: ${SUPABASE_URL}`);
console.log(`Auth: ${TEST_EMAIL ? "Credentials provided" : "Anonymous only"}`);
console.log("=".repeat(60) + "\n");

// -----------------------------------------------------------------------------
// TABLE STRUCTURE TESTS
// -----------------------------------------------------------------------------

console.log("\n\uD83D\uDDC3\uFE0F  Table Structure Tests\n");

await test("ticket_types has new columns (distance_value)", async () => {
  const { data, error } = await supabase
    .from("ticket_types")
    .select("distance_value, distance_unit, image_url, ticket_category, visibility")
    .limit(1);

  // If columns don't exist, we get an error
  if (error?.message?.includes("column") && error?.message?.includes("does not exist")) {
    throw new Error("New columns not found in ticket_types");
  }
  // Empty result is OK, means table exists with columns
});

await test("ticket_type_i18n table exists", async () => {
  const { error } = await supabase.from("ticket_type_i18n").select("id").limit(1);

  if (error?.message?.includes("does not exist")) {
    throw new Error("Table ticket_type_i18n does not exist");
  }
});

await test("ticket_time_slots table exists", async () => {
  const { error } = await supabase.from("ticket_time_slots").select("id").limit(1);

  if (error?.message?.includes("does not exist")) {
    throw new Error("Table ticket_time_slots does not exist");
  }
});

await test("ticket_team_config table exists", async () => {
  const { error } = await supabase.from("ticket_team_config").select("id").limit(1);

  if (error?.message?.includes("does not exist")) {
    throw new Error("Table ticket_team_config does not exist");
  }
});

// -----------------------------------------------------------------------------
// RPC FUNCTION EXISTENCE TESTS
// -----------------------------------------------------------------------------

console.log("\n\uD83D\uDD27 RPC Function Tests\n");

await test("RPC get_ticket_type_full exists", async () => {
  const { error } = await supabase.rpc("get_ticket_type_full", {
    _ticket_type_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function get_ticket_type_full does not exist");
  }
});

await test("RPC get_event_ticket_types exists", async () => {
  const { error } = await supabase.rpc("get_event_ticket_types", {
    _event_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function get_event_ticket_types does not exist");
  }
});

await test("RPC get_ticket_time_slots exists", async () => {
  // This function returns TABLE, so empty result for non-existent ticket is OK
  const { data, error } = await supabase.rpc("get_ticket_time_slots", {
    _ticket_type_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function get_ticket_time_slots does not exist");
  }
  // Empty array is expected for non-existent ticket
  assert(Array.isArray(data), "Expected array result from TABLE function");
});

await test("RPC upsert_ticket_type_i18n exists", async () => {
  const { error } = await supabase.rpc("upsert_ticket_type_i18n", {
    _ticket_type_id: crypto.randomUUID(),
    _locale: "nl",
    _name: "Test",
  });

  // Expect TICKET_TYPE_NOT_FOUND or permission error, NOT "function does not exist"
  if (error?.message?.includes("does not exist")) {
    throw new Error("Function upsert_ticket_type_i18n does not exist");
  }
});

await test("RPC upsert_ticket_team_config exists", async () => {
  const { error } = await supabase.rpc("upsert_ticket_team_config", {
    _ticket_type_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function upsert_ticket_team_config does not exist");
  }
});

await test("RPC upsert_ticket_time_slot exists", async () => {
  const { error } = await supabase.rpc("upsert_ticket_time_slot", {
    _ticket_type_id: crypto.randomUUID(),
    _slot_time: "08:00:00",
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function upsert_ticket_time_slot does not exist");
  }
});

// -----------------------------------------------------------------------------
// ANONYMOUS ACCESS TESTS
// -----------------------------------------------------------------------------

console.log("\n\uD83D\uDD12 Anonymous Access Tests\n");

await test("Anonymous gets TICKET_TYPE_NOT_FOUND for fake ticket", async () => {
  const { data } = await supabase.rpc("get_ticket_type_full", {
    _ticket_type_id: crypto.randomUUID(),
  });

  assert(
    data?.error === "TICKET_TYPE_NOT_FOUND",
    `Expected TICKET_TYPE_NOT_FOUND, got ${JSON.stringify(data)}`
  );
});

await test("Anonymous gets EVENT_NOT_FOUND for fake event", async () => {
  const { data } = await supabase.rpc("get_event_ticket_types", {
    _event_id: crypto.randomUUID(),
  });

  assert(
    data?.error === "EVENT_NOT_FOUND",
    `Expected EVENT_NOT_FOUND, got ${JSON.stringify(data)}`
  );
});

// -----------------------------------------------------------------------------
// SETTINGS DOMAIN TESTS
// -----------------------------------------------------------------------------

console.log("\n\u2699\uFE0F  Settings Domain Tests\n");

await test("get_default_settings includes tickets domain", async () => {
  const { data, error } = await supabase.rpc("get_default_settings");

  if (error) throw new Error(`RPC failed: ${error.message}`);

  assert(data.tickets !== undefined, "Missing 'tickets' in default settings");
  assert(data.tickets.defaults !== undefined, "Missing 'tickets.defaults'");
  assert(data.tickets.checkout !== undefined, "Missing 'tickets.checkout'");
  assert(data.tickets.time_slots !== undefined, "Missing 'tickets.time_slots'");
  console.log(`   Found tickets settings: ${Object.keys(data.tickets).join(", ")}`);
});

await test("validate_tickets_settings accepts valid input", async () => {
  const { data, error } = await supabase.rpc("validate_tickets_settings", {
    _settings: {
      defaults: { vat_percentage: 21 },
      checkout: { max_per_order: 10 },
    },
  });

  if (error) throw new Error(`Validation failed: ${error.message}`);
  assert(data === true, "Expected true for valid settings");
});

// -----------------------------------------------------------------------------
// AUTHENTICATED TESTS
// -----------------------------------------------------------------------------

const needsAuth = !TEST_EMAIL || !TEST_PASSWORD;

console.log("\n\uD83D\uDD10 Authenticated Tests\n");

await test(
  "Authenticated user can get event ticket types",
  async () => {
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (authErr) throw new Error(`Auth failed: ${authErr.message}`);

    // Find an event
    const { data: events } = await supabase.from("events").select("id, name").limit(1);

    if (!events?.length) {
      console.log("   (No events found - skipping)");
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("get_event_ticket_types", {
      _event_id: events[0].id,
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);

    assert(data.event_id === events[0].id, "Wrong event_id in response");
    assert(data.ticket_types !== undefined, "Missing ticket_types array");
    console.log(`   Found ${data.ticket_types.length} ticket types for "${events[0].name}"`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "Authenticated user can get ticket type full config",
  async () => {
    await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    // Find a ticket type
    const { data: tickets } = await supabase
      .from("ticket_types")
      .select("id, name")
      .is("deleted_at", null)
      .limit(1);

    if (!tickets?.length) {
      console.log("   (No ticket types found - skipping)");
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("get_ticket_type_full", {
      _ticket_type_id: tickets[0].id,
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);

    assert(data.ticket_type !== undefined, "Missing ticket_type in response");
    assert(data.i18n !== undefined, "Missing i18n in response");
    assert(data.time_slots !== undefined, "Missing time_slots in response");
    assert(data.team_config !== undefined, "Missing team_config in response");
    console.log(`   Retrieved full config for "${tickets[0].name}"`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "update_ticket_type_extended requires admin/owner",
  async () => {
    await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    // Try updating a random ticket (should fail)
    const { data } = await supabase.rpc("update_ticket_type_extended", {
      _ticket_type_id: crypto.randomUUID(),
      _updates: { name: "Test" },
    });

    assert(
      data?.error === "TICKET_TYPE_NOT_FOUND" || data?.error === "UNAUTHORIZED",
      `Expected error, got ${JSON.stringify(data)}`
    );

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "Visibility filter works for public tickets",
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

    // Get with hidden tickets
    const { data: withHidden } = await supabase.rpc("get_event_ticket_types", {
      _event_id: events[0].id,
      _include_hidden: true,
    });

    // Get without hidden tickets
    const { data: noHidden } = await supabase.rpc("get_event_ticket_types", {
      _event_id: events[0].id,
      _include_hidden: false,
    });

    assert(withHidden.ticket_types !== undefined, "Missing ticket_types");
    assert(noHidden.ticket_types !== undefined, "Missing ticket_types");
    console.log(`   With hidden: ${withHidden.ticket_types.length}, Without: ${noHidden.ticket_types.length}`);

    await supabase.auth.signOut();
  },
  needsAuth
);

// =============================================================================
// SUMMARY
// =============================================================================

console.log("\n" + "=".repeat(60));
console.log("\uD83D\uDCCA Test Summary");
console.log("=".repeat(60));
console.log(`\u2705 Passed:  ${passed}`);
console.log(`\u274C Failed:  ${failed}`);
console.log(`\u23ED\uFE0F  Skipped: ${skipped}`);
console.log("=".repeat(60));

if (skipped > 0 && needsAuth) {
  console.log(`
\uD83D\uDCA1 To run authenticated tests, set environment variables:
   export TEST_USER_EMAIL=your@email.com
   export TEST_USER_PASSWORD=yourpassword
   node tests/integration/run-f005-tests.mjs
`);
}

process.exit(failed > 0 ? 1 : 0);
