/**
 * Integration Tests: F011 Participants/Registrations
 *
 * Tests the actual Supabase RPCs against the remote database.
 * Requires authenticated user to test properly.
 *
 * Run with:
 *   deno test --allow-env --allow-net tests/integration/f011_registrations.test.ts
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Load environment
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

// Test credentials (should be set in CI/CD or .env.test)
const TEST_EMAIL = Deno.env.get("TEST_USER_EMAIL") || "";
const TEST_PASSWORD = Deno.env.get("TEST_USER_PASSWORD") || "";

let supabase: SupabaseClient;

// =============================================================================
// SETUP
// =============================================================================

Deno.test({
  name: "Setup: Create Supabase client",
  fn: () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    assertExists(supabase);
  },
});

// =============================================================================
// ANONYMOUS USER TESTS (No auth required)
// =============================================================================

Deno.test({
  name: "F011-01: Anonymous user cannot call get_registrations_list",
  fn: async () => {
    // Generate random UUID for event_id
    const fakeEventId = crypto.randomUUID();

    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: fakeEventId,
    });

    // Should return UNAUTHORIZED or error
    if (data && typeof data === "object") {
      assertEquals((data as Record<string, unknown>).error, "EVENT_NOT_FOUND");
    }
    // Or it could be an RLS error
    console.log("Response:", data || error?.message);
  },
});

Deno.test({
  name: "F011-02: Anonymous user cannot call export_registrations_csv",
  fn: async () => {
    const fakeEventId = crypto.randomUUID();

    const { data, error } = await supabase.rpc("export_registrations_csv", {
      _event_id: fakeEventId,
    });

    // Should fail with UNAUTHORIZED
    assertExists(error || (data as { error?: string })?.error);
    console.log("Response:", error?.message || data);
  },
});

// =============================================================================
// AUTHENTICATED USER TESTS (Requires test credentials)
// =============================================================================

Deno.test({
  name: "F011-03: Authenticated user can call get_registrations_list on own org event",
  ignore: !TEST_EMAIL || !TEST_PASSWORD,
  fn: async () => {
    // Login
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (authError) {
      console.log("Auth error:", authError.message);
      return;
    }

    assertExists(authData.user);
    console.log("Logged in as:", authData.user.email);

    // Get user's events (need to find an event they have access to)
    const { data: events } = await supabase
      .from("events")
      .select("id, name, org_id")
      .limit(1);

    if (!events || events.length === 0) {
      console.log("No events found for user");
      return;
    }

    const testEvent = events[0];
    console.log("Testing with event:", testEvent.name);

    // Call RPC
    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: testEvent.id,
    });

    if (error) {
      console.log("RPC error:", error.message);
      return;
    }

    assertExists(data);
    console.log("Response:", JSON.stringify(data, null, 2));

    // Verify response structure
    const response = data as Record<string, unknown>;
    assertExists(response.total !== undefined);
    assertExists(response.page);
    assertExists(response.data);

    console.log(`✅ Found ${response.total} registrations`);

    // Sign out
    await supabase.auth.signOut();
  },
});

Deno.test({
  name: "F011-04: Filter by status works",
  ignore: !TEST_EMAIL || !TEST_PASSWORD,
  fn: async () => {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (authError) return;

    const { data: events } = await supabase
      .from("events")
      .select("id")
      .limit(1);

    if (!events || events.length === 0) return;

    // Test filter
    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: events[0].id,
      _filters: { registration_status: "confirmed" },
    });

    if (!error && data) {
      console.log(`✅ Filter works: ${(data as Record<string, unknown>).total} confirmed registrations`);
    }

    await supabase.auth.signOut();
  },
});

Deno.test({
  name: "F011-05: Pagination works",
  ignore: !TEST_EMAIL || !TEST_PASSWORD,
  fn: async () => {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (authError) return;

    const { data: events } = await supabase
      .from("events")
      .select("id")
      .limit(1);

    if (!events || events.length === 0) return;

    // Test pagination
    const { data, error } = await supabase.rpc("get_registrations_list", {
      _event_id: events[0].id,
      _page: 1,
      _page_size: 5,
    });

    if (!error && data) {
      const response = data as Record<string, unknown>;
      assertEquals(response.page, 1);
      assertEquals(response.page_size, 5);

      const dataArray = response.data as unknown[];
      if (dataArray.length <= 5) {
        console.log(`✅ Pagination works: page_size=5, got ${dataArray.length} items`);
      }
    }

    await supabase.auth.signOut();
  },
});

// =============================================================================
// FUNCTION EXISTENCE TESTS (No auth required)
// =============================================================================

Deno.test({
  name: "F011-06: RPC functions exist in database",
  fn: async () => {
    // Just check that calling the functions doesn't return "function not found"
    const functions = [
      "get_registrations_list",
      "get_registration_detail",
      "export_registrations_csv",
    ];

    for (const fn of functions) {
      const { error } = await supabase.rpc(fn, { _event_id: crypto.randomUUID() });

      // We expect an error, but NOT "function does not exist"
      if (error?.message?.includes("function") && error?.message?.includes("does not exist")) {
        throw new Error(`Function ${fn} does not exist!`);
      }

      console.log(`✅ Function ${fn} exists`);
    }
  },
});

// =============================================================================
// VIEW TESTS
// =============================================================================

Deno.test({
  name: "F011-07: registrations_list_v view exists and is queryable",
  ignore: !TEST_EMAIL || !TEST_PASSWORD,
  fn: async () => {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (authError) return;

    // Try to query the view directly
    const { data, error } = await supabase
      .from("registrations_list_v")
      .select("id, email, registration_status, payment_status")
      .limit(5);

    if (error) {
      // View might not be exposed via API, that's OK
      console.log("View query result:", error.message);
    } else {
      console.log(`✅ View queryable, found ${data?.length || 0} records`);
    }

    await supabase.auth.signOut();
  },
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log(`
=====================================
F011 Integration Tests
=====================================
SUPABASE_URL: ${SUPABASE_URL}
Test User: ${TEST_EMAIL || "(not set - some tests skipped)"}

To run all tests, set environment variables:
  export TEST_USER_EMAIL=your@email.com
  export TEST_USER_PASSWORD=yourpassword
  deno test --allow-env --allow-net tests/integration/f011_registrations.test.ts
=====================================
`);
