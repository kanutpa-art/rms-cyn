const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const prorationService = require('./prorationService');

// ============================================================
// Calculate end date based on duration
// ============================================================
// มาตรฐานไทย: สัญญา 1 ปี เริ่ม 10/05/2026 → สิ้นสุด 09/05/2027 (1 วันก่อนครบรอบ)
// แต่บางหอใช้: 10/05/2026 → 10/05/2027 (วันเดียวกัน) — ขึ้นกับเจ้าของ
// เราใช้ "วันก่อนครบรอบ" เป็น default
// ============================================================
function calculateEndDate(startDate, durationMonths) {
  const start = new Date(startDate);
  const end = new Date(start.getFullYear(), start.getMonth() + parseInt(durationMonths), start.getDate() - 1);
  return end.toISOString().slice(0, 10);
}

// ============================================================
// Create tenant + contract + deposits + first prorated bill atomically
// ============================================================
function quickAddTenant(dormitoryId, roomId, data, adminId) {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(roomId, dormitoryId);
  if (!room) throw new Error('ไม่พบห้อง');

  // ตรวจว่าห้องว่างจริง
  const existing = db.prepare('SELECT id FROM tenants WHERE room_id=?').get(roomId);
  if (existing) throw new Error('ห้องนี้มีผู้เช่าอยู่แล้ว');

  // สร้าง pseudo line_user_id (จะ replace เมื่อลูกบ้านสแกน LINE จริง)
  const pseudoLineId = `pending_${roomId}_${Date.now()}`;

  const startDate = data.start_date || new Date().toISOString().slice(0, 10);
  const durationMonths = parseInt(data.duration_months) || 12;
  const endDate = calculateEndDate(startDate, durationMonths);

  const dorm = db.prepare('SELECT rent_due_day, rent_proration_enabled FROM dormitories WHERE id=?').get(dormitoryId);
  const dueDay = dorm?.rent_due_day || 5;

  let tenantId, contractId, billResult, depositTxs = [];

  db.exec('BEGIN');
  try {
    // 1. Create tenant
    const tenantResult = db.prepare(`
      INSERT INTO tenants (room_id, line_user_id, display_name, phone, id_card, contract_start_date, deposit_amount)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      roomId, pseudoLineId,
      data.tenant_name || 'ลูกบ้านใหม่',
      data.tenant_phone || '',
      data.tenant_id_card || '',
      startDate,
      0 // จะอัปเดตจาก deposit transactions
    );
    tenantId = tenantResult.lastInsertRowid;

    // 2. Create contract
    const contractNumber = `CT${Date.now()}`;
    const contractResult = db.prepare(`
      INSERT INTO contracts (
        dormitory_id, room_id, tenant_id, contract_number,
        tenant_name, tenant_id_card, tenant_phone, tenant_address,
        start_date, end_date, monthly_rent, deposit_amount,
        payment_due_day, custom_terms, status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      dormitoryId, roomId, tenantId, contractNumber,
      data.tenant_name || '', data.tenant_id_card || '',
      data.tenant_phone || '', data.tenant_address || '',
      startDate, endDate,
      room.monthly_rent, 0, // deposit ไปคำนวณรวมข้างล่าง
      dueDay, data.notes || '', 'active'
    );
    contractId = contractResult.lastInsertRowid;

    // 3. Add deposit transactions for selected charges
    let totalDeposit = 0;
    for (const ch of (data.deposits || [])) {
      if (!ch.amount || ch.amount <= 0) continue;
      db.prepare(`INSERT INTO deposit_transactions
        (tenant_id, type, amount, description, reference_type, reference_id, created_by)
        VALUES (?,'deposit',?,?,?,?,?)`).run(
        tenantId, parseFloat(ch.amount),
        ch.label || ch.code, 'charge', ch.id || null, adminId
      );
      totalDeposit += parseFloat(ch.amount);
      depositTxs.push({ label: ch.label, amount: ch.amount });
    }

    // Update tenant.deposit_amount summary
    db.prepare('UPDATE tenants SET deposit_amount=? WHERE id=?').run(totalDeposit, tenantId);

    // 4. Set room status to occupied
    db.prepare(`UPDATE rooms SET operational_status='occupied', status_updated_at=datetime('now') WHERE id=?`)
      .run(roomId);
    db.prepare(`INSERT INTO room_status_log (room_id, from_status, to_status, note, changed_by)
      VALUES (?, 'vacant', 'occupied', ?, ?)`).run(roomId, `เพิ่มผู้เช่า: ${data.tenant_name}`, adminId);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // 5. Generate first prorated bill (after commit, since it's an independent transaction)
  if (dorm.rent_proration_enabled) {
    try { billResult = prorationService.generateProratedFirstBill(tenantId, startDate); }
    catch (e) { console.warn('proration bill skipped:', e.message); }
  }

  return {
    tenant_id: tenantId,
    contract_id: contractId,
    contract_number: `CT${Date.now()}`,
    start_date: startDate,
    end_date: endDate,
    duration_months: durationMonths,
    total_deposit: depositTxs.reduce((s, d) => s + parseFloat(d.amount), 0),
    deposit_breakdown: depositTxs,
    first_bill: billResult || null
  };
}

// ============================================================
// Get pre-filled defaults for the wizard (for a specific room)
// ============================================================
function getQuickAddDefaults(dormitoryId, roomId) {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(roomId, dormitoryId);
  if (!room) return null;

  const charges = db.prepare(`SELECT * FROM dormitory_charges
    WHERE dormitory_id=? AND type='deposit' AND enabled=1
    ORDER BY sort_order`).all(dormitoryId);

  // Auto-set room_deposit to 1 month rent if 0
  const charges_with_defaults = charges.map(c => {
    if (c.code === 'room_deposit' && (!c.amount || c.amount === 0)) {
      return { ...c, amount: room.monthly_rent, suggested_from: 'monthly_rent' };
    }
    return c;
  });

  const dorm = db.prepare('SELECT rent_due_day, rent_proration_enabled FROM dormitories WHERE id=?').get(dormitoryId);

  return {
    room: {
      id: room.id, room_code: room.room_code,
      monthly_rent: room.monthly_rent,
      building: room.building, floor: room.floor
    },
    deposit_charges: charges_with_defaults,
    duration_options: [
      { value: 6, label: '6 เดือน', popular: false },
      { value: 12, label: '1 ปี (12 เดือน)', popular: true },
      { value: 24, label: '2 ปี (24 เดือน)', popular: false },
      { value: 36, label: '3 ปี (36 เดือน)', popular: false }
    ],
    rent_due_day: dorm.rent_due_day || 5,
    proration_enabled: !!dorm.rent_proration_enabled,
    today: new Date().toISOString().slice(0, 10)
  };
}

module.exports = {
  calculateEndDate,
  quickAddTenant,
  getQuickAddDefaults
};
