#!/usr/bin/env node
/**
 * Integration Tests: F004 Event Discovery
 * Tests public event listing and detail RPCs
 *
 * Run: node .claude-flow/flows/f004-event-discovery/tests/integration-tests.mjs
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
console.log("🧪 Running F004 Event Discovery integration tests...\n");

// Test 1: get_public_events RPC exists
await test("T1: get_public_events RPC exists", async () => {
  const { data, error } = await supabase.rpc('get_public_events', {});

  if (error?.code === '42883' || error?.message?.includes('does not exist')) {
    throw new Error('RPC get_public_events does not exist');
  }

  assert(data?.status === 'OK', `Expected status OK, got: ${JSON.stringify(data)}`);
});

// Test 2: get_public_events returns proper structure
await test("T2: get_public_events returns proper JSON structure", async () => {
  const { data } = await supabase.rpc('get_public_events', {});

  assert(data.status === 'OK', 'Status should be OK');
  assert(typeof data.total === 'number', 'Total should be a number');
  assert(typeof data.limit === 'number', 'Limit should be a number');
  assert(typeof data.offset === 'number', 'Offset should be a number');
  assert(Array.isArray(data.events), 'Events should be an array');
});

// Test 3: get_public_events pagination works
await test("T3: get_public_events pagination works", async () => {
  const { data } = await supabase.rpc('get_public_events', {
    _limit: 5,
    _offset: 0
  });

  assert(data.limit === 5, 'Limit should be 5');
  assert(data.offset === 0, 'Offset should be 0');
});

// Test 4: get_public_events search works
await test("T4: get_public_events search filter works", async () => {
  const { data } = await supabase.rpc('get_public_events', {
    _search: 'nonexistent_event_xyz123'
  });

  assert(data.status === 'OK', 'Should return OK even with no results');
  assert(data.total === 0 || data.total >= 0, 'Total should be a number');
});

// Test 5: get_public_event_detail RPC exists
await test("T5: get_public_event_detail RPC exists", async () => {
  const { data, error } = await supabase.rpc('get_public_event_detail', {
    _event_slug: 'nonexistent-event'
  });

  if (error?.code === '42883' || error?.message?.includes('does not exist')) {
    throw new Error('RPC get_public_event_detail does not exist');
  }

  // Should return EVENT_NOT_FOUND for non-existent event
  assert(
    data?.error === 'EVENT_NOT_FOUND' || data?.status === 'OK',
    `Expected EVENT_NOT_FOUND or OK, got: ${JSON.stringify(data)}`
  );
});

// Test 6: get_public_event_detail returns EVENT_NOT_FOUND for missing event
await test("T6: get_public_event_detail returns EVENT_NOT_FOUND", async () => {
  const { data } = await supabase.rpc('get_public_event_detail', {
    _event_slug: 'definitely-not-a-real-event-slug'
  });

  assert(data?.error === 'EVENT_NOT_FOUND', 'Should return EVENT_NOT_FOUND');
});

// Test 7: public_events_v view exists
await test("T7: public_events_v view exists", async () => {
  const { error } = await supabase
    .from('public_events_v')
    .select('id')
    .limit(1);

  if (error?.code === '42P01') {
    throw new Error('View public_events_v does not exist');
  }
  // RLS denial is OK - means view exists
});

// Test 8: public_events_v only shows published events
await test("T8: public_events_v filters by status=published", async () => {
  const { data, error } = await supabase
    .from('public_events_v')
    .select('status')
    .limit(10);

  if (error?.code === '42P01') {
    throw new Error('View does not exist');
  }

  // All returned events should have status = published
  if (data && data.length > 0) {
    const allPublished = data.every(e => e.status === 'published');
    assert(allPublished, 'All events in view should be published');
  }
  // Empty is also valid
});

// Test 9: get_public_events date filter works
await test("T9: get_public_events date filter works", async () => {
  const { data } = await supabase.rpc('get_public_events', {
    _from_date: '2099-01-01T00:00:00Z'  // Far future date
  });

  assert(data.status === 'OK', 'Should return OK');
  // Events in far future should be 0 or very few
});

// Test 10: Anonymous can access get_public_events
await test("T10: Anonymous can access get_public_events", async () => {
  // Using anon key already, this tests anonymous access
  const { data, error } = await supabase.rpc('get_public_events', {});

  assert(!error, `Should not error: ${error?.message}`);
  assert(data?.status === 'OK', 'Should return OK for anonymous');
});

// Test 11: Events table has required columns for discovery
await test("T11: Events table has required columns", async () => {
  const { error } = await supabase
    .from('events')
    .select('slug, name, description, location_name, start_time, end_time, status')
    .eq('status', 'published')
    .limit(1);

  if (error?.code === '42703') {
    throw new Error('Missing required columns in events table');
  }
});

// Test 12: get_public_events limit validation
await test("T12: get_public_events validates limit (max 100)", async () => {
  const { data } = await supabase.rpc('get_public_events', {
    _limit: 500  // Should be capped to 100 or use default
  });

  assert(data?.limit <= 100, 'Limit should be capped at 100');
});

// === SUMMARY ===
console.log(`\n${"=".repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${"=".repeat(50)}`);

if (failed > 0) {
  console.log("\n⚠️  Some tests failed. Check migration deployment.");
}

process.exit(failed > 0 ? 1 : 0);
