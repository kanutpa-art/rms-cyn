const db = require('../db/database');

const STATUS_META = {
  vacant:          { label:'ห้องว่าง', color:'gray',    bg:'#f3f4f6', text:'#6b7280', icon:'🏠' },
  occupied:        { label:'มีคนเช่า', color:'green',   bg:'#d1fae5', text:'#047857', icon:'👤' },
  maintenance:     { label:'แจ้งซ่อม', color:'orange',  bg:'#fed7aa', text:'#c2410c', icon:'🔧' },
  lost_key:        { label:'ลืมกุญแจ', color:'yellow',  bg:'#fef9c3', text:'#a16207', icon:'🔑' },
  needs_cleaning:  { label:'รอทำความสะอาด', color:'purple', bg:'#e9d5ff', text:'#7e22ce', icon:'🧹' },
  reserved:        { label:'จองล่วงหน้า', color:'blue',  bg:'#dbeafe', text:'#1d4ed8', icon:'📅' }
};

function statusMeta() { return STATUS_META; }

function getBuildingsSummary(dormitoryId) {
  const buildings = db.prepare(`
    SELECT building, COUNT(*) as total,
      SUM(CASE WHEN operational_status='vacant' THEN 1 ELSE 0 END) as vacant,
      SUM(CASE WHEN operational_status='occupied' THEN 1 ELSE 0 END) as occupied,
      SUM(CASE WHEN operational_status='maintenance' THEN 1 ELSE 0 END) as maintenance,
      SUM(CASE WHEN operational_status='lost_key' THEN 1 ELSE 0 END) as lost_key,
      SUM(CASE WHEN operational_status='needs_cleaning' THEN 1 ELSE 0 END) as needs_cleaning,
      SUM(CASE WHEN operational_status='reserved' THEN 1 ELSE 0 END) as reserved,
      MIN(floor) as min_floor, MAX(floor) as max_floor
    FROM rooms WHERE dormitory_id=? GROUP BY building ORDER BY building
  `).all(dormitoryId);
  return buildings;
}

function listRoomsForOperator(dormitoryId, { building, status, page = 1, perPage = 10 } = {}) {
  let q = `SELECT r.*, t.display_name as tenant_name, t.phone as tenant_phone,
    (SELECT COUNT(*) FROM maintenance_requests WHERE room_id=r.id AND status NOT IN ('completed','cancelled')) as open_maintenance,
    (SELECT total_amount FROM bills WHERE room_id=r.id ORDER BY billing_month DESC LIMIT 1) as last_bill,
    (SELECT status FROM bills WHERE room_id=r.id ORDER BY billing_month DESC LIMIT 1) as last_bill_status
    FROM rooms r LEFT JOIN tenants t ON r.id=t.room_id
    WHERE r.dormitory_id=?`;
  const p = [dormitoryId];
  if (building) { q += ' AND r.building=?'; p.push(building); }
  if (status)   { q += ' AND r.operational_status=?'; p.push(status); }
  q += ' ORDER BY r.building, r.floor, r.room_number';

  const all = db.prepare(q).all(...p);
  const total = all.length;
  const offset = (page - 1) * perPage;
  const paged = all.slice(offset, offset + perPage);

  return {
    rooms: paged.map(r => ({
      ...r,
      status_meta: STATUS_META[r.operational_status] || STATUS_META.vacant
    })),
    page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage)
  };
}

function getRoomDetail(roomId, dormitoryId) {
  const room = db.prepare(`
    SELECT r.*, t.display_name as tenant_name, t.phone, t.line_user_id, t.contract_start_date,
      t.deposit_amount
    FROM rooms r LEFT JOIN tenants t ON r.id=t.room_id
    WHERE r.id=? AND r.dormitory_id=?
  `).get(roomId, dormitoryId);
  if (!room) return null;

  const latestBill = db.prepare(`SELECT * FROM bills WHERE room_id=? ORDER BY billing_month DESC LIMIT 1`).get(roomId);
  const openMaintenance = db.prepare(`SELECT * FROM maintenance_requests WHERE room_id=? AND status NOT IN ('completed','cancelled') ORDER BY created_at DESC`).all(roomId);
  const recentStatusLog = db.prepare(`SELECT * FROM room_status_log WHERE room_id=? ORDER BY changed_at DESC LIMIT 5`).all(roomId);

  return {
    ...room,
    status_meta: STATUS_META[room.operational_status] || STATUS_META.vacant,
    latest_bill: latestBill,
    open_maintenance: openMaintenance,
    recent_status_changes: recentStatusLog
  };
}

function setRoomStatus(roomId, dormitoryId, newStatus, note, adminId) {
  if (!STATUS_META[newStatus]) throw new Error('Invalid status: ' + newStatus);
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND dormitory_id=?').get(roomId, dormitoryId);
  if (!room) throw new Error('Room not found');

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE rooms SET operational_status=?, status_note=?, status_updated_at=datetime('now') WHERE id=?`)
      .run(newStatus, note || '', roomId);
    db.prepare(`INSERT INTO room_status_log (room_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?)`)
      .run(roomId, room.operational_status, newStatus, note || '', adminId || null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return getRoomDetail(roomId, dormitoryId);
}

// ============================================================
// AUTO-SYNC: refresh statuses based on system data
// ============================================================
function autoSyncStatuses(dormitoryId) {
  // Set occupied for rooms with tenants (only if currently vacant)
  db.prepare(`UPDATE rooms SET operational_status='occupied'
    WHERE dormitory_id=? AND operational_status='vacant'
      AND id IN (SELECT room_id FROM tenants)`).run(dormitoryId);

  // Set vacant for rooms without tenants (only if currently occupied — preserve maintenance/cleaning states)
  db.prepare(`UPDATE rooms SET operational_status='vacant'
    WHERE dormitory_id=? AND operational_status='occupied'
      AND id NOT IN (SELECT room_id FROM tenants)`).run(dormitoryId);

  return { synced: true };
}

module.exports = {
  STATUS_META, statusMeta,
  getBuildingsSummary, listRoomsForOperator, getRoomDetail, setRoomStatus,
  autoSyncStatuses
};
