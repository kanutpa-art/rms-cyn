const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');

// ============================================================
// BLACKLIST
// ============================================================
function listBlacklist(dormitoryId) {
  return db.prepare(`SELECT b.*, au.name as added_by_name FROM tenant_blacklist b
    LEFT JOIN admin_users au ON b.created_by=au.id
    WHERE b.dormitory_id=? OR b.dormitory_id IS NULL
    ORDER BY b.created_at DESC`).all(dormitoryId);
}

function checkBlacklist(idCard, phone) {
  if (!idCard && !phone) return null;
  const conds = [], vals = [];
  if (idCard) { conds.push('id_card=?'); vals.push(idCard); }
  if (phone)  { conds.push('phone=?');   vals.push(phone); }
  return db.prepare(`SELECT * FROM tenant_blacklist WHERE ${conds.join(' OR ')} ORDER BY severity DESC LIMIT 1`).get(...vals);
}

function addBlacklist(dormitoryId, data, adminId) {
  const r = db.prepare(`INSERT INTO tenant_blacklist
    (dormitory_id, full_name, id_card, phone, reason, severity, created_by)
    VALUES (?,?,?,?,?,?,?)`).run(
    dormitoryId, data.full_name, data.id_card || '', data.phone || '',
    data.reason || '', data.severity || 'medium', adminId || null
  );
  return db.prepare('SELECT * FROM tenant_blacklist WHERE id=?').get(r.lastInsertRowid);
}

function removeBlacklist(id, dormitoryId) {
  return db.prepare('DELETE FROM tenant_blacklist WHERE id=? AND dormitory_id=?').run(id, dormitoryId);
}

// ============================================================
// MULTI-PROPERTY
// ============================================================
function listAccessibleDormitories(adminUserId) {
  return db.prepare(`SELECT d.*, oda.role, oda.is_default FROM owner_dormitory_access oda
    JOIN dormitories d ON oda.dormitory_id=d.id
    WHERE oda.admin_user_id=? ORDER BY oda.is_default DESC, d.name`).all(adminUserId);
}

function grantDormitoryAccess(adminUserId, dormitoryId, role = 'admin') {
  db.prepare(`INSERT OR REPLACE INTO owner_dormitory_access (admin_user_id, dormitory_id, role)
    VALUES (?,?,?)`).run(adminUserId, dormitoryId, role);
}

function revokeDormitoryAccess(adminUserId, dormitoryId) {
  db.prepare('DELETE FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?').run(adminUserId, dormitoryId);
}

function setDefaultDormitory(adminUserId, dormitoryId) {
  db.prepare('UPDATE owner_dormitory_access SET is_default=0 WHERE admin_user_id=?').run(adminUserId);
  db.prepare('UPDATE owner_dormitory_access SET is_default=1 WHERE admin_user_id=? AND dormitory_id=?')
    .run(adminUserId, dormitoryId);
}

function createDormitory(adminUserId, data) {
  const r = db.prepare(`INSERT INTO dormitories (name, address, water_rate, electric_rate)
    VALUES (?,?,?,?)`).run(data.name, data.address || '', data.water_rate || 18, data.electric_rate || 8);
  const dormId = r.lastInsertRowid;
  grantDormitoryAccess(adminUserId, dormId, 'owner');
  return db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormId);
}

function hasAccess(adminUserId, dormitoryId) {
  return !!db.prepare('SELECT 1 FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?').get(adminUserId, dormitoryId);
}

// ============================================================
// E-SIGNATURE
// ============================================================
function createSignToken(contractId, signerType) {
  // ลบ token เก่าที่ยังใช้ได้
  db.prepare("UPDATE contract_sign_tokens SET used_at=datetime('now') WHERE contract_id=? AND signer_type=? AND used_at IS NULL").run(contractId, signerType);
  const token = uuidv4().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO contract_sign_tokens (contract_id, token, signer_type, expires_at)
    VALUES (?,?,?,?)`).run(contractId, token, signerType, expiresAt);
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return { token, url: `${baseUrl}/sign/${token}`, expires_at: expiresAt };
}

function getContractByToken(token) {
  const t = db.prepare(`SELECT * FROM contract_sign_tokens
    WHERE token=? AND used_at IS NULL AND expires_at > datetime('now')`).get(token);
  if (!t) return null;
  const c = db.prepare(`SELECT c.*, r.room_code, r.room_number, d.name as dormitory_name
    FROM contracts c JOIN rooms r ON c.room_id=r.id JOIN dormitories d ON c.dormitory_id=d.id
    WHERE c.id=?`).get(t.contract_id);
  return { token: t, contract: c };
}

function applySignature(token, data) {
  const t = db.prepare(`SELECT * FROM contract_sign_tokens
    WHERE token=? AND used_at IS NULL AND expires_at > datetime('now')`).get(token);
  if (!t) throw new Error('Token หมดอายุหรือถูกใช้แล้ว');

  db.prepare(`INSERT OR REPLACE INTO contract_signatures
    (contract_id, signer_type, signer_name, signer_line_id, signature_data, signed_at, ip_address)
    VALUES (?,?,?,?,?,datetime('now'),?)`).run(
    t.contract_id, t.signer_type, data.signer_name || '',
    data.signer_line_id || '', data.signature_data || '', data.ip_address || ''
  );
  db.prepare("UPDATE contract_sign_tokens SET used_at=datetime('now') WHERE id=?").run(t.id);

  // ถ้าเซ็นครบทั้งสองฝั่ง — update contract.signed_at
  const sigCount = db.prepare('SELECT COUNT(*) as c FROM contract_signatures WHERE contract_id=?').get(t.contract_id).c;
  if (sigCount >= 2) {
    db.prepare("UPDATE contracts SET signed_at=datetime('now'), status='active' WHERE id=?").run(t.contract_id);
  }

  return { signed: true, signer_type: t.signer_type, contract_id: t.contract_id };
}

function getSignatures(contractId) {
  return db.prepare('SELECT * FROM contract_signatures WHERE contract_id=?').all(contractId);
}

module.exports = {
  // blacklist
  listBlacklist, checkBlacklist, addBlacklist, removeBlacklist,
  // multi-property
  listAccessibleDormitories, grantDormitoryAccess, revokeDormitoryAccess, setDefaultDormitory,
  createDormitory, hasAccess,
  // e-signature
  createSignToken, getContractByToken, applySignature, getSignatures
};
