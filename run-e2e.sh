#!/bin/bash
# PKWS E2E Test Runner v2
# Pre-configures the system via DB directly, then runs tests

set -e

ROOT_DIR="E:/primary/projects/persistent-knowledge-workflow-system"
cd "$ROOT_DIR"

echo "============================================"
echo " PKWS E2E Test Runner v2"
echo "============================================"

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up..."
  kill $SERVER_PID 2>/dev/null || true
  kill $VITE_PID 2>/dev/null || true
  # Kill all orphan vite and server processes
  taskkill /f /fi "WINDOWTITLE eq vite" 2>/dev/null || true
  lsof -i :3731 2>/dev/null | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# Step 0: Prepare
echo ""
echo "[0/5] Preparing test environment..."
rm -f apps/server/config.json
rm -f /e/tmp/test-workspace/db/pkws.sqlite

mkdir -p /e/tmp/test-vault/inbox
mkdir -p /e/tmp/test-workspace/db

echo "  ✓ Directories ready"

# Pre-configure DB (skip AI setup in setup wizard flow)
echo ""
echo "[1/5] Pre-configuring database..."
cd apps/server
node --experimental-sqlite --import tsx/esm -e "
import { initStorage, getClient } from '@pkws/storage';

initStorage('E:/tmp/test-workspace');
const client = getClient();

const now = new Date().toISOString();

// Insert settings directly
client.run(
  'INSERT INTO settings (id, vault_path, inbox_path, workspace_path, ai_provider, ai_base_url, ai_api_key_encrypted, ai_default_model, auto_analyze, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ['default', 'E:/tmp/test-vault', 'E:/tmp/test-vault/inbox', 'E:/tmp/test-workspace', 'openai-compatible', 'https://api.openai.com/v1', '', 'gpt-4.1-mini', 1, now, now]
);
console.log('  ✓ Settings pre-configured');
"
echo "  ✓ Database pre-configured"

# Write config.json so server starts in READY mode
cat > /e/primary/projects/persistent-knowledge-workflow-system/apps/server/config.json << 'EOF'
{
  "workspacePath": "E:/tmp/test-workspace",
  "updatedAt": "2026-06-30T08:00:00.000Z"
}
EOF
echo "  ✓ config.json written"

# Step 2: Start server
echo ""
echo "[2/5] Starting backend server..."
cd /e/primary/projects/persistent-knowledge-workflow-system/apps/server
node --experimental-sqlite --import tsx/esm src/index.ts &
SERVER_PID=$!
cd "$ROOT_DIR"
sleep 4

if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "  ✗ Server failed to start!"
  exit 1
fi

# Check health
HEALTH=$(curl -s http://127.0.0.1:3731/api/health 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "  ✓ Server running at http://127.0.0.1:3731 (SETUP NOT NEEDED)"
else
  echo "  ✗ Server health check failed"
  exit 1
fi

# Verify settings API works
SETTINGS=$(curl -s http://127.0.0.1:3731/api/settings)
if echo "$SETTINGS" | grep -q '"ok":true'; then
  echo "  ✓ Settings API working"
else
  echo "  ⚠ Settings response: $(echo $SETTINGS | head -c 100)"
fi

# Step 3: Start frontend
echo ""
echo "[3/5] Starting frontend dev server..."
cd apps/web
npx vite --port 5574 --host 127.0.0.1 &
VITE_PID=$!
cd "$ROOT_DIR"
sleep 4

if ! kill -0 $VITE_PID 2>/dev/null; then
  echo "  ✗ Frontend failed to start!"
  exit 1
fi

# Check frontend
FRONTEND_CHECK=$(curl -s http://127.0.0.1:5574 2>/dev/null | head -3 || echo "")
if echo "$FRONTEND_CHECK" | grep -qi "html"; then
  echo "  ✓ Frontend running at http://127.0.0.1:5574"
else
  echo "  ✗ Frontend check failed"
  exit 1
fi

# Step 4: Run E2E tests
echo ""
echo "[4/5] Running E2E tests..."
cd apps/web

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │ Running: setup-wizard.spec.ts               │"
echo "  └─────────────────────────────────────────────┘"
npx playwright test tests/e2e/setup-wizard.spec.ts --project=desktop-1280 --reporter=list 2>&1 | tail -20
SETUP_EXIT=$?

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │ Running: cases.spec.ts                      │"
echo "  └─────────────────────────────────────────────┘"
npx playwright test tests/e2e/cases.spec.ts --project=desktop-1280 --reporter=list 2>&1 | tail -20
CASES_EXIT=$?

# Step 5: Results
echo ""
echo "[5/5] Results"
echo "============================================"

if [ $SETUP_EXIT -eq 0 ]; then
  echo "  ✓ Setup Wizard tests: PASSED"
else
  echo "  ✗ Setup Wizard tests: FAILED (exit code $SETUP_EXIT)"
fi
if [ $CASES_EXIT -eq 0 ]; then
  echo "  ✓ Cases tests: PASSED"
else
  echo "  ✗ Cases tests: FAILED (exit code $CASES_EXIT)"
fi

echo ""
echo "Test reports saved in: apps/web/playwright-report/"
echo "============================================"

# Exit with failure if any test suite failed
if [ $SETUP_EXIT -ne 0 ] || [ $CASES_EXIT -ne 0 ]; then
  exit 1
fi
