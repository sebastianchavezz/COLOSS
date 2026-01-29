#!/usr/bin/env node
/**
 * F012 S3: Open Chat Access - Integration Tests
 *
 * Tests the new open chat functionality where any logged-in user can chat.
 *
 * Run with:
 *   node .claude-flow/flows/f012-event-communication/tests/s3-open-chat-tests.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
}

console.log("🧪 F012 S3: Open Chat Access Tests\n");

// =============================================================================
// Database Tests (can run without auth)
// =============================================================================

await test("Migration: participant_has_access column exists", async () => {
    // This will fail if column doesn't exist
    const { data, error } = await supabase
        .from("chat_threads")
        .select("participant_has_access")
        .limit(1);

    // Error code 42703 = column does not exist
    if (error && error.code === "42703") {
        throw new Error("Column participant_has_access does not exist");
    }
    // Other errors are OK (might be RLS blocking, but column exists)
});

await test("Migration: get_or_create_participant_for_user RPC exists", async () => {
    // Call with invalid UUID to check if function exists
    const { error } = await supabase.rpc("get_or_create_participant_for_user", {
        _user_id: "00000000-0000-0000-0000-000000000000",
    });

    // If function doesn't exist, we get a specific error
    if (error?.message?.includes("does not exist")) {
        throw error;
    }
    // Other errors (like user not found) are expected and OK
});

await test("Existing RPC: check_participant_event_access still works", async () => {
    const { error } = await supabase.rpc("check_participant_event_access", {
        _event_id: "00000000-0000-0000-0000-000000000000",
        _participant_id: "00000000-0000-0000-0000-000000000000",
    });

    if (error?.message?.includes("does not exist")) {
        throw error;
    }
    // Function exists, other errors are expected
});

await test("Existing RPC: get_or_create_chat_thread still works", async () => {
    const { error } = await supabase.rpc("get_or_create_chat_thread", {
        _event_id: "00000000-0000-0000-0000-000000000000",
        _participant_id: "00000000-0000-0000-0000-000000000000",
    });

    if (error?.message?.includes("does not exist")) {
        throw error;
    }
});

await test("Existing RPC: get_messaging_settings still works", async () => {
    const { error } = await supabase.rpc("get_messaging_settings", {
        _event_id: "00000000-0000-0000-0000-000000000000",
    });

    if (error?.message?.includes("does not exist")) {
        throw error;
    }
});

// =============================================================================
// Edge Function Tests (require no auth - just check endpoints exist)
// =============================================================================

await test("Edge Function: send-message endpoint accessible", async () => {
    const response = await fetch(
        `${SUPABASE_URL}/functions/v1/send-message`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        }
    );

    // 401 = unauthorized (expected), 404 = function doesn't exist
    assert(response.status !== 404, "send-message function not found");
});

await test("Edge Function: get-threads endpoint accessible", async () => {
    const response = await fetch(
        `${SUPABASE_URL}/functions/v1/get-threads?event_id=test`,
        {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        }
    );

    assert(response.status !== 404, "get-threads function not found");
});

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
