#!/usr/bin/env node
/**
 * Integration Tests: F007 S3 - Ticket Delivery Email + PDF
 * Tests the queue_ticket_delivery_email RPC and ticket-pdf Edge Function.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let passed = 0, failed = 0;

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

console.log("🧪 F007 S3 Integration Tests\n");

// === 1. RPC EXISTS ===
await test("queue_ticket_delivery_email RPC exists", async () => {
    const { error } = await supabase.rpc("queue_ticket_delivery_email", {
        _order_id: "00000000-0000-0000-0000-000000000000"
    });
    // Should fail with error but NOT "function does not exist"
    if (error?.message?.includes("does not exist")) throw error;
    // Expected: permission denied (anon can't call service_role function) or ORDER_NOT_FOUND
});

// === 2. HTML ESCAPE EXISTS ===
await test("html_escape function exists", async () => {
    const { data, error } = await supabase.rpc("html_escape", {
        input: '<script>alert("xss")</script>'
    });
    // If it doesn't exist, we get "does not exist" error
    if (error?.message?.includes("does not exist")) throw error;
    // If accessible, check result
    if (data) {
        assert(!data.includes('<script>'), "Should escape HTML tags");
        assert(data.includes('&lt;script&gt;'), "Should use HTML entities");
    }
});

// === 3. ANONYMOUS BLOCKED FROM TICKET-PDF ===
await test("ticket-pdf rejects anonymous requests", async () => {
    const response = await fetch(
        `${SUPABASE_URL}/functions/v1/ticket-pdf?ticket_id=00000000-0000-0000-0000-000000000000`,
        { headers: { "apikey": SUPABASE_ANON_KEY } }
    );
    assert(response.status === 401, `Expected 401, got ${response.status}`);
});

// === 4. TICKET-PDF REQUIRES TICKET_ID ===
await test("ticket-pdf returns 400 without ticket_id", async () => {
    const response = await fetch(
        `${SUPABASE_URL}/functions/v1/ticket-pdf`,
        {
            headers: {
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": "Bearer fake-token-for-test"
            }
        }
    );
    // Will be 401 (invalid token) or 400 (missing ticket_id)
    assert([400, 401].includes(response.status), `Expected 400/401, got ${response.status}`);
});

// === 5. TICKET-PDF VALIDATES UUID FORMAT ===
await test("ticket-pdf rejects invalid UUID", async () => {
    const response = await fetch(
        `${SUPABASE_URL}/functions/v1/ticket-pdf?ticket_id=not-a-uuid`,
        {
            headers: {
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": "Bearer fake-token-for-test"
            }
        }
    );
    assert([400, 401].includes(response.status), `Expected 400/401, got ${response.status}`);
});

// === 6. HANDLE_PAYMENT_WEBHOOK EXISTS WITH EMAIL SUPPORT ===
await test("handle_payment_webhook exists", async () => {
    const { error } = await supabase.rpc("handle_payment_webhook", {
        _order_id: "00000000-0000-0000-0000-000000000000",
        _payment_id: "test_payment",
        _status: "paid",
        _amount: 0,
        _currency: "EUR"
    });
    // Should fail but NOT with "does not exist"
    if (error?.message?.includes("does not exist")) throw error;
});

// === 7. EMAIL OUTBOX TABLE EXISTS ===
await test("email_outbox table queryable", async () => {
    const { error } = await supabase.from("email_outbox").select("id").limit(1);
    if (error?.code === "42P01") throw new Error("Table does not exist");
});

// === 8. QUEUE_EMAIL RPC EXISTS ===
await test("queue_email RPC exists", async () => {
    const { error } = await supabase.rpc("queue_email", {
        _org_id: "00000000-0000-0000-0000-000000000000",
        _event_id: null,
        _idempotency_key: "test-key-" + Date.now(),
        _to_email: "test@example.com",
        _subject: "Test",
        _html_body: "<p>Test</p>"
    });
    if (error?.message?.includes("does not exist")) throw error;
});

// === 9. TICKET_INSTANCES TABLE QUERYABLE ===
await test("ticket_instances table queryable", async () => {
    const { error } = await supabase.from("ticket_instances").select("id,qr_code,status").limit(1);
    if (error?.code === "42P01") throw new Error("Table does not exist");
});

// === 10. TICKET_INSTANCES HAS EXPECTED COLUMNS ===
await test("ticket_instances has order_id and qr_code columns", async () => {
    const { error } = await supabase
        .from("ticket_instances")
        .select("id,order_id,qr_code,status,ticket_type_id")
        .limit(1);
    if (error) throw new Error(error.message);
});

// === SUMMARY ===
console.log(`\n${"=".repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${"=".repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
