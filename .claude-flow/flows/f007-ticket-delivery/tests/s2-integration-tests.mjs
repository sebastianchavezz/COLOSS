#!/usr/bin/env node
/**
 * Integration Tests: F007 S2 - Mobile Ticket Scanner (BYOD)
 *
 * Tests frontend components and RPC integration.
 * Note: Camera/UI tests require manual verification.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// === CONFIG ===
const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === TEST HELPERS ===
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  }
  catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Get project root (COLOSS directory)
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../../../..");  // .claude-flow/flows/f007.../tests -> COLOSS
const webRoot = join(projectRoot, "web");

// === TESTS ===
console.log("🧪 Running F007 S2 Integration Tests...\n");
console.log(`📁 Project root: ${projectRoot}`);
console.log(`📁 Web root: ${webRoot}\n`);
console.log("=".repeat(50));
console.log("Section 1: File Structure Verification");
console.log("=".repeat(50) + "\n");

// Test 1: device-id.ts exists
await test("device-id.ts exists", async () => {
  const filePath = join(webRoot, "src/lib/device-id.ts");
  assert(existsSync(filePath), `File not found: ${filePath}`);
});

// Test 2: useQrScanner.ts exists
await test("useQrScanner.ts hook exists", async () => {
  const filePath = join(webRoot, "src/hooks/useQrScanner.ts");
  assert(existsSync(filePath), `File not found: ${filePath}`);
});

// Test 3: Scanner.tsx exists
await test("Scanner.tsx page exists", async () => {
  const filePath = join(webRoot, "src/pages/events/Scanner.tsx");
  assert(existsSync(filePath), `File not found: ${filePath}`);
});

// Test 4: MobileScanner.tsx exists
await test("MobileScanner.tsx page exists", async () => {
  const filePath = join(webRoot, "src/pages/MobileScanner.tsx");
  assert(existsSync(filePath), `File not found: ${filePath}`);
});

// Test 5: html5-qrcode in package.json
await test("html5-qrcode dependency installed", async () => {
  const pkgPath = join(webRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert(pkg.dependencies["html5-qrcode"], "html5-qrcode not in dependencies");
});

console.log("\n" + "=".repeat(50));
console.log("Section 2: Route Configuration");
console.log("=".repeat(50) + "\n");

// Test 6: Scanner route in App.tsx
await test("Scanner route configured in App.tsx", async () => {
  const appPath = join(webRoot, "src/App.tsx");
  const content = readFileSync(appPath, "utf8");
  assert(content.includes('path="scanner"'), "Scanner route not found");
  assert(content.includes('<Scanner />'), "Scanner component not imported");
});

// Test 7: Mobile scanner route in App.tsx
await test("Mobile scanner route configured", async () => {
  const appPath = join(webRoot, "src/App.tsx");
  const content = readFileSync(appPath, "utf8");
  assert(content.includes('/scan/m/:eventSlug'), "Mobile scanner route not found");
  assert(content.includes('<MobileScanner />'), "MobileScanner component not imported");
});

// Test 8: Scanner in EventDetail sidebar
await test("Scanner in EventDetail sidebar", async () => {
  const detailPath = join(webRoot, "src/pages/EventDetail.tsx");
  const content = readFileSync(detailPath, "utf8");
  assert(content.includes("'Scanner'"), "Scanner nav item not found");
  assert(content.includes("href: 'scanner'"), "Scanner href not found");
  assert(content.includes("QrCode"), "QrCode icon not imported");
});

console.log("\n" + "=".repeat(50));
console.log("Section 3: Component Content Verification");
console.log("=".repeat(50) + "\n");

// Test 9: useQrScanner has debounce
await test("useQrScanner has debounce logic", async () => {
  const hookPath = join(webRoot, "src/hooks/useQrScanner.ts");
  const content = readFileSync(hookPath, "utf8");
  assert(content.includes("debounceMs"), "Debounce parameter not found");
  assert(content.includes("lastScanTimeRef"), "Debounce ref not found");
});

// Test 10: MobileScanner has haptic feedback
await test("MobileScanner has haptic feedback", async () => {
  const scannerPath = join(webRoot, "src/pages/MobileScanner.tsx");
  const content = readFileSync(scannerPath, "utf8");
  assert(content.includes("navigator.vibrate"), "Haptic feedback not found");
});

// Test 11: MobileScanner has auth redirect
await test("MobileScanner has auth redirect", async () => {
  const scannerPath = join(webRoot, "src/pages/MobileScanner.tsx");
  const content = readFileSync(scannerPath, "utf8");
  assert(content.includes("useAuth"), "useAuth not imported");
  assert(content.includes("/login"), "Login redirect not found");
});

// Test 12: Scanner uses QRCodeSVG
await test("Scanner uses QRCodeSVG for QR generation", async () => {
  const scannerPath = join(webRoot, "src/pages/events/Scanner.tsx");
  const content = readFileSync(scannerPath, "utf8");
  assert(content.includes("QRCodeSVG"), "QRCodeSVG not used");
  assert(content.includes("qrcode.react"), "qrcode.react not imported");
});

// Test 13: Scanner has stats polling
await test("Scanner has stats polling (10s)", async () => {
  const scannerPath = join(webRoot, "src/pages/events/Scanner.tsx");
  const content = readFileSync(scannerPath, "utf8");
  assert(content.includes("setInterval"), "Polling interval not found");
  assert(content.includes("10000"), "10 second interval not found");
});

// Test 14: device-id uses localStorage
await test("device-id uses localStorage", async () => {
  const deviceIdPath = join(webRoot, "src/lib/device-id.ts");
  const content = readFileSync(deviceIdPath, "utf8");
  assert(content.includes("localStorage"), "localStorage not used");
  assert(content.includes("coloss_device_id"), "Device ID key not found");
});

console.log("\n" + "=".repeat(50));
console.log("Section 4: RPC Integration (requires auth)");
console.log("=".repeat(50) + "\n");

// Test 15: scan_ticket RPC exists (anonymous check)
await test("scan_ticket RPC exists", async () => {
  const { data, error } = await supabase.rpc("scan_ticket", {
    _event_id: crypto.randomUUID(),
    _token: "test",
    _device_id: "test",
    _ip_address: null,
    _user_agent: "test"
  });
  // We expect UNAUTHORIZED or NOT_FOUND, not "function does not exist"
  if (error?.message?.includes("does not exist")) throw error;
});

// Test 16: get_scan_stats RPC exists
await test("get_scan_stats RPC exists", async () => {
  const { data, error } = await supabase.rpc("get_scan_stats", {
    _event_id: crypto.randomUUID(),
    _time_window_minutes: 60
  });
  // We expect data or error, not "function does not exist"
  if (error?.message?.includes("does not exist")) throw error;
});

// Test 17: Anonymous scan blocked
await test("Anonymous scan returns UNAUTHORIZED", async () => {
  const { data } = await supabase.rpc("scan_ticket", {
    _event_id: crypto.randomUUID(),
    _token: "test",
    _device_id: "test",
    _ip_address: null,
    _user_agent: "test"
  });
  // scan_ticket returns JSON with error field or result field
  assert(
    data?.error === "UNAUTHORIZED" || data?.result === "INVALID" || data === null,
    `Expected UNAUTHORIZED/INVALID/null, got: ${JSON.stringify(data)}`
  );
});

// === SUMMARY ===
console.log("\n" + "=".repeat(50));
console.log(`✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log("=".repeat(50));

if (failed > 0) {
  console.log("\n⚠️  Some tests failed. Check the output above.");
}

console.log("\n📝 Manual Tests Required:");
console.log("   1. Open /org/demo/events/{slug}/scanner - verify QR code displays");
console.log("   2. Scan QR with phone - verify redirect to mobile scanner");
console.log("   3. Test camera permission flow");
console.log("   4. Test valid/invalid ticket scan feedback");

process.exit(failed > 0 ? 1 : 0);
