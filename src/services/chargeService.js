const db = require('../db/database');

// ============================================================
// Default charge templates (auto-seed on dormitory create)
// ============================================================
// Thai-standard defaults (จากการสำรวจหอพักทั่วไปในไทย)
const DEFAULT_CHARGES = [
  { code:'room_deposit', label:'เงินประกันห้อง (มัดจำห้อง)', type:'deposit', amount:0, refundable:1, required:1, description:'มาตรฐาน 1-2 เดือนของค่าเช่า • คืนเมื่อย้ายออกหลังตรวจห้อง', sort_order:1 },
  { code:'key_deposit', label:'เงินประกันกุญแจ', type:'deposit', amount:500, refundable:1, required:1, description:'มาตรฐาน 200-500 บาท • คืนเมื่อคืนกุญแจครบ', sort_order:2 },
  { code:'meter_deposit', label:'เงินประกันมิเตอร์', type:'deposit', amount:0, refundable:1, required:0, description:'บางหอเก็บเพิ่ม สำหรับค่าน้ำ/ไฟค้าง', sort_order:3 },
  { code:'wifi_monthly', label:'ค่า Wi-Fi รายเดือน', type:'recurring', amount:200, refundable:0, required:0, description:'มาตรฐาน 100-300 บาท/เดือน', sort_order:10 },
  { code:'parking_monthly', label:'ค่าจอดรถยนต์', type:'recurring', amount:500, refundable:0, required:0, description:'มาตรฐาน 300-500 บาท/เดือน', sort_order:11 },
  { code:'parking_motor', label:'ค่าจอดมอเตอร์ไซค์', type:'recurring', amount:200, refundable:0, required:0, description:'มาตรฐาน 100-200 บาท/เดือน', sort_order:12 },
  { code:'common_fee', label:'ค่าส่วนกลาง (ลิฟต์/รปภ.)', type:'recurring', amount:0, refundable:0, required:0, description:'หอพักสูง 4 ชั้นขึ้นไปมักเก็บ', sort_order:13 },
  { code:'cleaning_fee', label:'ค่าทำความสะอาด (ตอนย้ายออก)', type:'onetime', amount:500, refundable:0, required:0, description:'มาตรฐาน 500-1000 บาท • หักจากเงินประกัน', sort_order:20 }
];

function ensureDefaultCharges(dormitoryId) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM dormitory_charges WHERE dormitory_id=?').get(dormitoryId);
  if (existing.c > 0) return;
  for (const c of DEFAULT_CHARGES) {
    db.prepare(`INSERT INTO dormitory_charges
      (dormitory_id, code, label, type, amount, refundable, required, description, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      dormitoryId, c.code, c.label, c.type, c.amount, c.refundable, c.required, c.description, c.sort_order
    );
  }
}

function listCharges(dormitoryId, filter = {}) {
  let q = 'SELECT * FROM dormitory_charges WHERE dormitory_id=?';
  const p = [dormitoryId];
  if (filter.type) { q += ' AND type=?'; p.push(filter.type); }
  if (filter.enabled) { q += ' AND enabled=1'; }
  q += ' ORDER BY sort_order, id';
  return db.prepare(q).all(...p);
}

function getCharge(id, dormitoryId) {
  return db.prepare('SELECT * FROM dormitory_charges WHERE id=? AND dormitory_id=?').get(id, dormitoryId);
}

function createCharge(dormitoryId, data) {
  const r = db.prepare(`INSERT INTO dormitory_charges
    (dormitory_id, code, label, type, amount, refundable, required, description, enabled, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    dormitoryId, data.code, data.label, data.type,
    parseFloat(data.amount) || 0,
    data.refundable ? 1 : 0, data.required ? 1 : 0,
    data.description || '', data.enabled === 0 ? 0 : 1,
    parseInt(data.sort_order) || 0
  );
  return getCharge(r.lastInsertRowid, dormitoryId);
}

function updateCharge(id, dormitoryId, data) {
  const fields = ['code','label','type','amount','refundable','required','description','enabled','sort_order'];
  const set = [], vals = [];
  for (const f of fields) {
    if (data[f] !== undefined) {
      let v = data[f];
      if (['refundable','required','enabled'].includes(f)) v = v ? 1 : 0;
      else if (['amount','sort_order'].includes(f)) v = parseFloat(v) || 0;
      set.push(`${f}=?`); vals.push(v);
    }
  }
  if (!set.length) return getCharge(id, dormitoryId);
  vals.push(id, dormitoryId);
  db.prepare(`UPDATE dormitory_charges SET ${set.join(',')} WHERE id=? AND dormitory_id=?`).run(...vals);
  return getCharge(id, dormitoryId);
}

function deleteCharge(id, dormitoryId) {
  return db.prepare('DELETE FROM dormitory_charges WHERE id=? AND dormitory_id=?').run(id, dormitoryId);
}

// ============================================================
// Utility rate calculation (tiered support)
// ============================================================
function computeWaterCharge(dormitory, units) {
  const type = dormitory.water_rate_type || 'flat';
  const rate = dormitory.water_rate || 18;
  const min = dormitory.water_min_charge || 0;
  if (type === 'flat') return Math.max(min, units * rate);
  if (type === 'min_charge') return Math.max(min, units * rate);
  if (type === 'tiered') {
    try {
      const tiers = JSON.parse(dormitory.water_tiers_json || '[]');
      // [{up_to: 10, rate: 15}, {up_to: 20, rate: 20}, {up_to: null, rate: 25}]
      let total = 0, remaining = units, prev = 0;
      for (const t of tiers) {
        const cap = t.up_to == null ? Infinity : t.up_to;
        const within = Math.min(remaining, cap - prev);
        total += within * t.rate;
        remaining -= within;
        prev = cap;
        if (remaining <= 0) break;
      }
      return Math.max(min, total);
    } catch { return units * rate; }
  }
  return units * rate;
}

function computeElectricCharge(dormitory, units) {
  const type = dormitory.electric_rate_type || 'flat';
  const rate = dormitory.electric_rate || 8;
  const min = dormitory.electric_min_charge || 0;
  if (type === 'flat') return Math.max(min, units * rate);
  if (type === 'min_charge') return Math.max(min, units * rate);
  if (type === 'tiered') {
    try {
      const tiers = JSON.parse(dormitory.electric_tiers_json || '[]');
      let total = 0, remaining = units, prev = 0;
      for (const t of tiers) {
        const cap = t.up_to == null ? Infinity : t.up_to;
        const within = Math.min(remaining, cap - prev);
        total += within * t.rate;
        remaining -= within;
        prev = cap;
        if (remaining <= 0) break;
      }
      return Math.max(min, total);
    } catch { return units * rate; }
  }
  return units * rate;
}

// ============================================================
// SETUP WIZARD STATE
// ============================================================
function getSetupState(dormitoryId) {
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormitoryId);
  if (!dorm) return null;

  // Note: line_integration check removed (Phase 2 roadmap)
  const checks = {
    basic_info: !!(dorm.name && dorm.address),
    utility_rates: !!(dorm.water_rate && dorm.electric_rate),
    promptpay: !!(dorm.promptpay_number && dorm.promptpay_name),
    charges_configured: db.prepare('SELECT COUNT(*) as c FROM dormitory_charges WHERE dormitory_id=?').get(dormitoryId).c > 0,
    has_rooms: db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id=?').get(dormitoryId).c > 0
  };

  const completedSteps = Object.values(checks).filter(Boolean).length;
  const totalSteps = Object.keys(checks).length;

  // จำเป็นจริง ๆ ที่ต้องมี: ห้องและค่าไฟ-น้ำ — ส่วน PromptPay/Charges ตั้งทีหลังได้
  const minimumReady = checks.basic_info && checks.utility_rates && checks.has_rooms;

  return {
    setup_completed: !!dorm.setup_completed,
    progress: completedSteps / totalSteps,
    checks,
    completed_steps: completedSteps,
    total_steps: totalSteps,
    can_use_operator: !!dorm.setup_completed || completedSteps >= 4 || minimumReady
  };
}

function markSetupCompleted(dormitoryId) {
  db.prepare('UPDATE dormitories SET setup_completed=1 WHERE id=?').run(dormitoryId);
}

module.exports = {
  ensureDefaultCharges, listCharges, getCharge, createCharge, updateCharge, deleteCharge,
  computeWaterCharge, computeElectricCharge,
  getSetupState, markSetupCompleted
};
