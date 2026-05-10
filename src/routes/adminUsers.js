const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAdmin, loadAdmin } = require('../middleware/auth');
const { requirePermission, attachRole, PERMISSIONS, ROLE_LABELS } = require('../middleware/rbac');

router.use(loadAdmin);
router.use(requireAdmin);
router.use(attachRole);

// Only owner can manage admins
const requireOwner = (req, res, next) => {
  if (req.role !== 'owner') return res.status(403).json({ error: 'เฉพาะเจ้าของหอ (owner) เท่านั้น' });
  next();
};

// GET roles + permission matrix (for UI)
router.get('/admins/roles', (req, res) => {
  res.json({ roles: ROLE_LABELS, permissions: PERMISSIONS });
});

// GET current user's role
router.get('/admins/me/role', (req, res) => {
  res.json({ role: req.role, label: ROLE_LABELS[req.role] || req.role });
});

// LIST admins for current dormitory (must be owner)
router.get('/admins', requireOwner, (req, res) => {
  const list = db.prepare(`
    SELECT au.id, au.name, au.email, au.line_user_id,
      oda.role, oda.is_default, oda.created_at,
      (SELECT 1 FROM admin_line_links WHERE admin_user_id=au.id AND dormitory_id=?) as has_line
    FROM admin_users au
    JOIN owner_dormitory_access oda ON au.id=oda.admin_user_id
    WHERE oda.dormitory_id=?
    ORDER BY oda.role, au.name
  `).all(req.dormitoryId, req.dormitoryId);
  res.json(list);
});

// CREATE admin + grant access to current dormitory
router.post('/admins', requireOwner, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name/email/password required' });
  if (!['owner','admin','manager','technician'].includes(role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });

  const exists = db.prepare('SELECT id FROM admin_users WHERE email=?').get(email);
  if (exists) {
    // Already exists — just grant access
    db.prepare(`INSERT OR REPLACE INTO owner_dormitory_access (admin_user_id, dormitory_id, role) VALUES (?,?,?)`)
      .run(exists.id, req.dormitoryId, role);
    return res.json({ id: exists.id, granted_existing: true });
  }

  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare(`INSERT INTO admin_users (dormitory_id, name, email, password_hash) VALUES (?,?,?,?)`)
    .run(req.dormitoryId, name, email, hash);

  db.prepare(`INSERT INTO owner_dormitory_access (admin_user_id, dormitory_id, role) VALUES (?,?,?)`)
    .run(r.lastInsertRowid, req.dormitoryId, role);

  res.json({ id: r.lastInsertRowid, success: true });
});

// UPDATE admin (name/role/password)
router.put('/admins/:id', requireOwner, (req, res) => {
  const targetId = parseInt(req.params.id);
  const access = db.prepare(`SELECT * FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?`)
    .get(targetId, req.dormitoryId);
  if (!access) return res.status(404).json({ error: 'Not found' });

  const { name, role, password } = req.body;

  // ห้าม downgrade ตัวเอง (ป้องกัน lockout)
  if (targetId === req.session.adminId && role && role !== 'owner') {
    return res.status(400).json({ error: 'ห้ามเปลี่ยน role ของตัวเอง — ให้ owner คนอื่นเปลี่ยนให้' });
  }

  if (name) db.prepare('UPDATE admin_users SET name=? WHERE id=?').run(name, targetId);
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(hash, targetId);
  }
  if (role) {
    if (!['owner','admin','manager','technician'].includes(role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
    db.prepare(`UPDATE owner_dormitory_access SET role=? WHERE admin_user_id=? AND dormitory_id=?`)
      .run(role, targetId, req.dormitoryId);
  }
  res.json({ success: true });
});

// REVOKE access (lib not delete user — just remove from this dormitory)
router.delete('/admins/:id', requireOwner, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.session.adminId) {
    return res.status(400).json({ error: 'ห้ามถอดสิทธิ์ตัวเอง' });
  }
  // Make sure at least 1 owner remains
  const owners = db.prepare(`SELECT COUNT(*) as c FROM owner_dormitory_access
    WHERE dormitory_id=? AND role='owner' AND admin_user_id != ?`).get(req.dormitoryId, targetId);
  const target = db.prepare(`SELECT role FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?`)
    .get(targetId, req.dormitoryId);
  if (target?.role === 'owner' && owners.c === 0) {
    return res.status(400).json({ error: 'ต้องมี owner อย่างน้อย 1 คน' });
  }

  db.prepare(`DELETE FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?`)
    .run(targetId, req.dormitoryId);

  // ถ้า admin คนนี้ไม่ได้เข้าหอไหนแล้ว — ลบทั้งคน
  const remaining = db.prepare('SELECT COUNT(*) as c FROM owner_dormitory_access WHERE admin_user_id=?').get(targetId);
  if (remaining.c === 0) db.prepare('DELETE FROM admin_users WHERE id=?').run(targetId);

  res.json({ success: true });
});

module.exports = router;
