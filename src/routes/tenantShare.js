const router = require('express').Router();
const db = require('../db/database');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { imageFileFilter, makeImageStorage, validateImageMagic } = require('../utils/fileFilter');

// ============================================================
// Uploads (for tenant share — slip + maintenance image)
// UUID filenames + MIME + magic byte validation
// ============================================================
const uploadSlip    = multer({ storage: makeImageStorage('slips'),       limits: { fileSize: 5 * 1024 * 1024 },       fileFilter: imageFileFilter });
const uploadMaint   = multer({ storage: makeImageStorage('maintenance'), limits: { fileSize: 5 * 1024 * 1024, files: 5 }, fileFilter: imageFileFilter });
const uploadMoveOut = multer({ storage: makeImageStorage('move_out'),    limits: { fileSize: 5 * 1024 * 1024, files: 5 }, fileFilter: imageFileFilter });
const uploadRenewal = multer({ storage: makeImageStorage('renewal'),     limits: { fileSize: 5 * 1024 * 1024, files: 5 }, fileFilter: imageFileFilter });

// ============================================================
// Helper: resolve tenant from share token
// ============================================================
function resolveTenant(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT t.id as tenant_id, t.room_id, r.dormitory_id
    FROM tenants t JOIN rooms r ON t.room_id = r.id
    WHERE t.share_token = ?
  `).get(token);
}

function requireTenantToken(req, res, next) {
  const t = resolveTenant(req.params.token);
  if (!t) return res.status(404).json({ error: 'ไม่พบลิงก์ผู้เช่า' });
  req.tenantCtx = t;
  next();
}

// Clean up uploaded files (single or array) — prevents disk leak on bad-token uploads
function cleanupFiles(req) {
  try {
    if (req.file) fs.unlinkSync(req.file.path);
    if (Array.isArray(req.files)) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
  } catch (_) {}
}

// Middleware: token-aware multer rejection
function rejectIfInvalidToken(req, res, next) {
  const t = resolveTenant(req.params.token);
  if (!t) {
    cleanupFiles(req);
    return res.status(404).json({ error: 'ไม่พบลิงก์ผู้เช่า' });
  }
  req.tenantCtx = t;
  next();
}

// ============================================================
// GET /share/info/:token  →  read-only tenant info
// ============================================================
router.get('/info/:token', (req, res) => {
  const token = req.params.token;
  if (!token) return res.status(400).json({ error: 'invalid token' });

  const row = db.prepare(`
    SELECT t.id as tenant_id, t.display_name, t.phone, t.contract_start_date,
           t.move_in_date, t.deposit_amount,
           r.id as room_id, r.room_code, r.room_number, r.floor, r.monthly_rent,
           r.building as building_name,
           d.id as dormitory_id, d.name as dormitory_name, d.address as dormitory_address,
           d.promptpay_number, d.promptpay_name,
           d.water_rate, d.electric_rate, d.rent_due_day
    FROM tenants t
    JOIN rooms r ON t.room_id = r.id
    JOIN dormitories d ON r.dormitory_id = d.id
    WHERE t.share_token = ?
  `).get(token);

  if (!row) return res.status(404).json({ error: 'ไม่พบลิงก์ผู้เช่า' });

  const contract = db.prepare(`
    SELECT contract_number, start_date, end_date, monthly_rent, deposit_amount, payment_due_day
    FROM contracts
    WHERE tenant_id = ? AND status IN ('active','expiring')
    ORDER BY id DESC LIMIT 1
  `).get(row.tenant_id);

  const bills = db.prepare(`
    SELECT id, billing_month, rent_amount, water_amount, electric_amount,
           other_amount, total_amount, status, due_date
    FROM bills
    WHERE room_id = ?
    ORDER BY billing_month DESC LIMIT 6
  `).all(row.room_id);

  res.json({
    dormitory: {
      name: row.dormitory_name,
      address: row.dormitory_address,
      promptpay_number: row.promptpay_number,
      promptpay_name: row.promptpay_name,
      water_rate: row.water_rate,
      electric_rate: row.electric_rate,
      rent_due_day: row.rent_due_day
    },
    tenant: {
      display_name: row.display_name,
      phone: row.phone,
      contract_start_date: row.contract_start_date,
      move_in_date: row.move_in_date,
      deposit_amount: row.deposit_amount
    },
    room: {
      room_code: row.room_code || row.room_number,
      floor: row.floor,
      monthly_rent: row.monthly_rent,
      building_name: row.building_name
    },
    contract,
    bills
  });
});

// ============================================================
// MAINTENANCE — submit + list
// ============================================================
router.post('/:token/maintenance', uploadMaint.array('images', 5), validateImageMagic, rejectIfInvalidToken, (req, res) => {
  const t = req.tenantCtx;
  const { title, description } = req.body;
  if (!title) { cleanupFiles(req); return res.status(400).json({ error: 'กรุณากรอกหัวข้อ' }); }
  const files = (req.files || []).map(f => `/uploads/maintenance/${f.filename}`);
  const imagePath = files[0] || null;          // legacy: store first as image_path
  const imagesJson = files.length ? JSON.stringify(files) : null;
  const r = db.prepare(`INSERT INTO maintenance_requests (room_id, title, description, image_path, images_json, status)
    VALUES (?,?,?,?,?,'pending')`).run(t.room_id, title, description || '', imagePath, imagesJson);
  res.json({ success: true, id: r.lastInsertRowid, images: files });
});

router.get('/:token/maintenance', requireTenantToken, (req, res) => {
  const list = db.prepare(`SELECT id, title, description, image_path, images_json, status, admin_note, created_at
    FROM maintenance_requests WHERE room_id=? ORDER BY id DESC LIMIT 20`).all(req.tenantCtx.room_id);
  list.forEach(m => {
    try { m.images = m.images_json ? JSON.parse(m.images_json) : (m.image_path ? [m.image_path] : []); }
    catch { m.images = m.image_path ? [m.image_path] : []; }
    delete m.images_json;
  });
  res.json(list);
});

// ============================================================
// MOVE-OUT — submit + status
// ============================================================
router.post('/:token/move-out', uploadMoveOut.array('images', 5), validateImageMagic, rejectIfInvalidToken, (req, res) => {
  const t = req.tenantCtx;
  const { requested_date, reason } = req.body;
  if (!requested_date) { cleanupFiles(req); return res.status(400).json({ error: 'กรุณาเลือกวันที่ต้องการย้ายออก' }); }
  const existing = db.prepare(`SELECT id FROM move_out_requests WHERE tenant_id=? AND status IN ('pending','approved')`).get(t.tenant_id);
  if (existing) { cleanupFiles(req); return res.status(400).json({ error: 'มีคำร้องค้างอยู่แล้ว' }); }
  const files = (req.files || []).map(f => `/uploads/move_out/${f.filename}`);
  const imagesJson = files.length ? JSON.stringify(files) : null;
  const r = db.prepare(`INSERT INTO move_out_requests (tenant_id, room_id, requested_date, reason, images_json, status)
    VALUES (?,?,?,?,?,'pending')`).run(t.tenant_id, t.room_id, requested_date, reason || '', imagesJson);
  res.json({ success: true, id: r.lastInsertRowid, images: files });
});

router.get('/:token/move-out', requireTenantToken, (req, res) => {
  const r = db.prepare(`SELECT * FROM move_out_requests WHERE tenant_id=? ORDER BY id DESC LIMIT 1`).get(req.tenantCtx.tenant_id);
  if (r) {
    try { r.images = r.images_json ? JSON.parse(r.images_json) : []; } catch { r.images = []; }
    delete r.images_json;
  }
  res.json(r || null);
});

// ============================================================
// CONTRACT RENEWAL — submit + status
// ============================================================
router.post('/:token/renew', uploadRenewal.array('images', 5), validateImageMagic, rejectIfInvalidToken, (req, res) => {
  const t = req.tenantCtx;
  const months = parseInt(req.body.months);
  const note = req.body.note;
  if (!months || months < 1 || months > 60) { cleanupFiles(req); return res.status(400).json({ error: 'จำนวนเดือนไม่ถูกต้อง' }); }
  const existing = db.prepare(`SELECT id FROM contract_renewal_requests WHERE tenant_id=? AND status='pending'`).get(t.tenant_id);
  if (existing) { cleanupFiles(req); return res.status(400).json({ error: 'มีคำร้องค้างอยู่แล้ว' }); }
  const files = (req.files || []).map(f => `/uploads/renewal/${f.filename}`);
  const imagesJson = files.length ? JSON.stringify(files) : null;
  const r = db.prepare(`INSERT INTO contract_renewal_requests (tenant_id, room_id, requested_months, note, images_json, status)
    VALUES (?,?,?,?,?,'pending')`).run(t.tenant_id, t.room_id, months, note || '', imagesJson);
  res.json({ success: true, id: r.lastInsertRowid, images: files });
});

router.get('/:token/renew', requireTenantToken, (req, res) => {
  const r = db.prepare(`SELECT * FROM contract_renewal_requests WHERE tenant_id=? ORDER BY id DESC LIMIT 1`).get(req.tenantCtx.tenant_id);
  if (r) {
    try { r.images = r.images_json ? JSON.parse(r.images_json) : []; } catch { r.images = []; }
    delete r.images_json;
  }
  res.json(r || null);
});

// ============================================================
// BILL — pay (upload slip)
// ============================================================
router.post('/:token/bills/:id/pay', uploadSlip.single('slip'), validateImageMagic, rejectIfInvalidToken, (req, res) => {
  const t = req.tenantCtx;
  const bill = db.prepare('SELECT * FROM bills WHERE id=? AND room_id=?').get(req.params.id, t.room_id);
  if (!bill) { cleanupFiles(req); return res.status(404).json({ error: 'ไม่พบบิล' }); }
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบสลิป' });

  // ป้องกัน payment ซ้ำ (CHAOS-006: double submit / network retry)
  const existing = db.prepare(
    "SELECT id FROM payments WHERE bill_id=? AND status IN ('pending','approved')"
  ).get(bill.id);
  if (existing) {
    // ลบไฟล์ที่ upload มาแล้ว เพราะไม่ได้ใช้
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    return res.status(409).json({ error: 'ส่งสลิปไปแล้ว รอแอดมินตรวจสอบค่ะ', payment_id: existing.id });
  }

  const slipPath = `/uploads/slips/${req.file.filename}`;
  db.prepare(`INSERT INTO payments (bill_id, amount, method, slip_path, status, paid_at)
    VALUES (?,?,?,?,'pending',datetime('now'))`).run(bill.id, bill.total_amount, 'promptpay', slipPath);
  db.prepare(`UPDATE bills SET status='reviewing' WHERE id=?`).run(bill.id);
  res.json({ success: true, slip_path: slipPath });
});

// ============================================================
// DOCUMENTS — contract + deposit info
// ============================================================
router.get('/:token/documents', requireTenantToken, (req, res) => {
  const contract = db.prepare(`SELECT contract_number, start_date, end_date, monthly_rent, deposit_amount, status, custom_terms
    FROM contracts WHERE tenant_id=? ORDER BY id DESC`).all(req.tenantCtx.tenant_id);
  res.json({ contracts: contract });
});

// ============================================================
// DEPOSIT — list deposit transactions
// ============================================================
router.get('/:token/deposit', requireTenantToken, (req, res) => {
  const list = db.prepare(`SELECT id, type, amount, description, created_at
    FROM deposit_transactions WHERE tenant_id=? ORDER BY created_at DESC`).all(req.tenantCtx.tenant_id);
  const total = list.reduce((s, x) => s + (x.type === 'deposit' ? x.amount : -x.amount), 0);
  res.json({ list, total });
});

module.exports = router;
