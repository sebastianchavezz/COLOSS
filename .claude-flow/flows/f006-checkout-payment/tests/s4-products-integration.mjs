#!/usr/bin/env node
/**
 * F006 S4 - Products Integration Tests
 *
 * Tests the integration between checkout (F006) and products (F015)
 *
 * Run with:
 *   node .claude-flow/flows/f006-checkout-payment/tests/s4-products-integration.mjs
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    if (!condition) throw new Error(message || 'Assertion failed');
}

console.log("🧪 F006 S4: Products Integration Tests\n");

// =====================================================
// 1. Test RPC exists
// =====================================================

await test("validate_checkout_with_products RPC exists", async () => {
    // This will fail if RPC doesn't exist
    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: '00000000-0000-0000-0000-000000000000',
        _ticket_items: [],
        _product_items: []
    });

    // We expect a result (even if empty/invalid event)
    // Error would be PGRST202 if RPC doesn't exist
    if (error && error.code === 'PGRST202') {
        throw new Error('RPC not found - migration not applied');
    }

    // Result should be valid JSON with expected structure
    assert(data !== undefined, 'RPC should return data');
});

// =====================================================
// 2. Test tickets-only validation (backwards compat)
// =====================================================

await test("Tickets-only validation still works (backwards compatibility)", async () => {
    // Find a published event with tickets
    const { data: events } = await supabase
        .from('events')
        .select('id')
        .eq('status', 'published')
        .limit(1);

    if (!events || events.length === 0) {
        console.log('   ⚠️  Skipped: No published events found');
        return;
    }

    const eventId = events[0].id;

    // Find a ticket type
    const { data: ticketTypes } = await supabase
        .from('ticket_types')
        .select('id, price')
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .limit(1);

    if (!ticketTypes || ticketTypes.length === 0) {
        console.log('   ⚠️  Skipped: No ticket types found');
        return;
    }

    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: eventId,
        _ticket_items: [{ ticket_type_id: ticketTypes[0].id, quantity: 1 }],
        _product_items: []
    });

    assert(!error, `RPC error: ${error?.message}`);
    assert(data.ticket_details !== undefined, 'Should have ticket_details');
    assert(data.total_price !== undefined, 'Should have total_price');
});

// =====================================================
// 3. Test products-only validation
// =====================================================

await test("Products-only validation works", async () => {
    // Find a published event with products
    const { data: products } = await supabase
        .from('products')
        .select('id, event_id, price, category')
        .eq('is_active', true)
        .is('deleted_at', null)
        .eq('category', 'standalone')
        .limit(1);

    if (!products || products.length === 0) {
        console.log('   ⚠️  Skipped: No active standalone products found');
        return;
    }

    const product = products[0];

    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: product.event_id,
        _ticket_items: [],
        _product_items: [{ product_id: product.id, quantity: 1 }]
    });

    assert(!error, `RPC error: ${error?.message}`);
    assert(data.product_details !== undefined, 'Should have product_details');
    assert(data.total_price !== undefined, 'Should have total_price');
});

// =====================================================
// 4. Test mixed cart validation
// =====================================================

await test("Mixed cart (tickets + products) validation works", async () => {
    // Find an event with both tickets and products
    const { data: products } = await supabase
        .from('products')
        .select('id, event_id, price, category')
        .eq('is_active', true)
        .is('deleted_at', null)
        .eq('category', 'standalone')
        .limit(1);

    if (!products || products.length === 0) {
        console.log('   ⚠️  Skipped: No products found');
        return;
    }

    const product = products[0];
    const eventId = product.event_id;

    // Find a ticket for the same event
    const { data: ticketTypes } = await supabase
        .from('ticket_types')
        .select('id, price')
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .limit(1);

    if (!ticketTypes || ticketTypes.length === 0) {
        console.log('   ⚠️  Skipped: No ticket types found for event');
        return;
    }

    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: eventId,
        _ticket_items: [{ ticket_type_id: ticketTypes[0].id, quantity: 1 }],
        _product_items: [{ product_id: product.id, quantity: 1 }]
    });

    assert(!error, `RPC error: ${error?.message}`);
    assert(data.ticket_details !== undefined, 'Should have ticket_details');
    assert(data.product_details !== undefined, 'Should have product_details');

    // Total should include both
    if (data.valid) {
        const expectedTotal = parseFloat(ticketTypes[0].price) + parseFloat(product.price);
        const actualTotal = parseFloat(data.total_price);
        // Allow small floating point differences
        assert(Math.abs(actualTotal - expectedTotal) < 0.01,
            `Total mismatch: expected ${expectedTotal}, got ${actualTotal}`);
    }
});

// =====================================================
// 5. Test max_per_order enforcement
// =====================================================

await test("max_per_order limit is enforced", async () => {
    const { data: products } = await supabase
        .from('products')
        .select('id, event_id, max_per_order')
        .eq('is_active', true)
        .is('deleted_at', null)
        .limit(1);

    if (!products || products.length === 0) {
        console.log('   ⚠️  Skipped: No products found');
        return;
    }

    const product = products[0];
    const exceedQuantity = product.max_per_order + 1;

    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: product.event_id,
        _ticket_items: [],
        _product_items: [{ product_id: product.id, quantity: exceedQuantity }]
    });

    assert(!error, `RPC error: ${error?.message}`);
    assert(data.valid === false, 'Should reject order exceeding max_per_order');

    const productError = data.product_details?.find(d => d.reason);
    assert(productError, 'Should have product error detail');
    assert(productError.reason.includes('maximum'), 'Error should mention maximum');
});

// =====================================================
// 6. Test ticket_upgrade restriction
// =====================================================

await test("ticket_upgrade requires matching ticket", async () => {
    // Find a ticket_upgrade product with restrictions
    const { data: products } = await supabase
        .from('products')
        .select(`
            id, event_id, category,
            product_ticket_restrictions(ticket_type_id)
        `)
        .eq('is_active', true)
        .is('deleted_at', null)
        .eq('category', 'ticket_upgrade')
        .limit(1);

    if (!products || products.length === 0) {
        console.log('   ⚠️  Skipped: No ticket_upgrade products found');
        return;
    }

    const product = products[0];

    if (!product.product_ticket_restrictions || product.product_ticket_restrictions.length === 0) {
        console.log('   ⚠️  Skipped: Product has no ticket restrictions');
        return;
    }

    // Try to buy upgrade WITHOUT required ticket
    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: product.event_id,
        _ticket_items: [],  // No tickets!
        _product_items: [{ product_id: product.id, quantity: 1 }]
    });

    assert(!error, `RPC error: ${error?.message}`);
    assert(data.valid === false, 'Should reject upgrade without matching ticket');

    const productError = data.product_details?.find(d => d.reason);
    assert(productError, 'Should have product error detail');
    assert(productError.reason.includes('ticket'), 'Error should mention ticket requirement');
});

// =====================================================
// 7. Test inactive product rejection
// =====================================================

await test("Inactive products are rejected", async () => {
    // Find an inactive product
    const { data: products } = await supabase
        .from('products')
        .select('id, event_id')
        .eq('is_active', false)
        .is('deleted_at', null)
        .limit(1);

    if (!products || products.length === 0) {
        console.log('   ⚠️  Skipped: No inactive products found');
        return;
    }

    const product = products[0];

    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: product.event_id,
        _ticket_items: [],
        _product_items: [{ product_id: product.id, quantity: 1 }]
    });

    assert(!error, `RPC error: ${error?.message}`);
    assert(data.valid === false, 'Should reject inactive product');
});

// =====================================================
// 8. Test variant validation
// =====================================================

await test("Product variants can be validated", async () => {
    // Find a product with variants
    const { data: variants } = await supabase
        .from('product_variants')
        .select('id, product_id, products!inner(event_id, is_active)')
        .eq('is_active', true)
        .eq('products.is_active', true)
        .limit(1);

    if (!variants || variants.length === 0) {
        console.log('   ⚠️  Skipped: No active product variants found');
        return;
    }

    const variant = variants[0];

    const { data, error } = await supabase.rpc('validate_checkout_with_products', {
        _event_id: variant.products.event_id,
        _ticket_items: [],
        _product_items: [{
            product_id: variant.product_id,
            variant_id: variant.id,
            quantity: 1
        }]
    });

    assert(!error, `RPC error: ${error?.message}`);
    assert(data.product_details !== undefined, 'Should have product_details');

    if (data.valid) {
        const detail = data.product_details.find(d => d.variant_id === variant.id);
        assert(detail, 'Should have variant detail');
    }
});

// =====================================================
// Summary
// =====================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${'='.repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
