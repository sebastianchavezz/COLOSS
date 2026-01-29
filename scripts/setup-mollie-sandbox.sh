#!/bin/bash
#
# Mollie Sandbox Setup Script
# Usage: ./scripts/setup-mollie-sandbox.sh
#

echo "=================================================="
echo "🔧 Mollie Sandbox Setup"
echo "=================================================="
echo ""

# Check if MOLLIE_API_KEY is already set
EXISTING_KEY=$(npx supabase secrets list 2>/dev/null | grep MOLLIE_API_KEY)

if [ -n "$EXISTING_KEY" ]; then
    echo "✅ MOLLIE_API_KEY is already configured"
    echo ""
    echo "To update it, run:"
    echo "  npx supabase secrets set MOLLIE_API_KEY=test_your_new_key"
    echo ""
else
    echo "❌ MOLLIE_API_KEY is NOT configured"
    echo ""
    echo "📋 Follow these steps:"
    echo ""
    echo "1. Go to https://my.mollie.com/dashboard"
    echo "2. Navigate to: Settings → Website profiles → [Your Profile] → API keys"
    echo "3. Copy the 'Test API key' (starts with 'test_')"
    echo "4. Run this command with your key:"
    echo ""
    echo "   npx supabase secrets set MOLLIE_API_KEY=test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    echo ""
fi

# Check for paid orders that can be used for testing
echo "=================================================="
echo "📦 Looking for testable orders..."
echo "=================================================="
echo ""

# We can't query the database directly from bash, but we can suggest
echo "To find a paid order for testing, run this SQL in Supabase Dashboard:"
echo ""
echo "  SELECT o.id, o.email, o.total_amount, o.status, p.provider_payment_id"
echo "  FROM orders o"
echo "  JOIN payments p ON p.order_id = o.id"
echo "  WHERE o.status = 'paid'"
echo "  ORDER BY o.created_at DESC"
echo "  LIMIT 5;"
echo ""

echo "=================================================="
echo "🧪 To test refunds:"
echo "=================================================="
echo ""
echo "1. First, get a user token by logging in"
echo "2. Then run the test script:"
echo ""
echo "   cd .claude-flow/flows/f009-refund-flow/tests"
echo "   node test-refund-sandbox.mjs --order-id=YOUR_ORDER_ID --token=YOUR_JWT"
echo ""
echo "Or use environment variables:"
echo ""
echo "   TEST_ORDER_ID=xxx TEST_USER_TOKEN=xxx node test-refund-sandbox.mjs"
echo ""
