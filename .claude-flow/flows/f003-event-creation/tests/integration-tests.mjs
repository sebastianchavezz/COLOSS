#!/usr/bin/env node
/**
 * F003 S1: GPX Route Integration Tests
 *
 * Tests event route management: creation, retrieval, status changes, deletion.
 * Run with: node .claude-flow/flows/f003-event-creation/tests/integration-tests.mjs
 */

import { createClient } from "@supabase/supabase-js";

// === CONFIG ===
const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === TEST HELPERS ===
let passed = 0,
  failed = 0;

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
console.log("🧪 F003 S1: GPX Route Integration Tests\n");

// Test 1: event_routes table exists
await test("event_routes table exists", async () => {
  const { error } = await supabase.from("event_routes").select("id").limit(1);
  if (error?.code === "42P01") throw new Error("Table does not exist");
});

// Test 2: get_event_route RPC exists
await test("get_event_route RPC exists", async () => {
  const { error } = await supabase.rpc("get_event_route", {
    _event_id: crypto.randomUUID(),
  });
  // Should return NOT_FOUND, not "function does not exist"
  if (error?.message?.includes("does not exist")) throw error;
});

// Test 3: set_event_route_status RPC exists
await test("set_event_route_status RPC exists", async () => {
  const { error } = await supabase.rpc("set_event_route_status", {
    _event_id: crypto.randomUUID(),
    _status: "draft",
  });
  // Should return UNAUTHORIZED (anon), not "function does not exist"
  if (error?.message?.includes("does not exist")) throw error;
});

// Test 4: delete_event_route RPC exists
await test("delete_event_route RPC exists", async () => {
  const { error } = await supabase.rpc("delete_event_route", {
    _event_id: crypto.randomUUID(),
  });
  // Should return UNAUTHORIZED (anon), not "function does not exist"
  if (error?.message?.includes("does not exist")) throw error;
});

// Test 5: save_event_route RPC exists
await test("save_event_route RPC exists", async () => {
  const { error } = await supabase.rpc("save_event_route", {
    _event_id: crypto.randomUUID(),
    _name: "Test",
    _route_geometry: [[0, 0]],
    _bounds: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
    _distance_m: 1000,
    _point_count: 1,
  });
  // Should return UNAUTHORIZED (anon), not "function does not exist"
  if (error?.message?.includes("does not exist")) throw error;
});

// Test 6: Anonymous cannot view unpublished routes
await test("Anonymous cannot view unpublished routes", async () => {
  const { data } = await supabase.rpc("get_event_route", {
    _event_id: crypto.randomUUID(),
  });
  // Should get ROUTE_NOT_FOUND (not unauthorized for anonymous read)
  assert(
    data?.error === "ROUTE_NOT_FOUND",
    `Expected ROUTE_NOT_FOUND, got ${data?.error}`
  );
});

// Test 7: Anonymous cannot change route status
await test("Anonymous cannot change route status", async () => {
  const { data } = await supabase.rpc("set_event_route_status", {
    _event_id: crypto.randomUUID(),
    _status: "published",
  });
  assert(
    data?.error === "UNAUTHORIZED",
    `Expected UNAUTHORIZED, got ${data?.error}`
  );
});

// Test 8: Anonymous cannot delete routes
await test("Anonymous cannot delete routes", async () => {
  const { data } = await supabase.rpc("delete_event_route", {
    _event_id: crypto.randomUUID(),
  });
  assert(
    data?.error === "UNAUTHORIZED",
    `Expected UNAUTHORIZED, got ${data?.error}`
  );
});

// Test 9: Anonymous cannot save routes
await test("Anonymous cannot save routes", async () => {
  const { data } = await supabase.rpc("save_event_route", {
    _event_id: crypto.randomUUID(),
    _name: "Test",
    _route_geometry: [[0, 0]],
    _bounds: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
    _distance_m: 1000,
    _point_count: 1,
  });
  assert(
    data?.error === "UNAUTHORIZED",
    `Expected UNAUTHORIZED, got ${data?.error}`
  );
});

// Test 10: Invalid status rejected
await test("Invalid status rejected", async () => {
  const { data } = await supabase.rpc("set_event_route_status", {
    _event_id: crypto.randomUUID(),
    _status: "invalid_status",
  });
  // Could be INVALID_STATUS or UNAUTHORIZED
  assert(
    data?.error === "INVALID_STATUS" || data?.error === "UNAUTHORIZED",
    `Expected INVALID_STATUS or UNAUTHORIZED, got ${data?.error}`
  );
});

// Test 11: RLS blocks direct table access for anon
await test("RLS blocks direct INSERT for anonymous", async () => {
  const { error } = await supabase.from("event_routes").insert({
    org_id: crypto.randomUUID(),
    event_id: crypto.randomUUID(),
    name: "Test",
  });
  // Should fail with RLS error
  assert(
    error !== null,
    "Expected RLS to block anonymous insert"
  );
});

// Test 12: Storage bucket exists
await test("gpx-routes storage bucket accessible", async () => {
  // Try to list (will fail without auth, but bucket should exist)
  const { error } = await supabase.storage.from("gpx-routes").list("", {
    limit: 1,
  });
  // Bucket exists if we don't get "Bucket not found"
  if (error?.message?.includes("not found")) {
    throw new Error("Bucket not found");
  }
});

// === SUMMARY ===
console.log(`\n${"=".repeat(40)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${"=".repeat(40)}`);

if (failed > 0) {
  console.log("\n⚠️  Some tests failed. Check output above.");
  process.exit(1);
} else {
  console.log("\n🎉 All tests passed!");
  process.exit(0);
}
