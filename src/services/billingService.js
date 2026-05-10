const db = require('../db/database');

function calculate({ room, dormitoryId, waterCurr, electricCurr, prevWater, prevElectric, otherAmount = 0, otherLabel = '' }) {
  const dorm = db.prepare('SELECT water_rate, electric_rate FROM dormitories WHERE id = ?').get(dormitoryId);
  const waterRate = dorm?.water_rate || 18;
  const electricRate = dorm?.electric_rate || 8;

  const waterUnits = Math.max(0, waterCurr - prevWater);
  const electricUnits = Math.max(0, electricCurr - prevElectric);

  const waterAmount = waterUnits * waterRate;
  const electricAmount = electricUnits * electricRate;
  const rentAmount = room.monthly_rent;
  const total = rentAmount + waterAmount + electricAmount + otherAmount;

  return {
    water_meter_prev: prevWater,
    water_meter_curr: waterCurr,
    electric_meter_prev: prevElectric,
    electric_meter_curr: electricCurr,
    water_units: waterUnits,
    electric_units: electricUnits,
    water_amount: waterAmount,
    electric_amount: electricAmount,
    rent_amount: rentAmount,
    other_amount: otherAmount,
    other_label: otherLabel,
    total_amount: total
  };
}

// สร้าง/อัปเดตบิลรายเดือน
function createOrUpdateBill({ roomId, dormitoryId, billingMonth, waterCurr, electricCurr, otherAmount = 0, otherLabel = '', dueDate = null }) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);

  // หา meter เดือนก่อน
  const lastBill = db.prepare('SELECT * FROM bills WHERE room_id = ? ORDER BY billing_month DESC LIMIT 1').get(roomId);
  const prevWater = lastBill ? lastBill.water_meter_curr : room.initial_water_meter;
  const prevElectric = lastBill ? lastBill.electric_meter_curr : room.initial_electric_meter;

  const calc = calculate({ room, dormitoryId, waterCurr, electricCurr, prevWater, prevElectric, otherAmount, otherLabel });

  const existing = db.prepare('SELECT id FROM bills WHERE room_id = ? AND billing_month = ?').get(roomId, billingMonth);

  if (existing) {
    db.prepare(`
      UPDATE bills SET
        water_meter_prev=?, water_meter_curr=?, electric_meter_prev=?, electric_meter_curr=?,
        water_units=?, electric_units=?, water_amount=?, electric_amount=?,
        rent_amount=?, other_amount=?, other_label=?, total_amount=?,
        status='pending', due_date=?
      WHERE id=?
    `).run(
      calc.water_meter_prev, calc.water_meter_curr, calc.electric_meter_prev, calc.electric_meter_curr,
      calc.water_units, calc.electric_units, calc.water_amount, calc.electric_amount,
      calc.rent_amount, calc.other_amount, calc.other_label, calc.total_amount,
      dueDate, existing.id
    );
    return db.prepare('SELECT * FROM bills WHERE id = ?').get(existing.id);
  } else {
    const result = db.prepare(`
      INSERT INTO bills (
        room_id, billing_month,
        water_meter_prev, water_meter_curr, electric_meter_prev, electric_meter_curr,
        water_units, electric_units, water_amount, electric_amount,
        rent_amount, other_amount, other_label, total_amount,
        status, due_date
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      roomId, billingMonth,
      calc.water_meter_prev, calc.water_meter_curr, calc.electric_meter_prev, calc.electric_meter_curr,
      calc.water_units, calc.electric_units, calc.water_amount, calc.electric_amount,
      calc.rent_amount, calc.other_amount, calc.other_label, calc.total_amount,
      'pending', dueDate
    );
    return db.prepare('SELECT * FROM bills WHERE id = ?').get(result.lastInsertRowid);
  }
}

module.exports = { calculate, createOrUpdateBill };
