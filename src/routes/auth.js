const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');

// ============================================================
// Per-email lockout helpers
// ============================================================
const MAX_FAIL = 8;          // lock after 8 failed attempts
const LOCK_MINUTES = 15;     // lock duration

function checkLockout(email) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE email=?').get(email);
  if (!row) return null;
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000);
    return { locked: true, retry_after_minutes: mins };
  }
  return null;
}

function recordFail(email) {
  const row = db.prepare('SELECT fail_count FROM login_attempts WHERE email=?').get(email);
  const newCount = (row?.fail_count || 0) + 1;
  const locked = newCount >= MAX_FAIL
    ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
    : null;
  db.prepare(`INSERT INTO login_attempts (email, fail_count, last_fail_at, locked_until)
    VALUES (?,?,datetime('now'),?)
    ON CONFLICT(email) DO UPDATE SET
      fail_count=excluded.fail_count,
      last_fail_at=excluded.last_fail_at,
      locked_until=excluded.locked_until`).run(email, newCount, locked);
}

function clearFails(email) {
  db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
}

// Admin Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'กรุณากรอก email และ password' });
  const emailLower = String(email).toLowerCase().trim();

  // Check lockout first
  const lock = checkLockout(emailLower);
  if (lock?.locked) {
    return res.status(429).json({
      error: `บัญชีถูกล็อกชั่วคราว กรุณารออีก ${lock.retry_after_minutes} นาที`,
      retry_after_minutes: lock.retry_after_minutes
    });
  }

  const admin = db.prepare(`
    SELECT a.*, d.name as dormitory_name
    FROM admin_users a
    JOIN dormitories d ON a.dormitory_id = d.id
    WHERE LOWER(a.email) = ?
  `).get(emailLower);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    recordFail(emailLower);
    return res.status(401).json({ error: 'Email หรือ Password ไม่ถูกต้อง' });
  }

  clearFails(emailLower);
  req.session.adminId = admin.id;
  req.session.dormitoryId = admin.dormitory_id;

  // Audit
  try {
    db.prepare("INSERT INTO admin_audit_log (admin_user_id, action, ip) VALUES (?,?,?)")
      .run(admin.id, 'login', req.ip || '');
  } catch (_) {}

  res.json({
    success: true,
    admin: { id: admin.id, name: admin.name, email: admin.email, dormitory_name: admin.dormitory_name }
  });
});

// Admin Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET current session info
router.get('/me', (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: 'Not authenticated' });

  const admin = db.prepare(`
    SELECT a.id, a.name, a.email, d.name as dormitory_name, d.id as dormitory_id
    FROM admin_users a JOIN dormitories d ON a.dormitory_id = d.id
    WHERE a.id = ?
  `).get(req.session.adminId);

  // include role for active dormitory
  const role = db.prepare(`SELECT role FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?`)
    .get(admin.id, admin.dormitory_id);

  res.json({ admin: { ...admin, role: role?.role || 'owner' } });
});

// ============================================================
// LIFF: LINE Login callback — ลูกบ้าน login ผ่าน LINE
// ============================================================
router.post('/line/verify', async (req, res) => {
  const { accessToken, dormitoryId } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Missing access token' });

  try {
    // Verify token กับ LINE
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!profileRes.ok) return res.status(401).json({ error: 'Invalid LINE token' });
    const profile = await profileRes.json();

    // หา tenant จาก line_user_id
    const tenant = db.prepare(`
      SELECT t.*, r.room_number, r.monthly_rent, r.id as room_id, r.dormitory_id
      FROM tenants t
      JOIN rooms r ON t.room_id = r.id
      WHERE t.line_user_id = ? AND r.dormitory_id = ?
    `).get(profile.userId, dormitoryId);

    // อัปเดต display_name/picture
    if (tenant) {
      db.prepare('UPDATE tenants SET display_name=?, picture_url=? WHERE line_user_id=?')
        .run(profile.displayName, profile.pictureUrl, profile.userId);
    }

    req.session.lineUserId = profile.userId;
    req.session.dormitoryId = dormitoryId;
    req.session.tenantRoomId = tenant?.room_id || null;

    res.json({
      success: true,
      profile: { userId: profile.userId, displayName: profile.displayName, pictureUrl: profile.pictureUrl },
      tenant: tenant ? { room_number: tenant.room_number, room_id: tenant.room_id } : null,
      registered: !!tenant
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
