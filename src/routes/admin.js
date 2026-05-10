const router = require('express').Router();
const { requireAdmin, loadAdmin } = require('../middleware/auth');
const db = require('../db/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const billingService = require('../services/billingService');
const lineService = require('../services/lineService');
const collectionService = require('../services/collectionService');
const contractService = require('../services/contractService');
const financialService = require('../services/financialService');
const tenantService = require('../services/tenantService');

router.use(loadAdmin);
router.use(requireAdmin);

function buildRoomCode(building, floor, roomNumber) {
  return `${(building || 'A').toUpperCase()}${floor || 1}${roomNumber}`;
}

// ============================================================
// DORMITORY
// ============================================================
router.get('/dormitory', (req, res) => {
  res.json(db.prepare('SELECT * FROM dormitories WHERE id = ?').get(req.dormitoryId));
});

router.put('/dormitory', (req, res) => {
  const { name, address, promptpay_number, promptpay_name, water_rate, electric_rate,
          line_channel_id, line_channel_secret, line_channel_access_token, liff_id } = req.body;
  db.prepare(`
    UPDATE dormitories SET
      name=?, address=?, promptpay_number=?, promptpay_name=?,
      water_rate=?, electric_rate=?,
      line_channel_id=?, line_channel_secret=?, line_channel_access_token=?, liff_id=?
    WHERE id=?
  `).run(name, address, promptpay_number, promptpay_name, water_rate, electric_rate,
         line_channel_id, line_channel_secret, line_channel_access_token, liff_id, req.dormitoryId);
  res.json({ success: true });
});

// ============================================================
// DASHBOARD
// ============================================================
router.get('/dashboard', (req, res) => {
  const dormId = req.dormitoryId;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  // รายรับเดือนนี้: บิลที่จ่ายแล้ว + รายรับใน financial_transactions เดือนนี้ (ที่ไม่ได้ผูกกับบิล เพื่อเลี่ยงการนับซ้ำ)
  const billRevenue = db.prepare(`
    SELECT COALESCE(SUM(b.total_amount),0) as total
    FROM bills b JOIN rooms r ON b.room_id = r.id
    WHERE r.dormitory_id=? AND b.billing_month=? AND b.status='paid'
  `).get(dormId, currentMonth);

  const finRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total
    FROM financial_transactions
    WHERE dormitory_id=? AND type='income'
      AND substr(transaction_date,1,7)=?
      AND (reference_type IS NULL OR reference_type != 'bill')
  `).get(dormId, currentMonth);

  const revenue = { total: (billRevenue.total || 0) + (finRevenue.total || 0) };

  // ค้างชำระจริง (เลย due_date แล้ว)
  const overdue = db.prepare(`
    SELECT COALESCE(SUM(b.total_amount),0) as total, COUNT(*) as count
    FROM bills b JOIN rooms r ON b.room_id = r.id
    WHERE r.dormitory_id=? AND b.status IN ('pending','overdue')
      AND b.due_date IS NOT NULL AND b.due_date < ?
  `).get(dormId, today);

  // รอชำระ (รวม overdue และยังไม่ครบกำหนด)
  const pending = db.prepare(`
    SELECT COALESCE(SUM(b.total_amount),0) as total, COUNT(*) as count
    FROM bills b JOIN rooms r ON b.room_id = r.id
    WHERE r.dormitory_id=? AND b.status IN ('pending','overdue')
  `).get(dormId);

  const rooms = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) as occupied
    FROM rooms r LEFT JOIN tenants t ON r.id = t.room_id
    WHERE r.dormitory_id=?
  `).get(dormId);

  const maintenance = db.prepare(`
    SELECT COUNT(*) as count FROM maintenance_requests mr
    JOIN rooms r ON mr.room_id = r.id
    WHERE r.dormitory_id=? AND mr.status NOT IN ('completed','cancelled')
  `).get(dormId);

  const pendingSlips = db.prepare(`
    SELECT p.*, b.billing_month, b.total_amount as bill_total, r.room_number, r.room_code, t.display_name
    FROM payments p
    JOIN bills b ON p.bill_id = b.id
    JOIN rooms r ON b.room_id = r.id
    LEFT JOIN tenants t ON r.id = t.room_id
    WHERE r.dormitory_id=? AND p.status='pending'
    ORDER BY p.created_at DESC
  `).all(dormId);

  res.json({
    revenue: revenue.total,
    revenue_breakdown: { from_bills: billRevenue.total, from_finance: finRevenue.total },
    overdue_amount: overdue.total,
    overdue_count: overdue.count,
    pending_amount: pending.total,
    pending_count: pending.count,
    total_rooms: rooms.total,
    occupied_rooms: rooms.occupied,
    vacant_rooms: rooms.total - rooms.occupied,
    pending_maintenance: maintenance.count,
    pending_slips: pendingSlips
  });
});

// ============================================================
// ROOMS — multi-building
// ============================================================
router.get('/rooms', (req, res) => {
  const rooms = db.prepare(`
    SELECT r.*, t.display_name as tenant_name, t.line_user_id, t.phone, t.contract_start_date,
      t.deposit_amount, t.id as tenant_id,
      (SELECT billing_month FROM bills WHERE room_id=r.id ORDER BY billing_month DESC LIMIT 1) as last_bill_month,
      (SELECT status FROM bills WHERE room_id=r.id ORDER BY billing_month DESC LIMIT 1) as last_bill_status,
      (SELECT total_amount FROM bills WHERE room_id=r.id ORDER BY billing_month DESC LIMIT 1) as last_bill_amount
    FROM rooms r LEFT JOIN tenants t ON r.id = t.room_id
    WHERE r.dormitory_id=?
    ORDER BY r.building, r.floor, r.room_number
  `).all(req.dormitoryId);
  res.json(rooms);
});

router.get('/buildings', (req, res) => {
  const list = db.prepare(`
    SELECT building, COUNT(*) as room_count,
      SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) as occupied
    FROM rooms r LEFT JOIN tenants t ON r.id=t.room_id
    WHERE r.dormitory_id=? GROUP BY building ORDER BY building
  `).all(req.dormitoryId);
  res.json(list);
});

router.post('/rooms', (req, res) => {
  const { building, floor, room_number, monthly_rent, notes,
          initial_water_meter, initial_electric_meter } = req.body;
  if (!room_number || !monthly_rent) return res.status(400).json({ error: 'กรุณากรอกเลขห้องและค่าเช่า' });

  // ตรวจ quota
  const dorm = db.prepare('SELECT room_quota FROM dormitories WHERE id=?').get(req.dormitoryId);
  const quota = dorm?.room_quota || 30;
  const used = db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id=?').get(req.dormitoryId).c;
  if (used >= quota) {
    return res.status(403).json({ error: `เกินโควต้า ${quota} ห้อง — กรุณาอัปเกรด License ในหน้าตั้งค่า` });
  }

  const code = buildRoomCode(building, floor, room_number);
  try {
    const result = db.prepare(`
      INSERT INTO rooms (dormitory_id, building, floor, room_number, room_code, monthly_rent, notes,
        initial_water_meter, initial_electric_meter)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(req.dormitoryId, (building || 'A').toUpperCase(), parseInt(floor || 1), room_number, code,
        monthly_rent, notes || '', initial_water_meter || 0, initial_electric_meter || 0);
    res.json({ success: true, id: result.lastInsertRowid, room_code: code });
  } catch (e) {
    res.status(409).json({ error: 'รหัสห้องซ้ำ: ' + code });
  }
});

router.put('/rooms/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(req.params.id, req.dormitoryId);
  if (!room) return res.status(404).json({ error: 'Not found' });
  const { building, floor, room_number, monthly_rent, notes, initial_water_meter, initial_electric_meter } = req.body;
  const code = buildRoomCode(building || room.building, floor || room.floor, room_number || room.room_number);
  db.prepare(`
    UPDATE rooms SET building=?, floor=?, room_number=?, room_code=?, monthly_rent=?, notes=?,
      initial_water_meter=?, initial_electric_meter=?
    WHERE id=?
  `).run((building || room.building).toUpperCase(), parseInt(floor || room.floor), room_number || room.room_number,
      code, monthly_rent, notes || '', initial_water_meter || 0, initial_electric_meter || 0, req.params.id);
  res.json({ success: true, room_code: code });
});

router.delete('/rooms/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(req.params.id, req.dormitoryId);
  if (!room) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.post('/rooms/:id/checkout', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(req.params.id, req.dormitoryId);
  if (!room) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM tenants WHERE room_id=?').run(req.params.id);
  res.json({ success: true });
});

router.post('/rooms/:id/invite', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(req.params.id, req.dormitoryId);
  if (!room) return res.status(404).json({ error: 'Not found' });

  db.prepare("UPDATE room_invites SET used_at=datetime('now') WHERE room_id=? AND used_at IS NULL").run(req.params.id);
  const token = uuidv4().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO room_invites (room_id, token, expires_at) VALUES (?,?,?)').run(req.params.id, token, expiresAt);
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({ success: true, token, url: `${baseUrl}/join/${token}`, expires_at: expiresAt });
});

// ============================================================
// BILLING
// ============================================================
router.get('/bills', (req, res) => {
  const { month } = req.query;
  const currentMonth = month || new Date().toISOString().slice(0, 7);
  const bills = db.prepare(`
    SELECT b.*, r.room_number, r.room_code, t.display_name as tenant_name, t.line_user_id
    FROM bills b
    JOIN rooms r ON b.room_id = r.id
    LEFT JOIN tenants t ON r.id = t.room_id
    WHERE r.dormitory_id=? AND b.billing_month=?
    ORDER BY r.building, r.floor, r.room_number
  `).all(req.dormitoryId, currentMonth);
  res.json(bills);
});

// คืนเลขมิเตอร์ก่อนหน้าของแต่ละห้อง — ใช้แสดงในฟอร์มออกบิล
router.get('/bills/prev-readings', (req, res) => {
  const rooms = db.prepare(`
    SELECT id, room_code, room_number, initial_water_meter, initial_electric_meter
    FROM rooms WHERE dormitory_id=?
  `).all(req.dormitoryId);
  const result = {};
  for (const r of rooms) {
    const last = db.prepare(`
      SELECT water_meter_curr, electric_meter_curr, billing_month
      FROM bills WHERE room_id=? ORDER BY billing_month DESC LIMIT 1
    `).get(r.id);
    result[r.id] = {
      prev_water: last ? last.water_meter_curr : (r.initial_water_meter || 0),
      prev_electric: last ? last.electric_meter_curr : (r.initial_electric_meter || 0),
      prev_month: last?.billing_month || null
    };
  }
  res.json(result);
});

router.post('/bills/generate', async (req, res) => {
  const { billing_month, readings, due_date } = req.body;
  if (!billing_month || !readings) return res.status(400).json({ error: 'Missing data' });

  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(req.dormitoryId);
  const liffBase = process.env.LIFF_BASE_URL || `https://liff.line.me/${dorm?.liff_id}`;
  const results = [];

  for (const [roomId, reading] of Object.entries(readings)) {
    try {
      const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(roomId, req.dormitoryId);
      if (!room) continue;
      const bill = billingService.createOrUpdateBill({
        roomId: parseInt(roomId), dormitoryId: req.dormitoryId, billingMonth: billing_month,
        waterCurr: parseInt(reading.water_curr), electricCurr: parseInt(reading.electric_curr),
        otherAmount: parseFloat(reading.other_amount || 0), otherLabel: reading.other_label || '',
        dueDate: due_date || null
      });
      const tenant = db.prepare('SELECT line_user_id FROM tenants WHERE room_id=?').get(roomId);
      if (tenant?.line_user_id) {
        const msg = lineService.billFlexMessage(bill, room, dorm.name, liffBase);
        await lineService.pushMessage(req.dormitoryId, tenant.line_user_id, msg);
      }
      results.push({ room_code: room.room_code, bill_id: bill.id, total: bill.total_amount });
    } catch (err) {
      results.push({ room_id: roomId, error: err.message });
    }
  }
  res.json({ success: true, results });
});

// รายละเอียดบิลพร้อมประวัติ payments
router.get('/bills/:id/detail', (req, res) => {
  const bill = db.prepare(`
    SELECT b.*, r.room_number, r.room_code, r.dormitory_id, t.display_name, t.line_user_id
    FROM bills b
    JOIN rooms r ON b.room_id = r.id
    LEFT JOIN tenants t ON r.id = t.room_id
    WHERE b.id=?
  `).get(req.params.id);
  if (!bill || bill.dormitory_id !== req.dormitoryId) return res.status(404).json({ error: 'Not found' });
  const payments = db.prepare('SELECT * FROM payments WHERE bill_id=? ORDER BY created_at DESC').all(bill.id);
  res.json({ bill, payments });
});

// ส่งบิลไปยัง LINE อีกครั้ง
router.post('/bills/:id/resend', async (req, res) => {
  const bill = db.prepare(`
    SELECT b.*, r.dormitory_id, r.room_number, r.room_code FROM bills b
    JOIN rooms r ON b.room_id = r.id WHERE b.id=?
  `).get(req.params.id);
  if (!bill || bill.dormitory_id !== req.dormitoryId) return res.status(404).json({ error: 'Not found' });
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(req.dormitoryId);
  const tenant = db.prepare('SELECT line_user_id FROM tenants WHERE room_id=?').get(bill.room_id);
  if (!tenant?.line_user_id || tenant.line_user_id.startsWith('pending:')) {
    return res.json({ sent: false, reason: 'tenant_not_linked' });
  }
  const liffBase = process.env.LIFF_BASE_URL || `https://liff.line.me/${dorm?.liff_id}`;
  try {
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(bill.room_id);
    const msg = lineService.billFlexMessage(bill, room, dorm.name, liffBase);
    await lineService.pushMessage(req.dormitoryId, tenant.line_user_id, msg);
    res.json({ sent: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// PAYMENTS
// ============================================================
router.get('/payments', (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT p.*, b.billing_month, b.total_amount as bill_total, r.room_number, r.room_code,
      t.display_name as tenant_name, t.line_user_id
    FROM payments p
    JOIN bills b ON p.bill_id = b.id
    JOIN rooms r ON b.room_id = r.id
    LEFT JOIN tenants t ON r.id = t.room_id
    WHERE r.dormitory_id=?
  `;
  const params = [req.dormitoryId];
  if (status) { query += ' AND p.status=?'; params.push(status); }
  query += ' ORDER BY p.created_at DESC LIMIT 100';
  res.json(db.prepare(query).all(...params));
});

router.post('/payments/:id/approve', async (req, res) => {
  const payment = db.prepare(`
    SELECT p.*, b.room_id, b.billing_month, b.total_amount, r.room_number, r.room_code, r.dormitory_id,
      t.line_user_id, t.display_name
    FROM payments p JOIN bills b ON p.bill_id=b.id JOIN rooms r ON b.room_id=r.id
    LEFT JOIN tenants t ON r.id=t.room_id
    WHERE p.id=? AND r.dormitory_id=?
  `).get(req.params.id, req.dormitoryId);

  if (!payment) return res.status(404).json({ error: 'Not found' });

  db.prepare("UPDATE payments SET status='approved', approved_at=datetime('now'), approved_by=? WHERE id=?")
    .run(req.admin.id, req.params.id);
  db.prepare("UPDATE bills SET status='paid' WHERE id=?").run(payment.bill_id);

  // Auto-record income transaction
  const billRec = db.prepare('SELECT * FROM bills WHERE id=?').get(payment.bill_id);
  financialService.recordPaymentIncome(payment, billRec);

  if (payment.line_user_id) {
    const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(req.dormitoryId);
    const bill = db.prepare('SELECT * FROM bills WHERE id=?').get(payment.bill_id);
    const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(payment.room_id);
    await lineService.pushMessage(req.dormitoryId, payment.line_user_id,
      lineService.paymentReceiptMessage(bill, room, dorm.name));
  }
  res.json({ success: true });
});

router.post('/payments/:id/reject', async (req, res) => {
  const { reason } = req.body;
  const payment = db.prepare(`
    SELECT p.*, b.billing_month, r.room_number, r.room_code, r.dormitory_id, t.line_user_id
    FROM payments p JOIN bills b ON p.bill_id=b.id JOIN rooms r ON b.room_id=r.id
    LEFT JOIN tenants t ON r.id=t.room_id
    WHERE p.id=? AND r.dormitory_id=?
  `).get(req.params.id, req.dormitoryId);

  if (!payment) return res.status(404).json({ error: 'Not found' });

  db.prepare("UPDATE payments SET status='rejected', reject_reason=? WHERE id=?")
    .run(reason || '', req.params.id);
  db.prepare("UPDATE bills SET status='pending' WHERE id=(SELECT bill_id FROM payments WHERE id=?)")
    .run(req.params.id);

  if (payment.line_user_id) {
    await lineService.pushMessage(req.dormitoryId, payment.line_user_id, {
      type: 'text',
      text: `❌ สลิปถูกปฏิเสธ\nห้อง ${payment.room_code || payment.room_number} บิลเดือน ${payment.billing_month}\n\n${reason ? `เหตุผล: ${reason}\n\n` : ''}กรุณาส่งสลิปใหม่หรือติดต่อแอดมิน`
    });
  }
  res.json({ success: true });
});

// ============================================================
// MAINTENANCE
// ============================================================
router.get('/maintenance', (req, res) => {
  const requests = db.prepare(`
    SELECT mr.*, r.room_number, r.room_code, t.display_name as tenant_name
    FROM maintenance_requests mr
    JOIN rooms r ON mr.room_id = r.id
    LEFT JOIN tenants t ON r.id = t.room_id
    WHERE r.dormitory_id=?
    ORDER BY mr.created_at DESC
  `).all(req.dormitoryId);
  res.json(requests);
});

// สร้างรายการแจ้งซ่อมใหม่ (จาก Operator/Admin)
router.post('/maintenance', (req, res) => {
  const { room_id, title, description } = req.body;
  if (!room_id || !title) return res.status(400).json({ error: 'ระบุห้องและหัวข้อ' });
  const room = db.prepare('SELECT id FROM rooms WHERE id=? AND dormitory_id=?').get(room_id, req.dormitoryId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const r = db.prepare(`INSERT INTO maintenance_requests (room_id, title, description, status) VALUES (?,?,?,'pending')`)
    .run(room_id, title, description || '');
  res.json({ success: true, id: r.lastInsertRowid });
});

router.patch('/maintenance/:id', (req, res) => {
  const { status, admin_note } = req.body;
  const req2 = db.prepare(`
    SELECT mr.*, r.dormitory_id FROM maintenance_requests mr JOIN rooms r ON mr.room_id=r.id
    WHERE mr.id=? AND r.dormitory_id=?
  `).get(req.params.id, req.dormitoryId);
  if (!req2) return res.status(404).json({ error: 'Not found' });

  db.prepare("UPDATE maintenance_requests SET status=?, admin_note=?, updated_at=datetime('now') WHERE id=?")
    .run(status, admin_note || '', req.params.id);
  res.json({ success: true });
});

// ============================================================
// COLLECTION POLICY
// ============================================================
router.get('/collection/policy', (req, res) => {
  res.json(collectionService.getPolicy(req.dormitoryId));
});

router.put('/collection/policy', (req, res) => {
  res.json(collectionService.updatePolicy(req.dormitoryId, req.body));
});

router.get('/collection/overdue', (req, res) => {
  res.json(collectionService.getOverdueBills(req.dormitoryId));
});

router.post('/collection/run', async (req, res) => {
  try {
    const result = await collectionService.runCollectionForDormitory(req.dormitoryId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/collection/logs', (req, res) => {
  const logs = db.prepare(`
    SELECT cl.*, b.billing_month, r.room_code, r.room_number
    FROM collection_logs cl
    JOIN bills b ON cl.bill_id=b.id
    JOIN rooms r ON b.room_id=r.id
    WHERE r.dormitory_id=?
    ORDER BY cl.sent_at DESC LIMIT 100
  `).all(req.dormitoryId);
  res.json(logs);
});

// ============================================================
// CONTRACTS
// ============================================================
router.get('/contracts', (req, res) => {
  res.json(contractService.listContracts(req.dormitoryId));
});

router.get('/contracts/template', (req, res) => {
  res.json(contractService.getDefaultTemplate(req.dormitoryId));
});

router.put('/contracts/template', (req, res) => {
  const { body } = req.body;
  contractService.getDefaultTemplate(req.dormitoryId);
  db.prepare("UPDATE contract_templates SET body=? WHERE dormitory_id=? AND is_default=1")
    .run(body, req.dormitoryId);
  res.json({ success: true });
});

router.get('/contracts/:id', (req, res) => {
  const c = contractService.getContract(req.params.id, req.dormitoryId);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

router.post('/contracts', (req, res) => {
  try {
    const c = contractService.createContract({ ...req.body, dormitory_id: req.dormitoryId });
    res.json(c);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/contracts/:id', (req, res) => {
  const c = contractService.updateContract(req.params.id, req.dormitoryId, req.body);
  res.json(c);
});

router.delete('/contracts/:id', (req, res) => {
  contractService.deleteContract(req.params.id, req.dormitoryId);
  res.json({ success: true });
});

router.get('/contracts/:id/render', (req, res) => {
  const c = contractService.getContract(req.params.id, req.dormitoryId);
  if (!c) return res.status(404).send('Not found');
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(req.dormitoryId);
  const policy = collectionService.getPolicy(req.dormitoryId);
  res.send(contractService.renderHTML(c, dorm, policy));
});

// ============================================================
// ADMIN ACCOUNT
// ============================================================
router.put('/account/password', (req, res) => {
  const { current_password, new_password } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.session.adminId);
  if (!bcrypt.compareSync(current_password, admin.password_hash)) {
    return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }
  db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?')
    .run(bcrypt.hashSync(new_password, 10), req.session.adminId);
  res.json({ success: true });
});

router.get('/account/line-status', (req, res) => {
  const link = db.prepare('SELECT line_user_id, linked_at FROM admin_line_links WHERE admin_user_id=? AND dormitory_id=?')
    .get(req.session.adminId, req.dormitoryId);
  res.json({ linked: !!link, ...link });
});

router.post('/account/line-link-token', (req, res) => {
  const token = uuidv4().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO admin_link_tokens (admin_user_id, token, expires_at) VALUES (?,?,?)')
    .run(req.session.adminId, token, expiresAt);
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({ token, url: `${baseUrl}/admin-link/${token}`, expires_at: expiresAt });
});

router.delete('/account/line-link', (req, res) => {
  db.prepare('DELETE FROM admin_line_links WHERE admin_user_id=? AND dormitory_id=?')
    .run(req.session.adminId, req.dormitoryId);
  db.prepare('UPDATE admin_users SET line_user_id=NULL WHERE id=?').run(req.session.adminId);
  res.json({ success: true });
});

module.exports = router;
