const db = require('../db/database');
const prorationService = require('./prorationService');
const lineService = require('./lineService');
const { v4: uuidv4 } = require('uuid');

// ============================================================
// CONTRACT END-DATE CALCULATOR
// ============================================================
// Thai dormitory convention: สัญญารายเดือน
//
// presets:
//   • 6 เดือน
//   • 12 เดือน (1 ปี)  ← มาตรฐานในไทย
//   • 24 เดือน (2 ปี)
//   • custom (เลือกวันเอง)
//
// คำนวณวันสิ้นสุด:
//   วันเริ่ม + N เดือน → ถอย 1 วัน
//   เช่น 10/05/2026 + 12 = 09/05/2027
function calculateContractEnd(startDate, months) {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Calculate end of last paid month (alternative: end of same month next year)
function calculateMonthEnd(startDate, months) {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + months);
  // last day of that month:
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

// ============================================================
// ONBOARD TENANT — single transaction:
//   1. Insert tenant
//   2. Create contract (status: draft → active)
//   3. Create deposit transactions
//   4. Generate prorated first bill (if applicable)
//   5. Update room status to 'occupied'
// ============================================================
async function onboardTenant(roomId, dormitoryId, data, adminId) {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(roomId, dormitoryId);
  if (!room) throw new Error('Room not found');

  const existing = db.prepare('SELECT id FROM tenants WHERE room_id=?').get(roomId);
  if (existing) throw new Error('ห้องนี้มีผู้เช่าอยู่แล้ว');

  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormitoryId);
  const dueDay = dorm.rent_due_day || 5;

  // synthetic line_user_id since tenant might not link LINE yet
  const placeholderLineId = `pending:${uuidv4().slice(0, 12)}`;
  // share token for public tenant-info link (sent via SMS/LINE/etc.)
  const shareToken = uuidv4().replace(/-/g, '');

  let result;
  db.exec('BEGIN');
  try {
    // 1. Tenant
    const tenantIns = db.prepare(`
      INSERT INTO tenants (
        room_id, line_user_id, display_name, phone, id_card, address,
        occupation, workplace, emergency_name, emergency_phone, emergency_relation,
        guarantor_name, guarantor_phone, guarantor_id_card,
        contract_start_date, move_in_date, deposit_amount, share_token
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      roomId, placeholderLineId,
      data.tenant_name, data.phone || '', data.id_card || '', data.address || '',
      data.occupation || '', data.workplace || '',
      data.emergency_name || '', data.emergency_phone || '', data.emergency_relation || '',
      data.guarantor_name || '', data.guarantor_phone || '', data.guarantor_id_card || '',
      data.contract_start, data.move_in_date || data.contract_start,
      parseFloat(data.total_deposit) || 0, shareToken
    );
    const tenantId = tenantIns.lastInsertRowid;

    // 2. Contract
    const months = parseInt(data.contract_months) || 12;
    const endDate = data.contract_end || calculateContractEnd(data.contract_start, months);
    const contractNum = `CT${Date.now()}`;
    const contractIns = db.prepare(`
      INSERT INTO contracts (
        dormitory_id, room_id, tenant_id, contract_number,
        tenant_name, tenant_id_card, tenant_phone, tenant_address,
        start_date, end_date, monthly_rent, deposit_amount,
        payment_due_day, custom_terms, status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      dormitoryId, roomId, tenantId, contractNum,
      data.tenant_name, data.id_card || '', data.phone || '', data.address || '',
      data.contract_start, endDate,
      parseFloat(data.monthly_rent) || room.monthly_rent,
      parseFloat(data.total_deposit) || 0,
      dueDay, data.custom_terms || '',
      'active'
    );
    const contractId = contractIns.lastInsertRowid;

    // 3. Deposit transactions
    if (Array.isArray(data.deposits)) {
      for (const d of data.deposits) {
        if (!d.amount || d.amount <= 0) continue;
        db.prepare(`INSERT INTO deposit_transactions (tenant_id, type, amount, description, created_by)
          VALUES (?,'deposit',?,?,?)`).run(tenantId, parseFloat(d.amount), d.label || 'มัดจำ', adminId || null);
      }
    }

    // 4. Prorated first bill (if move-in mid-month and proration enabled)
    let proration = null;
    if (dorm.rent_proration_enabled) {
      const calc = prorationService.calculateFirstMonthRent({
        moveInDate: data.move_in_date || data.contract_start,
        monthlyRent: parseFloat(data.monthly_rent) || room.monthly_rent,
        dueDay
      });
      if (calc.is_partial) {
        const billingMonth = (data.move_in_date || data.contract_start).slice(0, 7);
        const existsBill = db.prepare('SELECT id FROM bills WHERE room_id=? AND billing_month=?').get(roomId, billingMonth);
        if (!existsBill) {
          db.prepare(`INSERT INTO bills (room_id, billing_month, rent_amount, total_amount, status, due_date, other_label, other_amount)
            VALUES (?,?,?,?,?,?,?,?)`).run(
            roomId, billingMonth, calc.prorated_amount, calc.prorated_amount,
            'pending', calc.first_due_date,
            `เฉลี่ยตามวันเข้าอยู่ (${calc.days_remaining}/${calc.days_total} วัน)`, 0
          );
        }
        proration = calc;
      }
    }

    // 5. Update room status
    db.prepare(`UPDATE rooms SET operational_status='occupied', status_note=?, status_updated_at=datetime('now') WHERE id=?`)
      .run(`ผู้เช่า: ${data.tenant_name}`, roomId);
    db.prepare(`INSERT INTO room_status_log (room_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?)`)
      .run(roomId, room.operational_status, 'occupied', `เพิ่มผู้เช่า: ${data.tenant_name}`, adminId || null);

    // 6. Calendar event for contract end
    db.prepare(`INSERT INTO calendar_events (dormitory_id, title, description, event_type, event_date, related_room_id, related_tenant_id)
      VALUES (?,?,?,?,?,?,?)`).run(
      dormitoryId, `📜 สัญญาห้อง ${room.room_code || room.room_number} หมดอายุ`,
      `${data.tenant_name} • สัญญา ${contractNum}`,
      'contract_expiry', endDate, roomId, tenantId
    );

    db.exec('COMMIT');
    result = { tenant_id: tenantId, contract_id: contractId, contract_number: contractNum, end_date: endDate, proration, share_token: shareToken };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return result;
}

module.exports = { calculateContractEnd, calculateMonthEnd, onboardTenant };
