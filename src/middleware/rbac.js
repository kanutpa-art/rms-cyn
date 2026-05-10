const db = require('../db/database');

// ============================================================
// Role Permission Matrix
// ============================================================
// owner       — เจ้าของหอ — ทุกอย่าง รวม billing/finance/contracts/admins
// admin       — ผู้ช่วยหัวหน้า — ทุกอย่าง ยกเว้น finance + manage admins
// manager     — ผู้จัดการ — rooms/bills/payments/maintenance/contracts/calendar (ไม่มี finance)
// technician  — ช่างซ่อม — maintenance + assets + vendors เท่านั้น
// ============================================================

const PERMISSIONS = {
  owner: ['*'], // wildcard = ทั้งหมด
  admin: [
    'dashboard.view','rooms.*','tenants.*','bills.*','payments.*',
    'maintenance.*','contracts.*','collection.*','calendar.*',
    'inspections.*','assets.*','vendors.*','blacklist.*','moveout.*','deposit.*',
    'settings.view','settings.update','reminders.*'
  ],
  manager: [
    'dashboard.view','rooms.view','rooms.update','tenants.view','tenants.update',
    'bills.*','payments.*','maintenance.*','contracts.view',
    'calendar.*','inspections.*','assets.view','assets.update',
    'moveout.view','moveout.update'
  ],
  technician: [
    'dashboard.view','maintenance.*','assets.*','vendors.*','calendar.view'
  ]
};

const ROLE_LABELS = {
  owner: 'เจ้าของหอ',
  admin: 'ผู้ดูแลระบบ',
  manager: 'ผู้จัดการ',
  technician: 'ช่างซ่อม'
};

function getRoleForActiveDormitory(adminId, dormitoryId) {
  const r = db.prepare(`SELECT role FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?`)
    .get(adminId, dormitoryId);
  return r?.role || null;
}

function hasPermission(role, permission) {
  if (!role) return false;
  const perms = PERMISSIONS[role] || [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  // wildcard match: 'rooms.*' covers 'rooms.create', 'rooms.view', etc
  const [domain] = permission.split('.');
  if (perms.includes(`${domain}.*`)) return true;
  return false;
}

// Middleware factory: requires specific permission
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session?.adminId) return res.status(401).json({ error: 'Unauthorized' });
    const role = getRoleForActiveDormitory(req.session.adminId, req.dormitoryId);
    if (!hasPermission(role, permission)) {
      return res.status(403).json({ error: `ไม่มีสิทธิ์ (${permission}) สำหรับ role ${role || 'unknown'}` });
    }
    req.role = role;
    next();
  };
}

// Attach role to req
function attachRole(req, res, next) {
  if (req.session?.adminId && req.dormitoryId) {
    req.role = getRoleForActiveDormitory(req.session.adminId, req.dormitoryId);
  }
  next();
}

module.exports = {
  PERMISSIONS, ROLE_LABELS,
  hasPermission, getRoleForActiveDormitory,
  requirePermission, attachRole
};
