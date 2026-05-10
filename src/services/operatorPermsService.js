const db = require('../db/database');

const PERMISSION_KEYS = [
  'can_view_buildings','can_view_rooms','can_change_status','can_view_tenant_info',
  'can_view_bills','can_create_bills','can_approve_payments','can_handle_maintenance',
  'can_send_reminders','can_create_invite'
];

const PERMISSION_LABELS = {
  can_view_buildings: 'ดูรายการอาคาร',
  can_view_rooms: 'ดูห้องในอาคาร',
  can_change_status: 'เปลี่ยนสถานะห้อง',
  can_view_tenant_info: 'ดูข้อมูลผู้เช่า (ชื่อ/เบอร์)',
  can_view_bills: 'ดูบิลค่าเช่า',
  can_create_bills: 'ออกบิลใหม่',
  can_approve_payments: 'อนุมัติสลิปการโอน',
  can_handle_maintenance: 'จัดการแจ้งซ่อม',
  can_send_reminders: 'ส่งข้อความเตือนค่าเช่า',
  can_create_invite: 'สร้าง Invite Link'
};

// Default sets per role
const ROLE_DEFAULTS = {
  owner: Object.fromEntries(PERMISSION_KEYS.map(k => [k, 1])),
  admin: Object.fromEntries(PERMISSION_KEYS.map(k => [k, 1])),
  manager: {
    can_view_buildings:1, can_view_rooms:1, can_change_status:1, can_view_tenant_info:1,
    can_view_bills:1, can_create_bills:1, can_approve_payments:1, can_handle_maintenance:1,
    can_send_reminders:1, can_create_invite:0
  },
  technician: {
    can_view_buildings:1, can_view_rooms:1, can_change_status:1, can_view_tenant_info:0,
    can_view_bills:0, can_create_bills:0, can_approve_payments:0, can_handle_maintenance:1,
    can_send_reminders:0, can_create_invite:0
  }
};

function getPerms(adminUserId, dormitoryId) {
  let p = db.prepare('SELECT * FROM operator_permissions WHERE admin_user_id=? AND dormitory_id=?').get(adminUserId, dormitoryId);
  if (!p) {
    // Auto-seed from role
    const roleRow = db.prepare('SELECT role FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?').get(adminUserId, dormitoryId);
    const defaults = ROLE_DEFAULTS[roleRow?.role || 'manager'];
    const cols = ['admin_user_id','dormitory_id', ...PERMISSION_KEYS];
    const vals = [adminUserId, dormitoryId, ...PERMISSION_KEYS.map(k => defaults[k] || 0)];
    db.prepare(`INSERT INTO operator_permissions (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...vals);
    p = db.prepare('SELECT * FROM operator_permissions WHERE admin_user_id=? AND dormitory_id=?').get(adminUserId, dormitoryId);
  }
  return p;
}

function updatePerms(adminUserId, dormitoryId, data) {
  getPerms(adminUserId, dormitoryId); // ensure exists
  const set = [], vals = [];
  for (const k of PERMISSION_KEYS) {
    if (data[k] !== undefined) {
      set.push(`${k}=?`);
      vals.push(data[k] ? 1 : 0);
    }
  }
  if (data.visible_buildings !== undefined) {
    set.push('visible_buildings=?');
    vals.push(Array.isArray(data.visible_buildings) ? data.visible_buildings.join(',') : (data.visible_buildings || null));
  }
  if (!set.length) return getPerms(adminUserId, dormitoryId);
  vals.push(adminUserId, dormitoryId);
  db.prepare(`UPDATE operator_permissions SET ${set.join(',')} WHERE admin_user_id=? AND dormitory_id=?`).run(...vals);
  return getPerms(adminUserId, dormitoryId);
}

function listAllForDormitory(dormitoryId) {
  return db.prepare(`
    SELECT op.*, au.name, au.email, oda.role
    FROM operator_permissions op
    JOIN admin_users au ON au.id=op.admin_user_id
    JOIN owner_dormitory_access oda ON oda.admin_user_id=au.id AND oda.dormitory_id=op.dormitory_id
    WHERE op.dormitory_id=?
    ORDER BY oda.role, au.name
  `).all(dormitoryId);
}

module.exports = {
  PERMISSION_KEYS, PERMISSION_LABELS, ROLE_DEFAULTS,
  getPerms, updatePerms, listAllForDormitory
};
