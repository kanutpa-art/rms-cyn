const router = require('express').Router();
const db = require('../db/database');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Upload สลิป
const slipStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/slips');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `slip_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`)
});

// Upload รูปแจ้งซ่อม
const maintenanceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/maintenance');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `maint_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`)
});

const uploadSlip = multer({ storage: slipStorage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadMaint = multer({ storage: maintenanceStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ตรวจสอบ LINE session ก่อน
function requireTenant(req, res, next) {
  if (req.session?.lineUserId) return next();
  res.status(401).json({ error: 'กรุณา login ด้วย LINE ก่อนนะคะ' });
}

// ============================================================
// Invite link info (public — ไม่ต้อง auth)
// ============================================================
router.get('/invite/:token', (req, res) => {
  const invite = db.prepare(`
    SELECT ri.*, r.room_number, r.monthly_rent, d.name as dormitory_name
    FROM room_invites ri
    JOIN rooms r ON ri.room_id = r.id
    JOIN dormitories d ON r.dormitory_id = d.id
    WHERE ri.token = ?
  `).get(req.params.token);

  if (!invite) return res.status(404).json({ error: 'ไม่พบ Invite Link' });
  if (invite.used_at) return res.status(410).json({ error: 'ลิงก์ถูกใช้ไปแล้ว' });
  if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'ลิงก์หมดอายุแล้ว' });

  res.json({
    room_number: invite.room_number,
    monthly_rent: invite.monthly_rent,
    dormitory_name: invite.dormitory_name,
    expires_at: invite.expires_at
  });
});

// ============================================================
// Dashboard ลูกบ้าน
// ============================================================
router.get('/me', requireTenant, (req, res) => {
  const { lineUserId, dormitoryId } = req.session;

  const tenant = db.prepare(`
    SELECT t.*, r.room_number, r.monthly_rent, r.id as room_id, d.name as dormitory_name, d.liff_id
    FROM tenants t
    JOIN rooms r ON t.room_id = r.id
    JOIN dormitories d ON r.dormitory_id = d.id
    WHERE t.line_user_id = ? AND r.dormitory_id = ?
  `).get(lineUserId, dormitoryId);

  if (!tenant) return res.status(404).json({ error: 'ไม่พบข้อมูลห้อง' });

  const latestBill = db.prepare('SELECT * FROM bills WHERE room_id=? ORDER BY billing_month DESC LIMIT 1').get(tenant.room_id);
  const billHistory = db.prepare('SELECT * FROM bills WHERE room_id=? ORDER BY billing_month DESC LIMIT 6').all(tenant.room_id);
  const pendingMaintenance = db.prepare("SELECT COUNT(*) as c FROM maintenance_requests WHERE room_id=? AND status!='completed'").get(tenant.room_id);

  res.json({ tenant, latestBill, billHistory, pendingMaintenance: pendingMaintenance.c });
});

// ============================================================
// Bills list (สำหรับลูกบ้านดูบิลทั้งหมดของห้องตัวเอง)
// ============================================================
router.get('/bills', requireTenant, (req, res) => {
  const { lineUserId, dormitoryId } = req.session;
  const { status, limit } = req.query;

  const tenant = db.prepare(`
    SELECT t.id, t.room_id FROM tenants t
    JOIN rooms r ON t.room_id = r.id
    WHERE t.line_user_id = ? AND r.dormitory_id = ?
  `).get(lineUserId, dormitoryId);

  if (!tenant) return res.status(404).json({ error: 'ไม่พบข้อมูลห้อง' });

  const where = ['room_id = ?'];
  const params = [tenant.room_id];
  if (status) { where.push('status = ?'); params.push(status); }

  const lim = Math.min(parseInt(limit) || 24, 100);
  const bills = db.prepare(`
    SELECT id, billing_month, rent_amount, water_amount, electric_amount,
           other_label, other_amount, total_amount, status, due_date, paid_at, created_at
    FROM bills WHERE ${where.join(' AND ')}
    ORDER BY billing_month DESC LIMIT ?
  `).all(...params, lim);

  const today = new Date().toISOString().slice(0, 10);
  const enriched = bills.map(b => ({
    ...b,
    is_overdue: b.status === 'pending' && b.due_date && b.due_date < today
  }));

  res.json({ bills: enriched, room_id: tenant.room_id });
});

// ============================================================
// Bill detail
// ============================================================
router.get('/bills/:id', requireTenant, (req, res) => {
  const { lineUserId, dormitoryId } = req.session;

  const bill = db.prepare(`
    SELECT b.*, r.room_number, r.dormitory_id, d.name as dormitory_name,
      d.promptpay_number, d.promptpay_name
    FROM bills b JOIN rooms r ON b.room_id=r.id JOIN dormitories d ON r.dormitory_id=d.id
    WHERE b.id=?
  `).get(req.params.id);

  if (!bill || bill.dormitory_id !== dormitoryId) return res.status(404).json({ error: 'Not found' });

  // ตรวจว่าห้องนี้เป็นของ tenant คนนี้
  const tenant = db.prepare('SELECT * FROM tenants WHERE room_id=? AND line_user_id=?').get(bill.room_id, lineUserId);
  if (!tenant) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูบิลนี้' });

  const payments = db.prepare('SELECT * FROM payments WHERE bill_id=? ORDER BY created_at DESC').all(bill.id);
  res.json({ bill, payments });
});

// ============================================================
// ส่งสลิป (upload file)
// ============================================================
router.post('/bills/:id/pay', requireTenant, uploadSlip.single('slip'), async (req, res) => {
  const { lineUserId, dormitoryId } = req.session;

  const bill = db.prepare(`
    SELECT b.*, r.room_number, r.dormitory_id FROM bills b JOIN rooms r ON b.room_id=r.id
    WHERE b.id=? AND r.dormitory_id=?
  `).get(req.params.id, dormitoryId);

  if (!bill) return res.status(404).json({ error: 'Not found' });

  const tenant = db.prepare('SELECT * FROM tenants WHERE room_id=? AND line_user_id=?').get(bill.room_id, lineUserId);
  if (!tenant) return res.status(403).json({ error: 'Forbidden' });

  if (!['pending', 'overdue'].includes(bill.status)) {
    return res.status(400).json({ error: 'บิลนี้ไม่อยู่ในสถานะที่รับสลิปได้' });
  }

  const slipPath = req.file ? `uploads/slips/${req.file.filename}` : null;

  db.prepare(`
    INSERT INTO payments (bill_id, amount, method, slip_path, status, paid_at)
    VALUES (?,?,'transfer',?,'pending',datetime('now'))
  `).run(bill.id, bill.total_amount, slipPath);

  db.prepare("UPDATE bills SET status='reviewing' WHERE id=?").run(bill.id);

  // แจ้ง admin ผ่าน LINE (push ให้ admin ถ้ากำหนด admin_line_notify ไว้)
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormitoryId);

  res.json({ success: true, message: 'ส่งสลิปเรียบร้อยแล้วค่ะ รอแอดมินตรวจสอบภายใน 24 ชม.' });
});

// ============================================================
// แจ้งซ่อม
// ============================================================
router.get('/maintenance', requireTenant, (req, res) => {
  const { lineUserId, dormitoryId } = req.session;
  const tenant = db.prepare(`SELECT t.room_id FROM tenants t JOIN rooms r ON t.room_id=r.id WHERE t.line_user_id=? AND r.dormitory_id=?`).get(lineUserId, dormitoryId);
  if (!tenant) return res.status(404).json({ error: 'Not found' });

  const list = db.prepare('SELECT * FROM maintenance_requests WHERE room_id=? ORDER BY created_at DESC').all(tenant.room_id);
  res.json(list);
});

router.post('/maintenance', requireTenant, uploadMaint.single('image'), async (req, res) => {
  const { lineUserId, dormitoryId } = req.session;
  const { title, description } = req.body;

  if (!title) return res.status(400).json({ error: 'กรุณาระบุหัวข้อการแจ้งซ่อม' });

  const tenant = db.prepare(`
    SELECT t.*, r.room_number FROM tenants t JOIN rooms r ON t.room_id=r.id
    WHERE t.line_user_id=? AND r.dormitory_id=?
  `).get(lineUserId, dormitoryId);
  if (!tenant) return res.status(404).json({ error: 'Not found' });

  const imagePath = req.file ? `uploads/maintenance/${req.file.filename}` : null;
  const result = db.prepare(`
    INSERT INTO maintenance_requests (room_id, title, description, image_path) VALUES (?,?,?,?)
  `).run(tenant.room_id, title, description || '', imagePath);

  // แจ้ง LINE ยืนยันการรับเรื่อง
  const lineService = require('../services/lineService');
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(tenant.room_id);
  await lineService.pushMessage(dormitoryId, lineUserId, lineService.maintenanceConfirmMessage({ title }, room));

  res.json({ success: true, id: result.lastInsertRowid });
});

// ============================================================
// MY DOCUMENTS
// ============================================================
router.get('/documents', requireTenant, (req, res) => {
  const tenantService = require('../services/tenantService');
  const { lineUserId, dormitoryId } = req.session;
  const tenant = db.prepare(`SELECT t.id FROM tenants t JOIN rooms r ON t.room_id=r.id
    WHERE t.line_user_id=? AND r.dormitory_id=?`).get(lineUserId, dormitoryId);
  if (!tenant) return res.status(404).json({ error: 'Not found' });
  res.json(tenantService.getMyDocuments(tenant.id));
});

// ============================================================
// MOVE-OUT REQUEST
// ============================================================
router.get('/move-out', requireTenant, (req, res) => {
  const tenantService = require('../services/tenantService');
  const { lineUserId, dormitoryId } = req.session;
  const tenant = db.prepare(`SELECT t.id FROM tenants t JOIN rooms r ON t.room_id=r.id
    WHERE t.line_user_id=? AND r.dormitory_id=?`).get(lineUserId, dormitoryId);
  if (!tenant) return res.status(404).json({ error: 'Not found' });
  res.json(tenantService.getActiveMoveOutForTenant(tenant.id) || null);
});

router.post('/move-out', requireTenant, async (req, res) => {
  const tenantService = require('../services/tenantService');
  const lineService = require('../services/lineService');
  const { lineUserId, dormitoryId } = req.session;
  const tenant = db.prepare(`SELECT t.id, t.display_name, r.room_code, r.room_number FROM tenants t
    JOIN rooms r ON t.room_id=r.id WHERE t.line_user_id=? AND r.dormitory_id=?`).get(lineUserId, dormitoryId);
  if (!tenant) return res.status(404).json({ error: 'Not found' });
  const r = tenantService.createMoveOutRequest(tenant.id, req.body);

  // แจ้งแอดมิน
  const admins = db.prepare('SELECT line_user_id FROM admin_line_links WHERE dormitory_id=?').all(dormitoryId);
  for (const a of admins) {
    try {
      await lineService.pushMessage(dormitoryId, a.line_user_id, {
        type: 'text',
        text: `🏃 คำขอย้ายออก\nห้อง ${tenant.room_code || tenant.room_number}\nผู้เช่า: ${tenant.display_name || '-'}\nวันที่ขอย้าย: ${req.body.requested_date}\nเหตุผล: ${req.body.reason || '-'}`
      });
    } catch {}
  }
  res.json(r);
});

// ============================================================
// DEPOSIT TRACKER
// ============================================================
router.get('/deposit', requireTenant, (req, res) => {
  const tenantService = require('../services/tenantService');
  const { lineUserId, dormitoryId } = req.session;
  const tenant = db.prepare(`SELECT t.id FROM tenants t JOIN rooms r ON t.room_id=r.id
    WHERE t.line_user_id=? AND r.dormitory_id=?`).get(lineUserId, dormitoryId);
  if (!tenant) return res.status(404).json({ error: 'Not found' });
  res.json({
    balance: tenantService.depositBalance(tenant.id),
    transactions: tenantService.listDepositTxs(tenant.id)
  });
});

module.exports = router;
