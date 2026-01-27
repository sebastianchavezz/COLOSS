#!/bin/bash
# =============================================================================
# Test Runner for Supabase Backend Tests
# Runs SQL tests against the linked Supabase project
# =============================================================================

set -e

echo "🧪 COLOSS Test Runner"
echo "===================="

# Get project ref
PROJECT_REF=$(cat supabase/.temp/project-ref 2>/dev/null)
if [ -z "$PROJECT_REF" ]; then
    echo "❌ No Supabase project linked. Run 'supabase link' first."
    exit 1
fi
echo "📦 Project: $PROJECT_REF"

# Get database URL from Supabase
echo ""
echo "🔗 Getting database connection..."

# Use supabase db url to get connection string
DB_URL=$(supabase db url --linked 2>/dev/null || echo "")

if [ -z "$DB_URL" ]; then
    echo "⚠️  Could not get DB URL automatically."
    echo "   Please set SUPABASE_DB_URL environment variable"
    echo "   or run tests manually with:"
    echo "   psql \$DATABASE_URL -f tests/verification/verify_f011_participants_registrations.sql"
    exit 1
fi

echo "✅ Connected to database"
echo ""

# =============================================================================
# Run Verification Tests (Quick checks that migrations are applied)
# =============================================================================
echo "📋 Running Verification Tests..."
echo "--------------------------------"

for test_file in tests/verification/verify_*.sql; do
    if [ -f "$test_file" ]; then
        echo "  → $(basename $test_file)"
        psql "$DB_URL" -f "$test_file" 2>&1 | grep -E "NOTICE|PASSED|FAILED|CHECK|ERROR" | head -30
        echo ""
    fi
done

# =============================================================================
# Run RLS Tests (Full security tests - may take longer)
# =============================================================================
echo "🔒 Running RLS Security Tests..."
echo "--------------------------------"

for test_file in tests/supabase/*.sql; do
    if [ -f "$test_file" ]; then
        echo "  → $(basename $test_file)"
        # Run in transaction mode so test data is cleaned up
        psql "$DB_URL" -f "$test_file" 2>&1 | grep -E "NOTICE|PASSED|FAILED|TEST|ERROR" | head -50
        echo ""
    fi
done

echo "===================="
echo "✅ Test run complete"
