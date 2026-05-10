const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');

// Admin Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'กรุณากรอก email และ password' });

  const admin = db.prepare(`
    SELECT a.*, d.name as dormitory_name
    FROM admin_users a
    JOIN dormitories d ON a.dormitory_id = d.id
    WHERE a.email = ?
  `).get(email);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Email หรือ Password ไม่ถูกต้อง' });
  }

  req.session.adminId = admin.id;
  req.session.dormitoryId = admin.dormitory_id;

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
