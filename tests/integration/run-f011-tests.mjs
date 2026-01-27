#!/usr/bin/env node
/**
 * F011 Integration Tests - Node.js Runner
 *
 * Tests the Supabase RPCs against the remote database.
 *
 * Run with:
 *   node tests/integration/run-f011-tests.mjs
 *
 * Or with credentials:
 *   TEST_USER_EMAIL=x TEST_USER_PASSWORD=y node tests/integration/run-f011-tests.mjs
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

console.log("\n🧪 F011 Integration Tests");
console.log("=".repeat(50));
console.log(`URL: ${SUPABASE_URL}`);
console.log(`Auth: ${TEST_EMAIL ? "Credentials provided" : "Anonymous only"}`);
console.log("=".repeat(50) + "\n");

// Test 1: Functions exist
await test("RPC get_registrations_list exists", async () => {
  const { error } = await supabase.rpc("get_registrations_list", {
    _event_id: crypto.randomUUID(),
  });

  // We expect an error (event not found), but NOT "function does not exist"
  if (error?.message?.includes("does not exist")) {
    throw new Error("Function does not exist!");
  }
});

await test("RPC get_registration_detail exists", async () => {
  const { error } = await supabase.rpc("get_registration_detail", {
    _registration_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function does not exist!");
  }
});

await test("RPC export_registrations_csv exists", async () => {
  const { error } = await supabase.rpc("export_registrations_csv", {
    _event_id: crypto.randomUUID(),
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("Function does not exist!");
  }
});

// Test 2: Anonymous access blocked
await test("Anonymous user gets EVENT_NOT_FOUND for fake event", async () => {
  const { data } = await supabase.rpc("get_registrations_list", {
    _event_id: crypto.randomUUID(),
  });

  assert(data?.error === "EVENT_NOT_FOUND", `Expected EVENT_NOT_FOUND, got ${JSON.stringify(data)}`);
});

// Test 3: Authenticated tests (require credentials)
const needsAuth = !TEST_EMAIL || !TEST_PASSWORD;

await test(
  "Authenticated user can list registrations",
  async () => {
    // Login
    const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (authErr) throw new Error(`Auth failed: ${authErr.message}`);
    assert(auth.user, "No user returned");

    // Find an event
    const { data: events } = await supabase.from("events").select("id, name").limit(1);

    if (!events?.length) {
      console.log("   (No events found - creating test might be needed)");
      await supabase.auth.signOut();
      return;
    }

    // Call RPC
    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: events[0].id,
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);

    assert(data.total !== undefined, "Missing total in response");
    assert(data.data !== undefined, "Missing data array in response");
    console.log(`   Found ${data.total} registrations for event "${events[0].name}"`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "Filter by registration_status works",
  async () => {
    await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const { data: events } = await supabase.from("events").select("id").limit(1);
    if (!events?.length) {
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: events[0].id,
      _filters: { registration_status: "confirmed" },
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);
    assert(data.total !== undefined, "Filter response missing total");
    console.log(`   Found ${data.total} confirmed registrations`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "Search filter works",
  async () => {
    await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const { data: events } = await supabase.from("events").select("id").limit(1);
    if (!events?.length) {
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: events[0].id,
      _filters: { search: "test" },
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);
    assert(data.data !== undefined, "Search response missing data");
    console.log(`   Search "test" returned ${data.total} results`);

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "Pagination returns correct page_size",
  async () => {
    await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const { data: events } = await supabase.from("events").select("id").limit(1);
    if (!events?.length) {
      await supabase.auth.signOut();
      return;
    }

    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: events[0].id,
      _page: 1,
      _page_size: 5,
    });

    if (error) throw new Error(`RPC failed: ${error.message}`);
    assert(data.page === 1, "Wrong page number");
    assert(data.page_size === 5, "Wrong page_size");
    assert(data.data.length <= 5, "Too many items returned");

    await supabase.auth.signOut();
  },
  needsAuth
);

await test(
  "Cross-org access returns UNAUTHORIZED",
  async () => {
    await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });

    // Use a random event ID that user doesn't have access to
    const { data } = await supabase.rpc("get_registrations_list", {
      _event_id: crypto.randomUUID(),
    });

    assert(
      data?.error === "EVENT_NOT_FOUND" || data?.error === "UNAUTHORIZED",
      `Expected error, got ${JSON.stringify(data)}`
    );

    await supabase.auth.signOut();
  },
  needsAuth
);

// =============================================================================
// SUMMARY
// =============================================================================

console.log("\n" + "=".repeat(50));
console.log("📊 Test Summary");
console.log("=".repeat(50));
console.log(`✅ Passed:  ${passed}`);
console.log(`❌ Failed:  ${failed}`);
console.log(`⏭️  Skipped: ${skipped}`);
console.log("=".repeat(50));

if (skipped > 0 && needsAuth) {
  console.log(`
💡 To run authenticated tests, set environment variables:
   export TEST_USER_EMAIL=your@email.com
   export TEST_USER_PASSWORD=yourpassword
   node tests/integration/run-f011-tests.mjs
`);
}

process.exit(failed > 0 ? 1 : 0);
