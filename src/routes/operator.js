const router = require('express').Router();
const db = require('../db/database');
const { requireAdmin, loadAdmin } = require('../middleware/auth');
const operatorService = require('../services/operatorService');
const chargeService = require('../services/chargeService');
const prorationService = require('../services/prorationService');
const operatorPermsService = require('../services/operatorPermsService');
const quickTenantService = require('../services/quickTenantService');
const onboardingService = require('../services/onboardingService');

router.use(loadAdmin);
router.use(requireAdmin);

// ============================================================
// SETUP STATE — guard for operator
// ============================================================
router.get('/setup-state', (req, res) => {
  res.json(chargeService.getSetupState(req.dormitoryId));
});

router.post('/setup-state/complete', (req, res) => {
  chargeService.markSetupCompleted(req.dormitoryId);
  res.json({ success: true });
});

// ============================================================
// CHARGES (deposits + recurring + onetime)
// ============================================================
router.get('/charges', (req, res) => {
  chargeService.ensureDefaultCharges(req.dormitoryId);
  res.json(chargeService.listCharges(req.dormitoryId, req.query));
});

router.post('/charges', (req, res) => {
  res.json(chargeService.createCharge(req.dormitoryId, req.body));
});

router.put('/charges/:id', (req, res) => {
  res.json(chargeService.updateCharge(req.params.id, req.dormitoryId, req.body));
});

router.delete('/charges/:id', (req, res) => {
  chargeService.deleteCharge(req.params.id, req.dormitoryId);
  res.json({ success: true });
});

// ============================================================
// OPERATOR — buildings + rooms + status toggle
// ============================================================
router.get('/operator/buildings', (req, res) => {
  operatorService.autoSyncStatuses(req.dormitoryId);
  res.json({
    buildings: operatorService.getBuildingsSummary(req.dormitoryId),
    status_meta: operatorService.statusMeta()
  });
});

router.get('/operator/rooms', (req, res) => {
  const { building, status, page, per_page } = req.query;
  res.json(operatorService.listRoomsForOperator(req.dormitoryId, {
    building, status,
    page: parseInt(page) || 1,
    perPage: parseInt(per_page) || 10
  }));
});

router.get('/operator/rooms/:id', (req, res) => {
  const r = operatorService.getRoomDetail(req.params.id, req.dormitoryId);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

router.put('/operator/rooms/:id/status', (req, res) => {
  const { status, note } = req.body;
  try {
    res.json(operatorService.setRoomStatus(req.params.id, req.dormitoryId, status, note, req.session.adminId));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Calculate contract end-date (preview)
router.post('/operator/contract-end-calc', (req, res) => {
  const { start_date, months, mode } = req.body;
  if (!start_date || !months) return res.status(400).json({ error: 'missing data' });
  const fn = mode === 'month_end' ? onboardingService.calculateMonthEnd : onboardingService.calculateContractEnd;
  res.json({ end_date: fn(start_date, parseInt(months)) });
});

// Onboard tenant + create contract + deposits + first bill
router.post('/operator/rooms/:id/onboard-tenant', async (req, res) => {
  try {
    const result = await onboardingService.onboardTenant(req.params.id, req.dormitoryId, req.body, req.session.adminId);
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ============================================================
// PRORATION
// ============================================================
router.post('/proration/calculate', (req, res) => {
  const { move_in_date, monthly_rent, due_day } = req.body;
  const dorm = db.prepare('SELECT rent_due_day FROM dormitories WHERE id=?').get(req.dormitoryId);
  res.json(prorationService.calculateFirstMonthRent({
    moveInDate: move_in_date,
    monthlyRent: parseFloat(monthly_rent),
    dueDay: parseInt(due_day) || dorm?.rent_due_day || 5
  }));
});

router.post('/proration/generate-bill/:tenantId', (req, res) => {
  try {
    const { move_in_date } = req.body;
    res.json(prorationService.generateProratedFirstBill(req.params.tenantId, move_in_date));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ============================================================
// LICENSE / QUOTA
// ============================================================
router.get('/license', (req, res) => {
  const dorm = db.prepare('SELECT room_quota, rent_due_day, rent_proration_enabled FROM dormitories WHERE id=?').get(req.dormitoryId);
  const used = db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id=?').get(req.dormitoryId).c;
  res.json({
    quota: dorm.room_quota || 30,
    used,
    available: Math.max(0, (dorm.room_quota || 30) - used),
    rent_due_day: dorm.rent_due_day || 5,
    rent_proration_enabled: !!dorm.rent_proration_enabled,
    quota_options: [10,20,30,40,50,60,100,200,500]
  });
});

router.put('/license', (req, res) => {
  const { room_quota, rent_due_day, rent_proration_enabled } = req.body;
  const set = [], vals = [];
  if (room_quota !== undefined) { set.push('room_quota=?'); vals.push(parseInt(room_quota)); }
  if (rent_due_day !== undefined) { set.push('rent_due_day=?'); vals.push(parseInt(rent_due_day)); }
  if (rent_proration_enabled !== undefined) { set.push('rent_proration_enabled=?'); vals.push(rent_proration_enabled ? 1 : 0); }
  if (set.length) {
    vals.push(req.dormitoryId);
    db.prepare(`UPDATE dormitories SET ${set.join(',')} WHERE id=?`).run(...vals);
  }
  res.json({ success: true });
});

// ============================================================
// OPERATOR PERMISSIONS (per user, per dormitory)
// ============================================================
router.get('/operator-perms/labels', (req, res) => {
  res.json({ keys: operatorPermsService.PERMISSION_KEYS, labels: operatorPermsService.PERMISSION_LABELS });
});

router.get('/operator-perms', (req, res) => {
  res.json(operatorPermsService.listAllForDormitory(req.dormitoryId));
});

router.get('/operator-perms/:adminUserId', (req, res) => {
  res.json(operatorPermsService.getPerms(req.params.adminUserId, req.dormitoryId));
});

// Self-perms (used by Operator UI to show/hide features)
router.get('/operator-perms/me/active', (req, res) => {
  res.json(operatorPermsService.getPerms(req.session.adminId, req.dormitoryId));
});

router.put('/operator-perms/:adminUserId', (req, res) => {
  res.json(operatorPermsService.updatePerms(req.params.adminUserId, req.dormitoryId, req.body));
});

// ============================================================
// QUICK ADD TENANT (เพิ่มผู้เช่าผ่าน Operator)
// ============================================================
router.get('/operator/rooms/:id/quick-add-defaults', (req, res) => {
  const d = quickTenantService.getQuickAddDefaults(req.dormitoryId, req.params.id);
  if (!d) return res.status(404).json({ error: 'ไม่พบห้อง' });
  res.json(d);
});

const { tenantValidator, handleValidation } = require('../middleware/validators');
router.post('/operator/rooms/:id/quick-add-tenant', tenantValidator, handleValidation, (req, res) => {
  try {
    const result = quickTenantService.quickAddTenant(
      req.dormitoryId, req.params.id, req.body, req.session.adminId
    );
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Helper: calculate end date preview
router.post('/operator/calculate-end-date', (req, res) => {
  const { start_date, duration_months, months } = req.body;
  res.json({ end_date: quickTenantService.calculateEndDate(start_date, duration_months || months) });
});

// Aliases for the existing wizard UI
router.post('/operator/contract-end-calc', (req, res) => {
  const { start_date, months } = req.body;
  res.json({ end_date: quickTenantService.calculateEndDate(start_date, months) });
});

router.post('/operator/rooms/:id/onboard-tenant', (req, res) => {
  try {
    // Map onboard wizard's data shape to our quickAddTenant format
    const body = req.body || {};
    const data = {
      tenant_name: body.tenant_name,
      tenant_phone: body.phone,
      tenant_id_card: body.id_card,
      tenant_address: body.address,
      start_date: body.contract_start || body.move_in_date,
      duration_months: body.contract_months || body.months || 12,
      deposits: body.deposits || [],
      notes: body.custom_terms || ''
    };
    const result = quickTenantService.quickAddTenant(req.dormitoryId, req.params.id, data, req.session.adminId);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ============================================================
// แจ้งออก (Move-out Notice)
// ============================================================
router.post('/operator/rooms/:id/move-out-notice', (req, res) => {
  const { move_out_date, note } = req.body;
  if (!move_out_date) return res.status(400).json({ error: 'กรุณาระบุวันที่ย้ายออก' });
  const roomId = parseInt(req.params.id);

  // Get active tenant for this room
  const tenant = db.prepare(`
    SELECT t.id FROM tenants t
    JOIN rooms r ON t.room_id = r.id
    WHERE r.id = ? AND r.dormitory_id = ? AND t.status = 'active'
    LIMIT 1
  `).get(roomId, req.dormitoryId);

  if (!tenant) return res.status(404).json({ error: 'ไม่พบผู้เช่าในห้องนี้' });

  // Insert move-out request (or update if existing)
  const existing = db.prepare(`SELECT id FROM move_out_requests WHERE tenant_id=? AND status='pending'`).get(tenant.id);
  if (existing) {
    db.prepare(`UPDATE move_out_requests SET requested_date=?, reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(move_out_date, note || '', existing.id);
  } else {
    db.prepare(`INSERT INTO move_out_requests (tenant_id, room_id, requested_date, reason, status) VALUES (?,?,?,?,'pending')`)
      .run(tenant.id, roomId, move_out_date, note || '');
  }

  // Update room status to move_out_requested
  db.prepare(`UPDATE rooms SET operational_status = 'move_out_requested' WHERE id = ? AND dormitory_id = ?`)
    .run(roomId, req.dormitoryId);

  // Add calendar event for the move-out date
  try {
    const room = db.prepare('SELECT room_code, room_number FROM rooms WHERE id=?').get(roomId);
    db.prepare(`INSERT INTO calendar_events (dormitory_id, event_date, title, description, event_type, related_room_id) VALUES (?,?,?,?,?,?)`)
      .run(req.dormitoryId, move_out_date, `ย้ายออก ห้อง ${room.room_code||room.room_number}`, note || '', 'move_out', roomId);
  } catch {}

  res.json({ success: true, move_out_date });
});

// ============================================================
// ต่อสัญญา (Contract Renewal)
// ============================================================
router.post('/operator/rooms/:id/renew-contract', (req, res) => {
  const { months, new_rent } = req.body;
  if (!months || months < 1) return res.status(400).json({ error: 'กรุณาระบุจำนวนเดือน' });
  const roomId = parseInt(req.params.id);

  // Get active contract for this room
  const contract = db.prepare(`
    SELECT c.id, c.end_date, c.monthly_rent FROM contracts c
    JOIN tenants t ON c.tenant_id = t.id
    WHERE t.room_id = ? AND c.dormitory_id = ? AND c.status = 'active'
    ORDER BY c.end_date DESC LIMIT 1
  `).get(roomId, req.dormitoryId);

  if (!contract) return res.status(404).json({ error: 'ไม่พบสัญญาที่ Active ในห้องนี้' });

  // Calculate new end date (extend from current end_date)
  const baseDate = contract.end_date || new Date().toISOString().slice(0,10);
  const base = new Date(baseDate);
  base.setMonth(base.getMonth() + parseInt(months));
  const newEndDate = base.toISOString().slice(0,10);

  // Update contract end date (and optionally rent)
  const setClause = new_rent ? 'end_date=?, monthly_rent=?' : 'end_date=?';
  const vals = new_rent ? [newEndDate, parseFloat(new_rent), contract.id] : [newEndDate, contract.id];
  db.prepare(`UPDATE contracts SET ${setClause} WHERE id=?`).run(...vals);

  // If new_rent provided, also update room monthly_rent
  if (new_rent) {
    db.prepare('UPDATE rooms SET monthly_rent=? WHERE id=? AND dormitory_id=?')
      .run(parseFloat(new_rent), roomId, req.dormitoryId);
  }

  // Add calendar reminder for new end date
  try {
    const room = db.prepare('SELECT room_code, room_number FROM rooms WHERE id=?').get(roomId);
    db.prepare(`INSERT INTO calendar_events (dormitory_id, event_date, title, description, event_type, related_room_id) VALUES (?,?,?,?,?,?)`)
      .run(req.dormitoryId, newEndDate, `สัญญาหมด ห้อง ${room.room_code||room.room_number}`, `ต่อสัญญาเพิ่ม ${months} เดือน`, 'contract', roomId);
  } catch {}

  res.json({ success: true, new_end_date: newEndDate, extended_months: months });
});

module.exports = router;
