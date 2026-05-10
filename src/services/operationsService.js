const db = require('../db/database');
const lineService = require('./lineService');

// ============================================================
// INSPECTION
// ============================================================
function listInspections(dormitoryId, { roomId, type } = {}) {
  let q = `SELECT i.*, r.room_code, r.room_number, t.display_name as tenant_name, au.name as inspector_name
    FROM inspections i
    JOIN rooms r ON i.room_id=r.id
    LEFT JOIN tenants t ON i.tenant_id=t.id
    LEFT JOIN admin_users au ON i.inspector_id=au.id
    WHERE i.dormitory_id=?`;
  const p = [dormitoryId];
  if (roomId) { q += ' AND i.room_id=?'; p.push(roomId); }
  if (type)   { q += ' AND i.type=?'; p.push(type); }
  q += ' ORDER BY i.inspection_date DESC, i.id DESC';
  return db.prepare(q).all(...p);
}

function getInspection(id, dormitoryId) {
  const i = db.prepare(`SELECT i.*, r.room_code, r.room_number, t.display_name as tenant_name
    FROM inspections i
    JOIN rooms r ON i.room_id=r.id
    LEFT JOIN tenants t ON i.tenant_id=t.id
    WHERE i.id=? AND i.dormitory_id=?`).get(id, dormitoryId);
  if (!i) return null;
  i.photos = db.prepare('SELECT * FROM inspection_photos WHERE inspection_id=?').all(id);
  i.damages = i.damages_json ? JSON.parse(i.damages_json) : [];
  return i;
}

function createInspection(dormitoryId, data, inspectorId) {
  const damagesJson = JSON.stringify(data.damages || []);
  const totalDeduction = (data.damages || []).reduce((s, d) => s + (parseFloat(d.cost) || 0), 0);
  const r = db.prepare(`INSERT INTO inspections
    (dormitory_id, room_id, tenant_id, type, inspection_date,
     water_meter, electric_meter, overall_condition, notes,
     damages_json, total_deduction, inspector_id, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    dormitoryId, data.room_id, data.tenant_id || null, data.type, data.inspection_date,
    data.water_meter || null, data.electric_meter || null,
    data.overall_condition || '', data.notes || '',
    damagesJson, totalDeduction, inspectorId, data.status || 'draft'
  );
  return getInspection(r.lastInsertRowid, dormitoryId);
}

function updateInspection(id, dormitoryId, data) {
  const damagesJson = data.damages ? JSON.stringify(data.damages) : null;
  const totalDeduction = data.damages ? data.damages.reduce((s, d) => s + (parseFloat(d.cost) || 0), 0) : null;
  const allowed = ['inspection_date','water_meter','electric_meter','overall_condition','notes','status'];
  const set = [], vals = [];
  for (const k of allowed) if (data[k] !== undefined) { set.push(`${k}=?`); vals.push(data[k]); }
  if (damagesJson !== null) { set.push('damages_json=?'); vals.push(damagesJson); set.push('total_deduction=?'); vals.push(totalDeduction); }
  if (!set.length) return getInspection(id, dormitoryId);
  vals.push(id, dormitoryId);
  db.prepare(`UPDATE inspections SET ${set.join(',')} WHERE id=? AND dormitory_id=?`).run(...vals);
  return getInspection(id, dormitoryId);
}

function deleteInspection(id, dormitoryId) {
  return db.prepare('DELETE FROM inspections WHERE id=? AND dormitory_id=?').run(id, dormitoryId);
}

// ============================================================
// ASSETS
// ============================================================
function listAssets(roomId) {
  return db.prepare('SELECT * FROM room_assets WHERE room_id=? ORDER BY category, name').all(roomId);
}

function listAllAssets(dormitoryId) {
  return db.prepare(`
    SELECT a.*, r.room_code, r.room_number FROM room_assets a
    JOIN rooms r ON a.room_id=r.id WHERE r.dormitory_id=?
    ORDER BY r.building, r.floor, r.room_number, a.category
  `).all(dormitoryId);
}

function createAsset(roomId, data) {
  const r = db.prepare(`INSERT INTO room_assets
    (room_id, name, category, serial_number, purchase_date, purchase_price, condition, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    roomId, data.name, data.category || '', data.serial_number || '',
    data.purchase_date || null, parseFloat(data.purchase_price) || 0,
    data.condition || 'good', data.notes || ''
  );
  return db.prepare('SELECT * FROM room_assets WHERE id=?').get(r.lastInsertRowid);
}

function updateAsset(id, data) {
  const allowed = ['name','category','serial_number','purchase_date','purchase_price','condition','notes'];
  const set = [], vals = [];
  for (const k of allowed) if (data[k] !== undefined) { set.push(`${k}=?`); vals.push(data[k]); }
  if (!set.length) return;
  vals.push(id);
  db.prepare(`UPDATE room_assets SET ${set.join(',')} WHERE id=?`).run(...vals);
  return db.prepare('SELECT * FROM room_assets WHERE id=?').get(id);
}

function deleteAsset(id) {
  return db.prepare('DELETE FROM room_assets WHERE id=?').run(id);
}

// ============================================================
// VENDORS
// ============================================================
function listVendors(dormitoryId) {
  return db.prepare(`SELECT v.*, COUNT(j.id) as job_count, COALESCE(SUM(j.cost),0) as total_paid
    FROM vendors v LEFT JOIN vendor_jobs j ON v.id=j.vendor_id
    WHERE v.dormitory_id=? GROUP BY v.id ORDER BY v.name`).all(dormitoryId);
}

function createVendor(dormitoryId, data) {
  const r = db.prepare(`INSERT INTO vendors
    (dormitory_id, name, category, phone, email, address, rating, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    dormitoryId, data.name, data.category || '', data.phone || '',
    data.email || '', data.address || '', parseInt(data.rating) || 0, data.notes || ''
  );
  return db.prepare('SELECT * FROM vendors WHERE id=?').get(r.lastInsertRowid);
}

function updateVendor(id, dormitoryId, data) {
  const allowed = ['name','category','phone','email','address','rating','notes'];
  const set = [], vals = [];
  for (const k of allowed) if (data[k] !== undefined) { set.push(`${k}=?`); vals.push(data[k]); }
  if (!set.length) return;
  vals.push(id, dormitoryId);
  db.prepare(`UPDATE vendors SET ${set.join(',')} WHERE id=? AND dormitory_id=?`).run(...vals);
  return db.prepare('SELECT * FROM vendors WHERE id=?').get(id);
}

function deleteVendor(id, dormitoryId) {
  return db.prepare('DELETE FROM vendors WHERE id=? AND dormitory_id=?').run(id, dormitoryId);
}

function listVendorJobs(vendorId) {
  return db.prepare(`SELECT j.*, mr.title as maintenance_title FROM vendor_jobs j
    LEFT JOIN maintenance_requests mr ON j.maintenance_id=mr.id
    WHERE j.vendor_id=? ORDER BY j.job_date DESC`).all(vendorId);
}

function createVendorJob(vendorId, data) {
  const r = db.prepare(`INSERT INTO vendor_jobs
    (vendor_id, maintenance_id, cost, job_date, status, notes)
    VALUES (?,?,?,?,?,?)`).run(
    vendorId, data.maintenance_id || null, parseFloat(data.cost) || 0,
    data.job_date || null, data.status || 'pending', data.notes || ''
  );
  return db.prepare('SELECT * FROM vendor_jobs WHERE id=?').get(r.lastInsertRowid);
}

// ============================================================
// CALENDAR
// ============================================================
function listCalendarEvents(dormitoryId, { from, to } = {}) {
  let q = `SELECT ce.*, r.room_code, r.room_number, t.display_name as tenant_name
    FROM calendar_events ce
    LEFT JOIN rooms r ON ce.related_room_id=r.id
    LEFT JOIN tenants t ON ce.related_tenant_id=t.id
    WHERE ce.dormitory_id=?`;
  const p = [dormitoryId];
  if (from) { q += ' AND ce.event_date >= ?'; p.push(from); }
  if (to)   { q += ' AND ce.event_date <= ?'; p.push(to); }
  q += ' ORDER BY ce.event_date, ce.event_time';
  return db.prepare(q).all(...p);
}

function createEvent(dormitoryId, data) {
  const r = db.prepare(`INSERT INTO calendar_events
    (dormitory_id, title, description, event_type, event_date, event_time,
     related_room_id, related_tenant_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    dormitoryId, data.title, data.description || '', data.event_type || 'manual',
    data.event_date, data.event_time || null,
    data.related_room_id || null, data.related_tenant_id || null
  );
  return db.prepare('SELECT * FROM calendar_events WHERE id=?').get(r.lastInsertRowid);
}

function updateEvent(id, dormitoryId, data) {
  const allowed = ['title','description','event_type','event_date','event_time','related_room_id','related_tenant_id','completed'];
  const set = [], vals = [];
  for (const k of allowed) if (data[k] !== undefined) { set.push(`${k}=?`); vals.push(data[k]); }
  if (!set.length) return;
  vals.push(id, dormitoryId);
  db.prepare(`UPDATE calendar_events SET ${set.join(',')} WHERE id=? AND dormitory_id=?`).run(...vals);
}

function deleteEvent(id, dormitoryId) {
  return db.prepare('DELETE FROM calendar_events WHERE id=? AND dormitory_id=?').run(id, dormitoryId);
}

// ============================================================
// SMART REMINDERS
// ============================================================
function getReminderSettings(dormitoryId) {
  let s = db.prepare('SELECT * FROM reminder_settings WHERE dormitory_id=?').get(dormitoryId);
  if (!s) {
    db.prepare('INSERT INTO reminder_settings (dormitory_id) VALUES (?)').run(dormitoryId);
    s = db.prepare('SELECT * FROM reminder_settings WHERE dormitory_id=?').get(dormitoryId);
  }
  return s;
}

function updateReminderSettings(dormitoryId, data) {
  getReminderSettings(dormitoryId);
  const allowed = ['meter_reading_day','contract_expiry_warn_days','bill_due_warn_days','enabled'];
  const set = [], vals = [];
  for (const k of allowed) if (data[k] !== undefined) { set.push(`${k}=?`); vals.push(data[k]); }
  if (!set.length) return getReminderSettings(dormitoryId);
  vals.push(dormitoryId);
  db.prepare(`UPDATE reminder_settings SET ${set.join(',')} WHERE dormitory_id=?`).run(...vals);
  return getReminderSettings(dormitoryId);
}

// Auto-generate calendar events for upcoming contract expiries & meter readings
async function generateUpcomingReminders(dormitoryId) {
  const s = getReminderSettings(dormitoryId);
  if (!s.enabled) return { generated: 0 };
  let count = 0;
  const today = new Date();

  // 1. Meter reading reminder for next month's date
  const next = new Date(today.getFullYear(), today.getMonth(), s.meter_reading_day);
  if (next < today) next.setMonth(next.getMonth() + 1);
  const nextStr = next.toISOString().slice(0, 10);
  const exists1 = db.prepare(`SELECT id FROM calendar_events WHERE dormitory_id=? AND event_type='meter_reading' AND event_date=?`).get(dormitoryId, nextStr);
  if (!exists1) {
    db.prepare(`INSERT INTO calendar_events (dormitory_id, title, event_type, event_date)
      VALUES (?,?,?,?)`).run(dormitoryId, '📏 อ่านมิเตอร์ประจำเดือน', 'meter_reading', nextStr);
    count++;
  }

  // 2. Contract expiring within warn_days
  const warn = new Date(today.getTime() + s.contract_expiry_warn_days * 86400000).toISOString().slice(0, 10);
  const expiring = db.prepare(`SELECT c.*, r.room_code FROM contracts c JOIN rooms r ON c.room_id=r.id
    WHERE c.dormitory_id=? AND c.status='active' AND c.end_date <= ? AND c.end_date >= date('now')`)
    .all(dormitoryId, warn);
  for (const c of expiring) {
    const exists2 = db.prepare(`SELECT id FROM calendar_events WHERE dormitory_id=? AND event_type='contract_expiry' AND related_room_id=? AND event_date=?`).get(dormitoryId, c.room_id, c.end_date);
    if (!exists2) {
      db.prepare(`INSERT INTO calendar_events (dormitory_id, title, description, event_type, event_date, related_room_id, related_tenant_id)
        VALUES (?,?,?,?,?,?,?)`).run(
        dormitoryId, `📜 สัญญาห้อง ${c.room_code} หมดอายุ`,
        `สัญญา ${c.contract_number} ของ ${c.tenant_name || '-'} หมดอายุ`,
        'contract_expiry', c.end_date, c.room_id, c.tenant_id
      );
      count++;
    }
  }

  return { generated: count };
}

// Send today's reminders to admin via LINE
async function sendDailyReminders(dormitoryId) {
  const today = new Date().toISOString().slice(0, 10);
  const events = db.prepare(`SELECT ce.*, r.room_code FROM calendar_events ce
    LEFT JOIN rooms r ON ce.related_room_id=r.id
    WHERE ce.dormitory_id=? AND ce.event_date=? AND ce.completed=0 AND ce.reminded=0`)
    .all(dormitoryId, today);
  if (!events.length) return { sent: 0 };

  const admins = db.prepare('SELECT line_user_id FROM admin_line_links WHERE dormitory_id=?').all(dormitoryId);
  if (!admins.length) return { sent: 0, reason: 'no_admin_linked' };

  const lines = events.map(e => `• ${e.title}${e.event_time ? ' '+e.event_time : ''}`);
  const text = `🔔 แจ้งเตือนวันนี้ (${today}):\n${lines.join('\n')}`;

  for (const a of admins) {
    try { await lineService.pushMessage(dormitoryId, a.line_user_id, { type: 'text', text }); } catch {}
  }
  // mark as reminded
  db.prepare(`UPDATE calendar_events SET reminded=1 WHERE dormitory_id=? AND event_date=?`).run(dormitoryId, today);
  return { sent: events.length };
}

module.exports = {
  // inspections
  listInspections, getInspection, createInspection, updateInspection, deleteInspection,
  // assets
  listAssets, listAllAssets, createAsset, updateAsset, deleteAsset,
  // vendors
  listVendors, createVendor, updateVendor, deleteVendor, listVendorJobs, createVendorJob,
  // calendar
  listCalendarEvents, createEvent, updateEvent, deleteEvent,
  // reminders
  getReminderSettings, updateReminderSettings, generateUpcomingReminders, sendDailyReminders
};
