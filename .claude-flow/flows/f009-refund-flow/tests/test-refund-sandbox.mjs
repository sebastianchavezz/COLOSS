#!/usr/bin/env node
/**
 * F009 Refund Flow - Sandbox Test Script
 *
 * Tests the complete refund flow against Mollie sandbox.
 *
 * Prerequisites:
 * - MOLLIE_API_KEY set in Supabase secrets (test_xxx key)
 * - A paid order in the database
 * - User token with org admin/owner role
 *
 * Usage:
 *   node test-refund-sandbox.mjs --order-id=UUID --token=USER_JWT
 *
 * Or set environment variables:
 *   TEST_ORDER_ID=xxx TEST_USER_TOKEN=xxx node test-refund-sandbox.mjs
 */

const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";

// Parse command line args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value;
  return acc;
}, {});

const ORDER_ID = args['order-id'] || process.env.TEST_ORDER_ID;
const USER_TOKEN = args['token'] || process.env.TEST_USER_TOKEN;

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStep(step, msg) {
  console.log(`\n${colors.cyan}[${step}]${colors.reset} ${msg}`);
}

function logSuccess(msg) {
  console.log(`${colors.green}✅ ${msg}${colors.reset}`);
}

function logError(msg) {
  console.log(`${colors.red}❌ ${msg}${colors.reset}`);
}

function logInfo(msg) {
  console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`);
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('🧪 F009 Refund Flow - Sandbox Test', 'cyan');
  console.log('='.repeat(60) + '\n');

  // Validate inputs
  if (!ORDER_ID) {
    logError('Missing order ID. Use --order-id=UUID or set TEST_ORDER_ID env var');
    console.log('\nUsage:');
    console.log('  node test-refund-sandbox.mjs --order-id=UUID --token=JWT');
    console.log('\nOr:');
    console.log('  TEST_ORDER_ID=xxx TEST_USER_TOKEN=xxx node test-refund-sandbox.mjs');
    process.exit(1);
  }

  if (!USER_TOKEN) {
    logError('Missing user token. Use --token=JWT or set TEST_USER_TOKEN env var');
    process.exit(1);
  }

  logInfo(`Order ID: ${ORDER_ID}`);
  logInfo(`Token: ${USER_TOKEN.substring(0, 20)}...`);

  // ========== TEST 1: Get Refund Summary ==========
  logStep(1, 'Getting order refund summary...');

  try {
    const summaryResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_refund_summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${USER_TOKEN}`,
        'apikey': USER_TOKEN.split('.')[1] ? USER_TOKEN : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4',
      },
      body: JSON.stringify({ _order_id: ORDER_ID }),
    });

    const summary = await summaryResponse.json();

    if (summary.error) {
      logError(`Summary error: ${summary.error}`);
      if (summary.error === 'ORDER_NOT_FOUND_OR_UNAUTHORIZED') {
        logInfo('Make sure the order exists and you have org admin/owner access');
      }
      process.exit(1);
    }

    logSuccess('Got refund summary');
    console.log('\n  Summary:');
    console.log(`    Order Status: ${summary.order_status}`);
    console.log(`    Total Paid: €${(summary.total_paid_cents / 100).toFixed(2)}`);
    console.log(`    Already Refunded: €${(summary.total_refunded_cents / 100).toFixed(2)}`);
    console.log(`    Pending Refunds: €${(summary.pending_refunds_cents / 100).toFixed(2)}`);
    console.log(`    Refundable: €${(summary.refundable_cents / 100).toFixed(2)}`);
    console.log(`    Can Refund: ${summary.can_refund}`);
    console.log(`    Mollie Payment ID: ${summary.mollie_payment_id || 'N/A'}`);

    if (!summary.can_refund) {
      logError('Order cannot be refunded (already fully refunded or not paid)');
      process.exit(1);
    }

    if (!summary.mollie_payment_id) {
      logError('No Mollie payment ID found. Payment may not have been processed via Mollie.');
      process.exit(1);
    }

    // ========== TEST 2: Create Partial Refund ==========
    const partialAmount = Math.min(100, summary.refundable_cents); // €1.00 or less

    if (partialAmount < summary.refundable_cents && summary.refundable_cents > 100) {
      logStep(2, `Creating partial refund of €${(partialAmount / 100).toFixed(2)}...`);

      const idempotencyKey = `test-partial-${Date.now()}`;

      const partialResponse = await fetch(`${SUPABASE_URL}/functions/v1/create-refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${USER_TOKEN}`,
        },
        body: JSON.stringify({
          order_id: ORDER_ID,
          amount_cents: partialAmount,
          reason: 'Sandbox test - partial refund',
          idempotency_key: idempotencyKey,
        }),
      });

      const partialResult = await partialResponse.json();

      if (partialResult.error) {
        logError(`Partial refund failed: ${partialResult.error} - ${partialResult.message || ''}`);

        if (partialResult.error === 'MOLLIE_NOT_CONFIGURED') {
          logInfo('Set MOLLIE_API_KEY: npx supabase secrets set MOLLIE_API_KEY=test_xxx');
        }
      } else {
        logSuccess('Partial refund created!');
        console.log('\n  Refund Details:');
        console.log(`    Refund ID: ${partialResult.refund?.id}`);
        console.log(`    Mollie Refund ID: ${partialResult.refund?.mollie_refund_id}`);
        console.log(`    Status: ${partialResult.refund?.status}`);
        console.log(`    Amount: €${(partialResult.refund?.amount_cents / 100).toFixed(2)}`);
      }

      // Test idempotency
      logStep('2b', 'Testing idempotency (same key should return same refund)...');

      const idempotentResponse = await fetch(`${SUPABASE_URL}/functions/v1/create-refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${USER_TOKEN}`,
        },
        body: JSON.stringify({
          order_id: ORDER_ID,
          amount_cents: partialAmount,
          idempotency_key: idempotencyKey,
        }),
      });

      const idempotentResult = await idempotentResponse.json();

      if (idempotentResult.idempotent) {
        logSuccess('Idempotency works! Same refund returned.');
      } else if (idempotentResult.error) {
        logError(`Idempotency test failed: ${idempotentResult.error}`);
      }
    }

    // ========== TEST 3: Full Refund (of remaining) ==========
    logStep(3, 'Creating full refund of remaining amount...');

    const fullIdempotencyKey = `test-full-${Date.now()}`;

    const fullResponse = await fetch(`${SUPABASE_URL}/functions/v1/create-refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${USER_TOKEN}`,
      },
      body: JSON.stringify({
        order_id: ORDER_ID,
        reason: 'Sandbox test - full refund',
        idempotency_key: fullIdempotencyKey,
      }),
    });

    const fullResult = await fullResponse.json();

    if (fullResult.error) {
      if (fullResult.error === 'ALREADY_REFUNDED') {
        logInfo('Order already fully refunded');
      } else {
        logError(`Full refund failed: ${fullResult.error} - ${fullResult.message || ''}`);
      }
    } else {
      logSuccess('Full refund created!');
      console.log('\n  Refund Details:');
      console.log(`    Refund ID: ${fullResult.refund?.id}`);
      console.log(`    Mollie Refund ID: ${fullResult.refund?.mollie_refund_id}`);
      console.log(`    Status: ${fullResult.refund?.status}`);
      console.log(`    Amount: €${(fullResult.refund?.amount_cents / 100).toFixed(2)}`);
      console.log(`    Is Full Refund: ${fullResult.refund?.is_full_refund}`);
    }

    // ========== TEST 4: Verify Final State ==========
    logStep(4, 'Verifying final refund state...');

    const finalSummaryResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_refund_summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${USER_TOKEN}`,
        'apikey': USER_TOKEN,
      },
      body: JSON.stringify({ _order_id: ORDER_ID }),
    });

    const finalSummary = await finalSummaryResponse.json();

    if (!finalSummary.error) {
      console.log('\n  Final State:');
      console.log(`    Total Refunded: €${(finalSummary.total_refunded_cents / 100).toFixed(2)}`);
      console.log(`    Pending: €${(finalSummary.pending_refunds_cents / 100).toFixed(2)}`);
      console.log(`    Remaining Refundable: €${(finalSummary.refundable_cents / 100).toFixed(2)}`);
      console.log(`    Refunds: ${finalSummary.refunds?.length || 0}`);

      if (finalSummary.refunds?.length > 0) {
        console.log('\n  Refund History:');
        for (const r of finalSummary.refunds) {
          console.log(`    - ${r.id.substring(0, 8)}: €${(r.amount_cents / 100).toFixed(2)} (${r.status})`);
        }
      }
    }

    // ========== SUMMARY ==========
    console.log('\n' + '='.repeat(60));
    logSuccess('Sandbox tests completed!');
    console.log('='.repeat(60));

    console.log('\n📋 Next Steps:');
    console.log('1. Check Mollie Dashboard for refund status');
    console.log('2. Wait for webhook (or manually trigger)');
    console.log('3. Verify tickets are voided (for full refunds)');
    console.log('4. Check email_outbox for notification');

  } catch (error) {
    logError(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
