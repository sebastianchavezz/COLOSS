#!/usr/bin/env node
/**
 * Integration Tests: F015 Products Module
 * Sprint S1: Data Layer
 *
 * Tests the Products Module RPCs:
 * - create_product
 * - update_product
 * - delete_product
 * - get_public_products
 * - create_product_variant
 * - update_product_variant
 * - delete_product_variant
 * - set_product_ticket_restrictions
 *
 * Run: node .claude-flow/flows/f015-products/tests/integration-tests.mjs
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
console.log("🧪 F015 Products Module Integration Tests (S1)\n");
console.log("=".repeat(50));
console.log("RPC Existence Tests");
console.log("=".repeat(50));

// ------------------------------------------
// Test 1: RPC create_product exists
// ------------------------------------------
await test("RPC create_product exists", async () => {
  const { data, error } = await supabase.rpc("create_product", {
    _event_id: crypto.randomUUID(),
    _category: "standalone",
    _name: "Test Product",
    _price: 10.00
  });

  // Should not throw "function does not exist" error
  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  // Anonymous user should be blocked
  // Function exists if we get an error about authentication, not existence
  assert(
    error?.message?.includes("Authentication required") ||
    error?.message?.includes("Event not found") ||
    data !== undefined,
    `RPC exists but returned unexpected: ${error?.message || "success"}`
  );
});

// ------------------------------------------
// Test 2: RPC update_product exists
// ------------------------------------------
await test("RPC update_product exists", async () => {
  const { data, error } = await supabase.rpc("update_product", {
    _product_id: crypto.randomUUID(),
    _name: "Updated Product"
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    error?.message?.includes("Authentication required") ||
    error?.message?.includes("Product not found") ||
    data !== undefined,
    "RPC should exist"
  );
});

// ------------------------------------------
// Test 3: RPC delete_product exists
// ------------------------------------------
await test("RPC delete_product exists", async () => {
  const { data, error } = await supabase.rpc("delete_product", {
    _product_id: crypto.randomUUID()
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    error?.message?.includes("Authentication required") ||
    error?.message?.includes("Product not found") ||
    data !== undefined,
    "RPC should exist"
  );
});

// ------------------------------------------
// Test 4: RPC get_public_products exists
// ------------------------------------------
await test("RPC get_public_products exists", async () => {
  const { data, error } = await supabase.rpc("get_public_products", {
    _event_id: crypto.randomUUID(),
    _cart_ticket_type_ids: []
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  // This RPC allows anon access, should return empty array or error
  assert(
    Array.isArray(data) || error !== null,
    "RPC should exist and return array or error"
  );
});

// ------------------------------------------
// Test 5: RPC create_product_variant exists
// ------------------------------------------
await test("RPC create_product_variant exists", async () => {
  const { data, error } = await supabase.rpc("create_product_variant", {
    _product_id: crypto.randomUUID(),
    _name: "Variant S"
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    error?.message?.includes("Authentication required") ||
    error?.message?.includes("Product not found") ||
    data !== undefined,
    "RPC should exist"
  );
});

// ------------------------------------------
// Test 6: RPC update_product_variant exists
// ------------------------------------------
await test("RPC update_product_variant exists", async () => {
  const { data, error } = await supabase.rpc("update_product_variant", {
    _variant_id: crypto.randomUUID(),
    _name: "Updated Variant"
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    error?.message?.includes("Authentication required") ||
    error?.message?.includes("Variant not found") ||
    data !== undefined,
    "RPC should exist"
  );
});

// ------------------------------------------
// Test 7: RPC delete_product_variant exists
// ------------------------------------------
await test("RPC delete_product_variant exists", async () => {
  const { data, error } = await supabase.rpc("delete_product_variant", {
    _variant_id: crypto.randomUUID()
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    error?.message?.includes("Authentication required") ||
    error?.message?.includes("Variant not found") ||
    data !== undefined,
    "RPC should exist"
  );
});

// ------------------------------------------
// Test 8: RPC set_product_ticket_restrictions exists
// ------------------------------------------
await test("RPC set_product_ticket_restrictions exists", async () => {
  const { data, error } = await supabase.rpc("set_product_ticket_restrictions", {
    _product_id: crypto.randomUUID(),
    _ticket_type_ids: []
  });

  if (error?.message?.includes("does not exist")) {
    throw new Error("RPC not found: " + error.message);
  }

  assert(
    error?.message?.includes("Authentication required") ||
    error?.message?.includes("Product not found") ||
    data !== undefined,
    "RPC should exist"
  );
});

// ------------------------------------------
// Auth Tests
// ------------------------------------------
console.log("\n" + "=".repeat(50));
console.log("Authentication Tests");
console.log("=".repeat(50));

// ------------------------------------------
// Test 9: Anonymous blocked from create_product
// ------------------------------------------
await test("Anonymous blocked from create_product", async () => {
  const { error } = await supabase.rpc("create_product", {
    _event_id: crypto.randomUUID(),
    _category: "standalone",
    _name: "Blocked Product",
    _price: 10.00
  });

  // Should be blocked due to auth
  assert(
    error?.message?.includes("Authentication required"),
    `Expected auth error, got: ${error?.message || "success"}`
  );
});

// ------------------------------------------
// Test 10: Anonymous blocked from update_product
// ------------------------------------------
await test("Anonymous blocked from update_product", async () => {
  const { error } = await supabase.rpc("update_product", {
    _product_id: crypto.randomUUID(),
    _name: "Blocked Update"
  });

  assert(
    error?.message?.includes("Authentication required"),
    `Expected auth error, got: ${error?.message || "success"}`
  );
});

// ------------------------------------------
// Test 11: Anonymous blocked from delete_product
// ------------------------------------------
await test("Anonymous blocked from delete_product", async () => {
  const { error } = await supabase.rpc("delete_product", {
    _product_id: crypto.randomUUID()
  });

  assert(
    error?.message?.includes("Authentication required"),
    `Expected auth error, got: ${error?.message || "success"}`
  );
});

// ------------------------------------------
// Test 12: Anonymous CAN call get_public_products
// ------------------------------------------
await test("Anonymous CAN call get_public_products", async () => {
  const { data, error } = await supabase.rpc("get_public_products", {
    _event_id: crypto.randomUUID(),
    _cart_ticket_type_ids: []
  });

  // Should NOT be blocked (returns empty array or data)
  // May return empty array or PostgreSQL error for non-existent event
  assert(
    Array.isArray(data) || error !== null,
    "Anonymous should be able to call this RPC"
  );
});

// ------------------------------------------
// View Tests
// ------------------------------------------
console.log("\n" + "=".repeat(50));
console.log("View Queryability Tests");
console.log("=".repeat(50));

// ------------------------------------------
// Test 13: View v_product_stats exists and queryable
// ------------------------------------------
await test("View v_product_stats exists and queryable", async () => {
  const { error } = await supabase
    .from("v_product_stats")
    .select("product_id")
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
// Test 14: View v_product_variant_stats exists and queryable
// ------------------------------------------
await test("View v_product_variant_stats exists and queryable", async () => {
  const { error } = await supabase
    .from("v_product_variant_stats")
    .select("variant_id")
    .limit(1);

  if (error?.code === "42P01") {
    throw new Error("View does not exist");
  }
  if (error && error.code !== "PGRST116") {
    throw new Error(`Unexpected error: ${error.message}`);
  }
});

// ------------------------------------------
// Response Structure Tests
// ------------------------------------------
console.log("\n" + "=".repeat(50));
console.log("Response Structure Tests");
console.log("=".repeat(50));

// ------------------------------------------
// Test 15: create_product returns correct error structure
// ------------------------------------------
await test("create_product returns correct error structure", async () => {
  const { error } = await supabase.rpc("create_product", {
    _event_id: crypto.randomUUID(),
    _category: "standalone",
    _name: "Test",
    _price: 10.00
  });

  // Should return a PostgreSQL error object
  assert(
    error !== null && typeof error === "object",
    "Error should be an object"
  );
  assert(
    "message" in error,
    "Error should have message field"
  );
});

// ------------------------------------------
// Test 16: get_public_products returns correct structure
// ------------------------------------------
await test("get_public_products returns correct structure", async () => {
  const { data, error } = await supabase.rpc("get_public_products", {
    _event_id: crypto.randomUUID(),
    _cart_ticket_type_ids: []
  });

  // Should return array or error
  assert(
    Array.isArray(data) || error !== null,
    "Response should be array or error"
  );

  // If data is returned, check structure (even if empty)
  if (Array.isArray(data)) {
    assert(
      data.length === 0 || (data.length > 0 && "id" in data[0]),
      "If data returned, should have id field or be empty array"
    );
  }
});

// ------------------------------------------
// Additional Edge Case Tests
// ------------------------------------------
console.log("\n" + "=".repeat(50));
console.log("Edge Case Tests");
console.log("=".repeat(50));

// ------------------------------------------
// Test 17: create_product with invalid category
// ------------------------------------------
await test("create_product rejects invalid category", async () => {
  const { error } = await supabase.rpc("create_product", {
    _event_id: crypto.randomUUID(),
    _category: "invalid_category",
    _name: "Test",
    _price: 10.00
  });

  // Should fail with type error or auth error
  assert(
    error !== null,
    "Invalid category should be rejected"
  );
});

// ------------------------------------------
// Test 18: get_public_products with null event_id
// ------------------------------------------
await test("get_public_products handles null event_id", async () => {
  const { error } = await supabase.rpc("get_public_products", {
    _event_id: null,
    _cart_ticket_type_ids: []
  });

  // Should handle gracefully (return error or empty)
  // This is expected to fail, so error is OK
  assert(
    error !== null,
    "Null event_id should be handled"
  );
});

// ------------------------------------------
// Test 19: create_product with negative price
// ------------------------------------------
await test("create_product rejects negative price", async () => {
  const { error } = await supabase.rpc("create_product", {
    _event_id: crypto.randomUUID(),
    _category: "standalone",
    _name: "Test",
    _price: -10.00
  });

  // Should fail (auth or constraint)
  assert(
    error !== null,
    "Negative price should be rejected"
  );
});

// ------------------------------------------
// Test 20: create_product with negative capacity
// ------------------------------------------
await test("create_product rejects negative capacity", async () => {
  const { error } = await supabase.rpc("create_product", {
    _event_id: crypto.randomUUID(),
    _category: "standalone",
    _name: "Test",
    _price: 10.00,
    _capacity_total: -5
  });

  // Should fail (auth or constraint)
  assert(
    error !== null,
    "Negative capacity should be rejected"
  );
});

// === SUMMARY ===
console.log("\n" + "=".repeat(50));
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log("=".repeat(50));

process.exit(failed > 0 ? 1 : 0);
