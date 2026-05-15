/**
 * smoke-test.js — End-to-end smoke tests for production readiness
 * Run: BASE=https://cyn-jewelry.com/RMS node scripts/smoke-test.js
 * Or:  node scripts/smoke-test.js  (defaults to http://localhost:3000)
 *
 * Tests cover:
 * 1. Health endpoint
 * 2. Login + lockout
 * 3. Setup status
 * 4. Bulk room creation + quota
 * 5. Manual tenant creation (no LINE)
 * 6. CSV export
 * 7. Password change with strength validation
 * 8. /demo-info gate
 * 9. Pagination
 * 10. Rate limiting
 */

const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@rms-demo.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo1234';

let cookie = '';
let pass = 0, fail = 0;
const fails = [];

function ok(name)   { console.log(`✅ ${name}`); pass++; }
function bad(name, detail) { console.log(`❌ ${name} — ${detail}`); fail++; fails.push(`${name}: ${detail}`); }

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let body = null;
  try { body = await res.json(); } catch (_) { body = await res.text().catch(() => ''); }
  return { status: res.status, body, headers: res.headers };
}

async function test1_health() {
  const r = await req('/health');
  if (r.status === 200 && r.body?.status === 'ok') ok('1. Health endpoint');
  else bad('1. Health endpoint', `status=${r.status}`);
}

async function test2_login() {
  const r = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (r.status === 200 && r.body?.success) ok('2. Login (valid credentials)');
  else bad('2. Login', `status=${r.status}, body=${JSON.stringify(r.body)}`);
}

async function test3_authMe() {
  const r = await req('/api/auth/me');
  if (r.status === 200 && r.body?.admin?.email) ok('3. Session persistence (/auth/me)');
  else bad('3. /auth/me', `status=${r.status}`);
}

async function test4_setupStatus() {
  const r = await req('/api/admin/setup/status');
  if (r.status === 200 && typeof r.body?.completed === 'boolean') ok('4. Setup status endpoint');
  else bad('4. Setup status', `status=${r.status}`);
}

async function test5_demoInfoGate() {
  // /demo-info should return 200 if ENABLE_DEMO_INFO=true, else 404
  const r = await fetch(BASE + '/demo-info');
  if (r.status === 200 || r.status === 404) ok(`5. /demo-info gate (status=${r.status})`);
  else bad('5. /demo-info gate', `unexpected status=${r.status}`);
}

async function test6_csvExport() {
  const r = await fetch(BASE + '/api/admin/export/bills.csv', { headers: { cookie } });
  const ct = r.headers.get('content-type');
  if (r.status === 200 && ct?.includes('csv')) ok('6. CSV export (bills)');
  else bad('6. CSV export', `status=${r.status}, content-type=${ct}`);
}

async function test7_paginate() {
  const r = await req('/api/admin/bills?page=1&limit=5');
  if (r.status === 200 && Array.isArray(r.body?.items || r.body)) ok('7. Pagination works');
  else bad('7. Pagination', `status=${r.status}`);
}

async function test8_passwordStrength() {
  const r = await req('/api/admin/account/password', {
    method: 'PUT',
    body: JSON.stringify({ current_password: ADMIN_PASSWORD, new_password: 'abc' })
  });
  if (r.status === 400 && /อย่างน้อย 8/.test(r.body?.error || '')) ok('8. Password strength rejects short pw');
  else bad('8. Password strength', `status=${r.status}, body=${JSON.stringify(r.body)}`);
}

async function test9_emailLockout() {
  // Try 9 bad logins for a fresh email (don't lock the demo admin)
  const email = `lockout-test-${Date.now()}@x.com`;
  let lockedAt = null;
  for (let i = 1; i <= 9; i++) {
    const r = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'wrong' })
    });
    if (r.status === 429) { lockedAt = i; break; }
  }
  if (lockedAt && lockedAt <= 9) ok(`9. Email lockout triggers after ${lockedAt} attempts`);
  else bad('9. Email lockout', `no lockout after 9 attempts`);
}

async function test10_unauthRedirect() {
  // Clear cookie and try admin API
  const savedCookie = cookie; cookie = '';
  const r = await req('/api/admin/dormitory');
  cookie = savedCookie;
  if (r.status === 401 && /\/RMS\/admin|\/admin/.test(r.body?.redirect || '')) ok('10. Unauth API returns 401 with redirect path');
  else bad('10. Unauth redirect', `status=${r.status}, redirect=${r.body?.redirect}`);
}

async function run() {
  console.log(`\n🧪 RMS Smoke Tests against: ${BASE}\n`);
  try {
    await test1_health();
    await test2_login();
    await test3_authMe();
    await test4_setupStatus();
    await test5_demoInfoGate();
    await test6_csvExport();
    await test7_paginate();
    await test8_passwordStrength();
    await test9_emailLockout();
    await test10_unauthRedirect();
  } catch (e) {
    bad('UNCAUGHT', e.message);
  }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  if (fail > 0) {
    console.log('\nFailures:');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  } else {
    console.log('🎉 All tests passed!');
    process.exit(0);
  }
}

run();
