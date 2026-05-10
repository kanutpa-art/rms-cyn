const db = require('../db/database');

// ============================================================
// MOVE-OUT REQUESTS
// ============================================================
function listMoveOutRequests(dormitoryId, { status } = {}) {
  let q = `SELECT m.*, r.room_code, r.room_number, t.display_name, t.line_user_id
    FROM move_out_requests m
    JOIN rooms r ON m.room_id=r.id
    JOIN tenants t ON m.tenant_id=t.id
    WHERE r.dormitory_id=?`;
  const p = [dormitoryId];
  if (status) { q += ' AND m.status=?'; p.push(status); }
  q += ' ORDER BY m.created_at DESC';
  return db.prepare(q).all(...p);
}

function createMoveOutRequest(tenantId, data) {
  const tenant = db.prepare('SELECT room_id FROM tenants WHERE id=?').get(tenantId);
  if (!tenant) throw new Error('Tenant not found');
  // Cancel any existing pending request
  db.prepare("UPDATE move_out_requests SET status='cancelled' WHERE tenant_id=? AND status='pending'").run(tenantId);
  const r = db.prepare(`INSERT INTO move_out_requests
    (tenant_id, room_id, requested_date, reason, status)
    VALUES (?,?,?,?,'pending')`).run(
    tenantId, tenant.room_id, data.requested_date, data.reason || ''
  );
  return db.prepare('SELECT * FROM move_out_requests WHERE id=?').get(r.lastInsertRowid);
}

function getActiveMoveOutForTenant(tenantId) {
  return db.prepare("SELECT * FROM move_out_requests WHERE tenant_id=? AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1").get(tenantId);
}

function updateMoveOutRequest(id, dormitoryId, data) {
  // verify dormitory access
  const exists = db.prepare(`SELECT m.id FROM move_out_requests m
    JOIN rooms r ON m.room_id=r.id WHERE m.id=? AND r.dormitory_id=?`).get(id, dormitoryId);
  if (!exists) throw new Error('Not found');
  const allowed = ['status','admin_note','actual_date','final_deposit_refund','inspection_id'];
  const set = [], vals = [];
  for (const k of allowed) if (data[k] !== undefined) { set.push(`${k}=?`); vals.push(data[k]); }
  if (!set.length) return;
  set.push("updated_at=datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE move_out_requests SET ${set.join(',')} WHERE id=?`).run(...vals);
  return db.prepare('SELECT * FROM move_out_requests WHERE id=?').get(id);
}

// ============================================================
// DEPOSIT TRANSACTIONS
// ============================================================
function listDepositTxs(tenantId) {
  return db.prepare(`SELECT * FROM deposit_transactions WHERE tenant_id=? ORDER BY created_at`).all(tenantId);
}

function depositBalance(tenantId) {
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END),0) as deposited,
      COALESCE(SUM(CASE WHEN type='deduction' THEN amount ELSE 0 END),0) as deducted,
      COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) as refunded,
      COALESCE(SUM(CASE WHEN type='adjustment' THEN amount ELSE 0 END),0) as adjusted
    FROM deposit_transactions WHERE tenant_id=?
  `).get(tenantId);
  return {
    ...r,
    balance: (r.deposited + r.adjusted) - (r.deducted + r.refunded)
  };
}

function createDepositTx(tenantId, data, adminId) {
  const r = db.prepare(`INSERT INTO deposit_transactions
    (tenant_id, type, amount, description, reference_type, reference_id, created_by)
    VALUES (?,?,?,?,?,?,?)`).run(
    tenantId, data.type, parseFloat(data.amount),
    data.description || '', data.reference_type || null,
    data.reference_id || null, adminId || null
  );
  return db.prepare('SELECT * FROM deposit_transactions WHERE id=?').get(r.lastInsertRowid);
}

function deleteDepositTx(id) {
  return db.prepare('DELETE FROM deposit_transactions WHERE id=?').run(id);
}

// ============================================================
// MY DOCUMENTS — รวมเอกสารของลูกบ้าน
// ============================================================
function getMyDocuments(tenantId) {
  const tenant = db.prepare(`SELECT t.*, r.room_code, r.room_number, r.dormitory_id, d.name as dormitory_name
    FROM tenants t JOIN rooms r ON t.room_id=r.id JOIN dormitories d ON r.dormitory_id=d.id
    WHERE t.id=?`).get(tenantId);
  if (!tenant) return null;

  // active contracts
  const contracts = db.prepare(`SELECT id, contract_number, start_date, end_date, monthly_rent, status, signed_at
    FROM contracts WHERE tenant_id=? OR room_id=? ORDER BY created_at DESC`).all(tenantId, tenant.room_id);

  // approved payment receipts
  const receipts = db.prepare(`SELECT p.id, p.amount, p.approved_at, b.billing_month, b.total_amount
    FROM payments p JOIN bills b ON p.bill_id=b.id
    WHERE b.room_id=? AND p.status='approved' ORDER BY p.approved_at DESC LIMIT 24`).all(tenant.room_id);

  // bills history
  const bills = db.prepare(`SELECT id, billing_month, total_amount, status, due_date
    FROM bills WHERE room_id=? ORDER BY billing_month DESC LIMIT 24`).all(tenant.room_id);

  return { tenant, contracts, receipts, bills };
}

module.exports = {
  listMoveOutRequests, createMoveOutRequest, getActiveMoveOutForTenant, updateMoveOutRequest,
  listDepositTxs, depositBalance, createDepositTx, deleteDepositTx,
  getMyDocuments
};
