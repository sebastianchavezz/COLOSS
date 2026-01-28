#!/usr/bin/env node
/**
 * F006 Checkout & Payment - E2E Sandbox Test
 *
 * Tests the complete checkout flow with Mollie sandbox.
 *
 * Prerequisites:
 * - MOLLIE_API_KEY set (test_xxx key)
 * - Published event with ticket types
 *
 * Usage:
 *   node e2e-sandbox-test.mjs
 *
 * What it does:
 * 1. Finds a published event with available tickets
 * 2. Creates an order via create-order-public
 * 3. Returns checkout URL for manual payment completion
 */

const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('🧪 F006 Checkout & Payment - E2E Sandbox Test', 'cyan');
  console.log('='.repeat(60) + '\n');

  // =================================================================
  // STEP 1: Find a published event with tickets
  // =================================================================
  log('[1/4] Finding published event with available tickets...', 'blue');

  const eventsResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/events?status=eq.published&select=id,name,org_id&limit=5`,
    { headers: { 'apikey': ANON_KEY } }
  );
  const events = await eventsResponse.json();

  if (!events || events.length === 0) {
    log('❌ No published events found', 'red');
    process.exit(1);
  }

  log(`   Found ${events.length} published event(s)`, 'green');

  // Find ticket types for first event
  let selectedEvent = null;
  let selectedTicketType = null;

  for (const event of events) {
    const ticketsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/ticket_types?event_id=eq.${event.id}&status=eq.published&select=id,name,price,capacity_total`,
      { headers: { 'apikey': ANON_KEY } }
    );
    const tickets = await ticketsResponse.json();

    if (tickets && tickets.length > 0) {
      // Find a ticket with capacity and price > 0 (to test payment)
      const paidTicket = tickets.find(t => t.price > 0);
      if (paidTicket) {
        selectedEvent = event;
        selectedTicketType = paidTicket;
        break;
      }
    }
  }

  if (!selectedEvent || !selectedTicketType) {
    log('❌ No published event with paid tickets found', 'red');
    log('   Create an event with a ticket type that has price > 0', 'yellow');
    process.exit(1);
  }

  log(`   Selected: ${selectedEvent.name}`, 'green');
  log(`   Ticket: ${selectedTicketType.name} (€${selectedTicketType.price})`, 'green');

  // =================================================================
  // STEP 2: Create order via create-order-public
  // =================================================================
  log('\n[2/4] Creating order via create-order-public...', 'blue');

  const testEmail = `sandbox-test-${Date.now()}@coloss.nl`;
  const orderPayload = {
    event_id: selectedEvent.id,
    items: [{ ticket_type_id: selectedTicketType.id, quantity: 1 }],
    email: testEmail,
    purchaser_name: 'Sandbox Test User',
  };

  log(`   Email: ${testEmail}`, 'cyan');
  log(`   Payload: ${JSON.stringify(orderPayload, null, 2).split('\n').map(l => '   ' + l).join('\n')}`, 'cyan');

  const orderResponse = await fetch(
    `${SUPABASE_URL}/functions/v1/create-order-public`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(orderPayload),
    }
  );

  const orderResult = await orderResponse.json();

  if (orderResult.error) {
    log(`❌ Order creation failed: ${orderResult.error}`, 'red');
    log(`   Code: ${orderResult.code}`, 'red');
    log(`   Details: ${orderResult.details || 'none'}`, 'red');
    process.exit(1);
  }

  log(`   Order created successfully!`, 'green');
  log(`   Order ID: ${orderResult.order?.id}`, 'green');
  log(`   Total: €${orderResult.order?.total_amount}`, 'green');

  // =================================================================
  // STEP 3: Check test mode & payment
  // =================================================================
  log('\n[3/4] Payment details...', 'blue');

  if (orderResult.payment?.test_mode) {
    log(`   🧪 TEST MODE ACTIVE`, 'magenta');
  }

  log(`   Payment Provider: ${orderResult.payment?.provider}`, 'cyan');
  log(`   Mollie Payment ID: ${orderResult.payment?.payment_id}`, 'cyan');
  log(`   Public Token: ${orderResult.public_token?.substring(0, 20)}...`, 'cyan');

  // =================================================================
  // STEP 4: Output checkout URL
  // =================================================================
  log('\n[4/4] Checkout URL', 'blue');

  if (orderResult.checkout_url) {
    console.log('\n' + '='.repeat(60));
    log('🎉 SUCCESS! Order created with Mollie payment', 'green');
    console.log('='.repeat(60));

    console.log('\n📋 Next steps:\n');
    log('1. Open this URL in your browser:', 'yellow');
    console.log(`\n   ${colors.cyan}${orderResult.checkout_url}${colors.reset}\n`);

    log('2. Complete the payment in Mollie test checkout', 'yellow');
    log('   - Select any payment method', 'cyan');
    log('   - Use test card: 4543 4740 0224 9996', 'cyan');
    log('   - Or use iDEAL test bank', 'cyan');

    log('\n3. After payment, the webhook will be triggered', 'yellow');

    log('\n4. Check order status:', 'yellow');
    console.log(`   curl "${SUPABASE_URL}/rest/v1/orders?id=eq.${orderResult.order.id}&select=*" -H "apikey: ${ANON_KEY}"\n`);

    // Summary
    console.log('='.repeat(60));
    log('Test Data Summary:', 'blue');
    console.log('='.repeat(60));
    console.log(`  Order ID:      ${orderResult.order.id}`);
    console.log(`  Email:         ${testEmail}`);
    console.log(`  Amount:        €${orderResult.order.total_amount}`);
    console.log(`  Payment ID:    ${orderResult.payment.payment_id}`);
    console.log(`  Public Token:  ${orderResult.public_token}`);
    console.log(`  Checkout URL:  ${orderResult.checkout_url}`);
    console.log('='.repeat(60) + '\n');

  } else {
    log('⚠️ No checkout URL returned (order may be free)', 'yellow');
    console.log(JSON.stringify(orderResult, null, 2));
  }
}

main().catch(err => {
  log(`\n❌ Unexpected error: ${err.message}`, 'red');
  console.error(err);
  process.exit(1);
});
