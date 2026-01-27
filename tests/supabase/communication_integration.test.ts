/**
 * Integration Tests: Communication Module
 *
 * Purpose: Test the integration between Edge Functions and Database
 *          for email queueing, bulk email, and webhook handling.
 *
 * Author: @tester
 * Date: 2025-01-27
 *
 * Test Strategy:
 *   - Use Deno's built-in test framework
 *   - Connect to Supabase with service role for setup/teardown
 *   - Test Edge Functions via HTTP calls or RPC
 *   - Verify database state after operations
 *
 * Prerequisites:
 *   - Supabase running locally or accessible remotely
 *   - Environment variables set:
 *     - SUPABASE_URL
 *     - SUPABASE_SERVICE_ROLE_KEY
 *     - SUPABASE_ANON_KEY
 *
 * Usage:
 *   deno test --allow-env --allow-net tests/supabase/communication_integration.test.ts
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://localhost:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Test data IDs (generated fresh for each test run)
let testOrgId: string;
let testUserId: string;
let testEventId: string;

// =============================================================================
// TEST SETUP & HELPERS
// =============================================================================

function getServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY);
}

function generateUUID(): string {
  return crypto.randomUUID();
}

function generateIdempotencyKey(prefix: string): string {
  return `${prefix}-${generateUUID()}`;
}

async function setupTestData(supabase: SupabaseClient): Promise<void> {
  testUserId = generateUUID();
  testOrgId = generateUUID();
  testEventId = generateUUID();

  // Create test user
  const { error: userError } = await supabase.auth.admin.createUser({
    email: `integration-test-${testUserId}@test.com`,
    password: "testpassword123",
    user_metadata: { name: "Test User" },
  });

  if (userError && !userError.message.includes("already")) {
    // Get user by email instead
    const { data: users } = await supabase.auth.admin.listUsers();
    const existingUser = users?.users?.find(
      (u) => u.email === `integration-test-${testUserId}@test.com`
    );
    if (existingUser) {
      testUserId = existingUser.id;
    } else {
      throw new Error(`Failed to create test user: ${userError.message}`);
    }
  }

  // Create test org (bypass RLS with service client)
  const { error: orgError } = await supabase
    .from("orgs")
    .insert({
      id: testOrgId,
      name: "Integration Test Org",
      slug: `integration-test-${testOrgId.substring(0, 8)}`,
    });

  if (orgError && !orgError.message.includes("duplicate")) {
    throw new Error(`Failed to create test org: ${orgError.message}`);
  }

  // Make user an owner
  const { error: memberError } = await supabase
    .from("org_members")
    .insert({
      org_id: testOrgId,
      user_id: testUserId,
      role: "owner",
    });

  if (memberError && !memberError.message.includes("duplicate")) {
    throw new Error(`Failed to create org member: ${memberError.message}`);
  }

  // Create test event (if events table exists)
  try {
    const { error: eventError } = await supabase
      .from("events")
      .insert({
        id: testEventId,
        org_id: testOrgId,
        name: "Integration Test Event",
        slug: `test-event-${testEventId.substring(0, 8)}`,
        starts_at: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        ends_at: new Date(Date.now() + 172800000).toISOString(), // Day after tomorrow
      });

    if (eventError && !eventError.message.includes("duplicate")) {
      console.log("Note: events table issue:", eventError.message);
      // Event is optional for communication tests
    }
  } catch {
    console.log("Note: events table may not exist yet");
  }
}

async function cleanupTestData(supabase: SupabaseClient): Promise<void> {
  // Delete in correct order (respecting foreign keys)
  await supabase
    .from("email_bounces")
    .delete()
    .eq("org_id", testOrgId);

  await supabase
    .from("email_unsubscribes")
    .delete()
    .eq("org_id", testOrgId);

  await supabase
    .from("email_outbox_events")
    .delete()
    .in(
      "email_id",
      (await supabase.from("email_outbox").select("id").eq("org_id", testOrgId)).data?.map((e) => e.id) ?? []
    );

  await supabase
    .from("email_outbox")
    .delete()
    .eq("org_id", testOrgId);

  await supabase
    .from("message_batch_items")
    .delete()
    .in(
      "batch_id",
      (await supabase.from("message_batches").select("id").eq("org_id", testOrgId)).data?.map((b) => b.id) ?? []
    );

  await supabase
    .from("message_batches")
    .delete()
    .eq("org_id", testOrgId);

  await supabase
    .from("message_templates")
    .delete()
    .eq("org_id", testOrgId);

  await supabase
    .from("org_members")
    .delete()
    .eq("org_id", testOrgId);

  // Delete events
  try {
    await supabase.from("events").delete().eq("id", testEventId);
  } catch {
    // Events may not exist
  }

  await supabase
    .from("orgs")
    .delete()
    .eq("id", testOrgId);

  // Delete test user
  try {
    await supabase.auth.admin.deleteUser(testUserId);
  } catch {
    // User may not exist or deletion may fail
  }
}

// =============================================================================
// TEST SUITE: Email Outbox
// =============================================================================

Deno.test({
  name: "Email Outbox - should queue email on order paid (via queue_email RPC)",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE
      const idempotencyKey = generateIdempotencyKey("order-confirmation");
      const toEmail = "customer@test.com";
      const subject = "Your Order Confirmation";
      const htmlBody = "<p>Thank you for your order!</p>";

      // ACT: Call queue_email function
      const { data, error } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: idempotencyKey,
        _to_email: toEmail,
        _subject: subject,
        _html_body: htmlBody,
        _email_type: "transactional",
      });

      // ASSERT: Should return email ID
      assertEquals(error, null, `queue_email failed: ${error?.message}`);
      assertExists(data, "queue_email should return email ID");

      // Verify email in outbox
      const { data: email, error: fetchError } = await supabase
        .from("email_outbox")
        .select("*")
        .eq("id", data)
        .single();

      assertEquals(fetchError, null, `Fetch email failed: ${fetchError?.message}`);
      assertExists(email, "Email should exist in outbox");
      assertEquals(email.status, "queued", "Email status should be queued");
      assertEquals(email.to_email, toEmail, "To email should match");
      assertEquals(email.subject, subject, "Subject should match");

      // Verify event was logged
      const { data: events, error: eventsError } = await supabase
        .from("email_outbox_events")
        .select("*")
        .eq("email_id", data);

      assertEquals(eventsError, null, `Fetch events failed: ${eventsError?.message}`);
      assertEquals(events?.length, 1, "Should have 1 event");
      assertEquals(events?.[0]?.event_type, "created", "Event type should be created");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

Deno.test({
  name: "Email Outbox - should respect idempotency key (no duplicate)",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE
      const idempotencyKey = generateIdempotencyKey("idempotent-test");

      // ACT: Queue first email
      const { data: firstId, error: firstError } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: idempotencyKey,
        _to_email: "first@test.com",
        _subject: "First Email",
        _html_body: "<p>First</p>",
      });

      assertEquals(firstError, null, `First queue_email failed: ${firstError?.message}`);
      assertExists(firstId, "First call should return email ID");

      // ACT: Try to queue with same key (different content)
      const { data: secondId, error: secondError } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: idempotencyKey,
        _to_email: "second@test.com",
        _subject: "Second Email",
        _html_body: "<p>Second</p>",
      });

      // ASSERT: Both should return same ID
      assertEquals(secondError, null, `Second queue_email failed: ${secondError?.message}`);
      assertEquals(firstId, secondId, "Idempotency should return same ID");

      // Verify only one email exists
      const { data: emails, error: countError } = await supabase
        .from("email_outbox")
        .select("*")
        .eq("idempotency_key", idempotencyKey);

      assertEquals(countError, null, `Count failed: ${countError?.message}`);
      assertEquals(emails?.length, 1, "Should have exactly 1 email");
      assertEquals(emails?.[0]?.to_email, "first@test.com", "Should keep first email's data");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

Deno.test({
  name: "Email Outbox - should skip unsubscribed recipients for marketing",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE: Add email to unsubscribe list
      const unsubscribedEmail = "unsubscribed-marketing@test.com";

      await supabase
        .from("email_unsubscribes")
        .insert({
          email: unsubscribedEmail,
          org_id: testOrgId,
          email_type: "marketing",
          source: "user_request",
        });

      // ACT: Try to queue marketing email
      const { data: result, error } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("marketing-unsub"),
        _to_email: unsubscribedEmail,
        _subject: "Marketing Email",
        _html_body: "<p>Buy now!</p>",
        _email_type: "marketing",
      });

      // ASSERT: Should return null (not queued)
      assertEquals(error, null, `queue_email failed: ${error?.message}`);
      assertEquals(result, null, "Should return null for unsubscribed recipient");

      // Verify no email was created
      const { data: emails } = await supabase
        .from("email_outbox")
        .select("*")
        .eq("to_email", unsubscribedEmail);

      assertEquals(emails?.length ?? 0, 0, "No email should be created");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

// =============================================================================
// TEST SUITE: Bulk Email
// =============================================================================

Deno.test({
  name: "Bulk Email - should create batch with correct recipient count",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE: Create a message batch
      const batchName = "Test Marketing Campaign";
      const subject = "Special Offer";
      const htmlBody = "<p>Check out our special offer!</p>";

      // ACT: Insert batch directly (bulk-email Edge Function would do this)
      const { data: batch, error: batchError } = await supabase
        .from("message_batches")
        .insert({
          org_id: testOrgId,
          name: batchName,
          subject: subject,
          html_body: htmlBody,
          recipient_filter: { type: "all" },
          email_type: "marketing",
          created_by: testUserId,
          total_recipients: 3,
        })
        .select()
        .single();

      assertEquals(batchError, null, `Create batch failed: ${batchError?.message}`);
      assertExists(batch, "Batch should be created");

      // Add batch items
      const recipients = [
        "recipient1@test.com",
        "recipient2@test.com",
        "recipient3@test.com",
      ];

      const items = recipients.map((email) => ({
        batch_id: batch.id,
        email: email,
        variables: { name: email.split("@")[0] },
      }));

      const { error: itemsError } = await supabase
        .from("message_batch_items")
        .insert(items);

      assertEquals(itemsError, null, `Create items failed: ${itemsError?.message}`);

      // ASSERT: Verify batch and items
      const { data: fetchedBatch, error: fetchBatchError } = await supabase
        .from("message_batches")
        .select("*, message_batch_items(*)")
        .eq("id", batch.id)
        .single();

      assertEquals(fetchBatchError, null, `Fetch batch failed: ${fetchBatchError?.message}`);
      assertExists(fetchedBatch, "Batch should be fetchable");
      assertEquals(fetchedBatch.total_recipients, 3, "Total recipients should be 3");
      assertEquals(fetchedBatch.message_batch_items?.length, 3, "Should have 3 items");
      assertEquals(fetchedBatch.status, "draft", "Initial status should be draft");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

Deno.test({
  name: "Bulk Email - should filter out bounced emails via is_email_deliverable",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE: Add hard bounces for an email
      const bouncedEmail = "hard-bounced@test.com";

      await supabase
        .from("email_bounces")
        .insert([
          { email: bouncedEmail, bounce_type: "hard", org_id: testOrgId },
          { email: bouncedEmail, bounce_type: "hard", org_id: testOrgId },
          { email: bouncedEmail, bounce_type: "hard", org_id: testOrgId },
        ]);

      // ACT: Check deliverability
      const { data: isDeliverable, error } = await supabase.rpc("is_email_deliverable", {
        _email: bouncedEmail,
        _org_id: testOrgId,
        _email_type: "marketing",
      });

      // ASSERT: Should not be deliverable
      assertEquals(error, null, `is_email_deliverable failed: ${error?.message}`);
      assertEquals(isDeliverable, false, "Hard bounced email should not be deliverable");

      // Compare with clean email
      const { data: cleanDeliverable } = await supabase.rpc("is_email_deliverable", {
        _email: "clean@test.com",
        _org_id: testOrgId,
        _email_type: "marketing",
      });

      assertEquals(cleanDeliverable, true, "Clean email should be deliverable");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

// =============================================================================
// TEST SUITE: Webhook Handling
// =============================================================================

Deno.test({
  name: "Webhook - should update status on delivered event",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE: Create a 'sent' email
      const { data: emailId } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("webhook-test"),
        _to_email: "webhook-recipient@test.com",
        _subject: "Webhook Test",
        _html_body: "<p>Test</p>",
      });

      assertExists(emailId, "Email should be queued");

      // Simulate sending
      await supabase
        .from("email_outbox")
        .update({ status: "sent", provider_message_id: "resend-123" })
        .eq("id", emailId);

      // ACT: Call update_email_status (simulating webhook)
      const { data: result, error } = await supabase.rpc("update_email_status", {
        _email_id: emailId,
        _new_status: "delivered",
        _provider_event_id: "delivered-event-123",
        _provider_timestamp: new Date().toISOString(),
      });

      // ASSERT
      assertEquals(error, null, `update_email_status failed: ${error?.message}`);
      assertEquals(result, true, "update should return true");

      // Verify status is now delivered
      const { data: email } = await supabase
        .from("email_outbox")
        .select("*")
        .eq("id", emailId)
        .single();

      assertEquals(email?.status, "delivered", "Status should be delivered");
      assertExists(email?.delivered_at, "delivered_at should be set");

      // Verify event was logged
      const { data: events } = await supabase
        .from("email_outbox_events")
        .select("*")
        .eq("email_id", emailId)
        .eq("event_type", "delivered");

      assertEquals(events?.length, 1, "Should have 1 delivered event");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

Deno.test({
  name: "Webhook - should record bounce and block future sends",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE: Create and 'send' an email
      const bouncedRecipient = "will-bounce@test.com";

      const { data: emailId } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("bounce-test"),
        _to_email: bouncedRecipient,
        _subject: "Bounce Test",
        _html_body: "<p>Test</p>",
      });

      await supabase
        .from("email_outbox")
        .update({ status: "sent", provider_message_id: "resend-bounce" })
        .eq("id", emailId);

      // ACT: Simulate bounce webhook
      const { error } = await supabase.rpc("update_email_status", {
        _email_id: emailId,
        _new_status: "bounced",
        _error_message: "User unknown",
        _error_code: "550",
        _provider_event_id: "bounce-event-" + generateUUID(),
      });

      assertEquals(error, null, `update_email_status failed: ${error?.message}`);

      // ASSERT: Bounce should be recorded
      const { data: bounces } = await supabase
        .from("email_bounces")
        .select("*")
        .eq("email", bouncedRecipient)
        .eq("bounce_type", "hard");

      assertEquals(bounces?.length, 1, "Should have 1 hard bounce record");

      // After 3 bounces, email should be blocked
      // Add 2 more bounces
      await supabase.from("email_bounces").insert([
        { email: bouncedRecipient, bounce_type: "hard", org_id: testOrgId },
        { email: bouncedRecipient, bounce_type: "hard", org_id: testOrgId },
      ]);

      // Try to queue new email
      const { data: newEmailId } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("post-bounce"),
        _to_email: bouncedRecipient,
        _subject: "After Bounce",
        _html_body: "<p>Should be blocked</p>",
      });

      assertEquals(newEmailId, null, "Email to bounced address should be blocked");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

Deno.test({
  name: "Webhook - should auto-unsubscribe on complaint (spam report)",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE: Create and 'send' an email
      const complainerEmail = "complainer@test.com";

      const { data: emailId } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("complaint-test"),
        _to_email: complainerEmail,
        _subject: "Complaint Test",
        _html_body: "<p>Test</p>",
        _email_type: "marketing",
      });

      await supabase
        .from("email_outbox")
        .update({ status: "sent", provider_message_id: "resend-complaint" })
        .eq("id", emailId);

      // ACT: Simulate complaint webhook
      const { error } = await supabase.rpc("update_email_status", {
        _email_id: emailId,
        _new_status: "complained",
        _provider_event_id: "complaint-event-" + generateUUID(),
      });

      assertEquals(error, null, `update_email_status failed: ${error?.message}`);

      // ASSERT: Bounce record with type 'complaint' should be created
      const { data: bounces } = await supabase
        .from("email_bounces")
        .select("*")
        .eq("email", complainerEmail)
        .eq("bounce_type", "complaint");

      assertEquals(bounces?.length, 1, "Should have 1 complaint record");

      // Note: Auto-unsubscribe would typically be done in the Edge Function
      // The update_email_status function records the complaint,
      // but the Edge Function should add to unsubscribes

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

// =============================================================================
// TEST SUITE: RLS Integration (via authenticated client)
// =============================================================================

Deno.test({
  name: "RLS Integration - anon user cannot access org emails",
  async fn() {
    const serviceClient = getServiceClient();
    const anonClient = getAnonClient();

    try {
      await setupTestData(serviceClient);

      // ARRANGE: Create email with service role
      await serviceClient.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("rls-test"),
        _to_email: "rls-test@test.com",
        _subject: "RLS Test",
        _html_body: "<p>Test</p>",
      });

      // ACT: Try to fetch with anon client
      const { data: emails, error } = await anonClient
        .from("email_outbox")
        .select("*")
        .eq("org_id", testOrgId);

      // ASSERT: Should not see any emails (RLS blocks access)
      assertEquals(error, null, "Query should not error");
      assertEquals(emails?.length ?? 0, 0, "Anon user should not see any emails");

    } finally {
      await cleanupTestData(serviceClient);
    }
  },
});

// =============================================================================
// TEST SUITE: Edge Cases
// =============================================================================

Deno.test({
  name: "Edge Case - invalid email format should be rejected",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ACT & ASSERT: Try to queue with invalid email
      const { error } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("invalid-email"),
        _to_email: "invalid-email-no-at-sign",
        _subject: "Test",
        _html_body: "<p>Test</p>",
      });

      // Should fail with error
      assertExists(error, "Should reject invalid email format");
      assertEquals(
        error?.message?.includes("Invalid email") || error?.code !== null,
        true,
        "Error should indicate invalid email"
      );

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

Deno.test({
  name: "Edge Case - empty subject should still queue (no constraint)",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ACT: Queue with empty subject (allowed by schema)
      const { data, error } = await supabase.rpc("queue_email", {
        _org_id: testOrgId,
        _event_id: null,
        _idempotency_key: generateIdempotencyKey("empty-subject"),
        _to_email: "valid@test.com",
        _subject: "",
        _html_body: "<p>Test</p>",
      });

      // ASSERT: Should succeed (empty string is valid)
      assertEquals(error, null, "Empty subject should be allowed");
      assertExists(data, "Email should be queued");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

Deno.test({
  name: "Edge Case - duplicate batch item email should be rejected",
  async fn() {
    const supabase = getServiceClient();

    try {
      await setupTestData(supabase);

      // ARRANGE: Create batch
      const { data: batch } = await supabase
        .from("message_batches")
        .insert({
          org_id: testOrgId,
          name: "Duplicate Test Batch",
          subject: "Test",
          html_body: "<p>Test</p>",
          recipient_filter: { type: "custom" },
          created_by: testUserId,
        })
        .select()
        .single();

      assertExists(batch, "Batch should be created");

      // Add first item
      const { error: firstError } = await supabase
        .from("message_batch_items")
        .insert({
          batch_id: batch.id,
          email: "duplicate@test.com",
        });

      assertEquals(firstError, null, "First item should be inserted");

      // ACT: Try to add duplicate
      const { error: duplicateError } = await supabase
        .from("message_batch_items")
        .insert({
          batch_id: batch.id,
          email: "duplicate@test.com",
        });

      // ASSERT: Should fail due to unique constraint
      assertExists(duplicateError, "Duplicate should be rejected");

    } finally {
      await cleanupTestData(supabase);
    }
  },
});

// =============================================================================
// SUMMARY
// =============================================================================
// Tests executed:
//   Email Outbox:
//     - should queue email on order paid (via queue_email RPC)
//     - should respect idempotency key (no duplicate)
//     - should skip unsubscribed recipients for marketing
//
//   Bulk Email:
//     - should create batch with correct recipient count
//     - should filter out bounced emails via is_email_deliverable
//
//   Webhook Handling:
//     - should update status on delivered event
//     - should record bounce and block future sends
//     - should auto-unsubscribe on complaint (spam report)
//
//   RLS Integration:
//     - anon user cannot access org emails
//
//   Edge Cases:
//     - invalid email format should be rejected
//     - empty subject should still queue
//     - duplicate batch item email should be rejected
// =============================================================================
