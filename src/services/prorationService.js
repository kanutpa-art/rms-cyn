const db = require('../db/database');

// ============================================================
// PRORATION CALCULATOR
// ============================================================
// คิดค่าเช่าเดือนแรกแบบเฉลี่ยตามวันที่เข้าอยู่จริง
//
// 2 รูปแบบที่นิยม:
//
//  A) Daily proration (มาตรฐาน):
//     ค่าเช่าเดือนแรก = (rent / total_days_in_month) * remaining_days
//     เช่น เข้า 15 พ.ค. → 17 วัน → (3500/31)*17 = 1919.35
//
//  B) Pay-to-due-day (ชำระวันแรกที่ครบกำหนด):
//     ถ้าเข้าอยู่ก่อนวันชำระ — จ่ายเฉพาะ partial month แรก
//     ถ้าเข้าอยู่หลังวันชำระ — จ่าย partial + จ่ายเดือนต่อไป (รวบ)
//
// เราใช้รูปแบบ A เป็นหลัก
// ============================================================

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month 1-12
}

function calculateFirstMonthRent({ moveInDate, monthlyRent, dueDay = 5 }) {
  if (!moveInDate || !monthlyRent) {
    return { error: 'missing moveInDate or monthlyRent' };
  }

  const move = new Date(moveInDate);
  const year = move.getFullYear();
  const month = move.getMonth() + 1; // 1-12
  const day = move.getDate();
  const totalDays = daysInMonth(year, month);
  const remainingDays = totalDays - day + 1; // includes move-in day

  const dailyRate = monthlyRent / totalDays;
  const proratedAmount = Math.round((dailyRate * remainingDays) * 100) / 100;

  // Calculate due date for the first bill
  // Rule: due on dueDay of next month
  let dueYear = year, dueMonth = month + 1;
  if (dueMonth > 12) { dueMonth = 1; dueYear++; }
  const dueDate = `${dueYear}-${String(dueMonth).padStart(2,'0')}-${String(Math.min(dueDay, daysInMonth(dueYear, dueMonth))).padStart(2,'0')}`;

  // Coverage period
  const periodStart = moveInDate;
  const periodEnd = `${year}-${String(month).padStart(2,'0')}-${String(totalDays).padStart(2,'0')}`;

  return {
    move_in_date: moveInDate,
    days_total: totalDays,
    days_remaining: remainingDays,
    daily_rate: Math.round(dailyRate * 100) / 100,
    monthly_rent: monthlyRent,
    prorated_amount: proratedAmount,
    full_month_amount: monthlyRent,
    saving: Math.round((monthlyRent - proratedAmount) * 100) / 100,
    period_start: periodStart,
    period_end: periodEnd,
    first_due_date: dueDate,
    is_partial: remainingDays < totalDays,
    breakdown: `(${monthlyRent} ÷ ${totalDays} วัน) × ${remainingDays} วัน = ${proratedAmount} บาท`
  };
}

// Generate the first prorated bill for a tenant
function generateProratedFirstBill(tenantId, moveInDate) {
  const tenant = db.prepare(`
    SELECT t.*, r.id as room_id, r.monthly_rent, r.dormitory_id
    FROM tenants t JOIN rooms r ON t.room_id=r.id WHERE t.id=?
  `).get(tenantId);
  if (!tenant) throw new Error('Tenant not found');

  const dorm = db.prepare('SELECT rent_due_day, rent_proration_enabled FROM dormitories WHERE id=?').get(tenant.dormitory_id);
  if (!dorm.rent_proration_enabled) {
    // Skip proration — just charge full month
    return { skipped: true, reason: 'proration_disabled' };
  }

  const calc = calculateFirstMonthRent({
    moveInDate,
    monthlyRent: tenant.monthly_rent,
    dueDay: dorm.rent_due_day || 5
  });

  if (!calc.is_partial) return { skipped: true, reason: 'first_of_month' };

  // Create bill record
  const billingMonth = moveInDate.slice(0, 7); // YYYY-MM
  const exists = db.prepare('SELECT id FROM bills WHERE room_id=? AND billing_month=?').get(tenant.room_id, billingMonth);
  if (exists) return { skipped: true, reason: 'bill_exists', bill_id: exists.id };

  const result = db.prepare(`
    INSERT INTO bills (room_id, billing_month, rent_amount, total_amount, status, due_date, other_label, other_amount)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    tenant.room_id, billingMonth,
    calc.prorated_amount, calc.prorated_amount,
    'pending', calc.first_due_date,
    `เฉลี่ยตามวันที่เข้าอยู่ (${calc.days_remaining}/${calc.days_total} วัน)`,
    0
  );

  return { created: true, bill_id: result.lastInsertRowid, ...calc };
}

module.exports = { calculateFirstMonthRent, generateProratedFirstBill };
