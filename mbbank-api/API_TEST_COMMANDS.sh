#!/bin/bash

# =============================================================================
# MBBank API Test Commands
# =============================================================================
# Usage: Copy and paste these curl commands to test your API
# Replace placeholders:
#   - YOUR_API_URL: Your actual API endpoint (e.g., http://localhost:8081)
#   - YOUR_ACCESS_TOKEN: Your valid MBBank API access token
# =============================================================================

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

API_URL="http://localhost:8081"  # ⚠️ CHANGE THIS
TOKEN="J-QWHKFfU56coJKJZYfbDkpL7F76YW-YYPgHXcoOFD8"   # ⚠️ CHANGE THIS

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}MBBank API Smart Filter Tests${NC}"
echo -e "${BLUE}==============================================================================${NC}\n"

# =============================================================================
# Test 1: Basic endpoint (backward compatibility)
# =============================================================================
echo -e "${GREEN}Test 1: Basic endpoint - Get all transactions (last 7 days, no filters)${NC}"
echo -e "Expected: Returns all transactions with default behavior\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "from_date": null,
    "to_date": null
  }' | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 2: Filter by date (today only)
# =============================================================================
echo -e "${GREEN}Test 2: Filter by date - Get transactions from today only${NC}"
echo -e "Expected: Returns only today's transactions\n"

TODAY=$(date +%Y-%m-%d)

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\"
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 3: Filter by description
# =============================================================================
echo -e "${GREEN}Test 3: Filter by description - Find transactions containing 'DH'${NC}"
echo -e "Expected: Returns only transactions with 'DH' in description (case-insensitive)\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"description_contains\": \"DH\"
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 4: Filter by amount range
# =============================================================================
echo -e "${GREEN}Test 4: Filter by amount - Transactions between 100,000 and 1,000,000 VND${NC}"
echo -e "Expected: Returns only transactions in specified amount range\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"min_amount\": 100000,
    \"max_amount\": 1000000
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 5: Limit results
# =============================================================================
echo -e "${GREEN}Test 5: Limit results - Get only top 10 transactions${NC}"
echo -e "Expected: Returns maximum 10 transactions\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"limit\": 10
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 6: Sort order
# =============================================================================
echo -e "${GREEN}Test 6: Sort order - Ascending amount${NC}"
echo -e "Expected: Returns transactions sorted by amount (lowest first)\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"sort_order\": \"asc\",
    \"limit\": 5
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 7: Combined filters (SMART SYNC SIMULATION)
# =============================================================================
echo -e "${GREEN}Test 7: Smart Sync simulation - Today's transactions with 'DH' prefix, limited${NC}"
echo -e "Expected: Mimics WordPress smart_sync_pending_orders() behavior\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"description_contains\": \"DH\",
    \"limit\": 100
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 8: All filters combined
# =============================================================================
echo -e "${GREEN}Test 8: All filters - Description + Amount range + Limit + Sort${NC}"
echo -e "Expected: Returns filtered, sorted, and limited results\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"description_contains\": \"CHUYEN TIEN\",
    \"min_amount\": 50000,
    \"max_amount\": 5000000,
    \"limit\": 20,
    \"sort_order\": \"desc\"
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 9: Error handling - Invalid date
# =============================================================================
echo -e "${GREEN}Test 9: Error handling - Future date (should fail)${NC}"
echo -e "Expected: Returns error about future date not allowed\n"

TOMORROW=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "+1 day" +%Y-%m-%d)

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TOMORROW}\",
    \"to_date\": \"${TOMORROW}\"
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 10: Error handling - Invalid limit
# =============================================================================
echo -e "${GREEN}Test 10: Error handling - Limit > 1000 (should fail)${NC}"
echo -e "Expected: Returns validation error for limit\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"limit\": 5000
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 11: Performance test - Response metadata
# =============================================================================
echo -e "${GREEN}Test 11: Check response metadata${NC}"
echo -e "Expected: Response includes 'count', 'filtered', 'date_range' fields\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"description_contains\": \"DH\",
    \"limit\": 10
  }" | jq '{
    success: .success,
    count: .count,
    filtered: .filtered,
    date_range: .date_range,
    request_id: .request_id,
    result_sample: .results[0]
  }'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 12: SQL Injection attempt (security test)
# =============================================================================
echo -e "${GREEN}Test 12: Security test - SQL injection attempt in description${NC}"
echo -e "Expected: Request should be rejected or safely handled\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"description_contains\": \"DH'; DROP TABLE transactions; --\"
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"
sleep 2

# =============================================================================
# Test 13: Empty results test
# =============================================================================
echo -e "${GREEN}Test 13: Empty results - Search for non-existent pattern${NC}"
echo -e "Expected: Returns empty results array with count=0\n"

curl -X POST "${API_URL}/transactions/credit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"from_date\": \"${TODAY}\",
    \"to_date\": \"${TODAY}\",
    \"description_contains\": \"XXXNONEXISTENTXXX123\"
  }" | jq '.'

echo -e "\n${BLUE}---${NC}\n"

# =============================================================================
# Summary
# =============================================================================
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}✅ All tests completed!${NC}"
echo -e "${BLUE}==============================================================================${NC}\n"

echo "Next steps:"
echo "1. Verify all responses are valid JSON"
echo "2. Check that filters are working correctly"
echo "3. Confirm metadata (count, filtered, date_range) is present"
echo "4. Test with your actual WordPress plugin"
echo ""

