const router = require('express').Router();
const { requireAdmin, loadAdmin } = require('../middleware/auth');
const db = require('../db/database');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const financialService = require('../services/financialService');
const operationsService = require('../services/operationsService');
const tenantService = require('../services/tenantService');
const miscService = require('../services/miscService');
const contractService = require('../services/contractService');

router.use(loadAdmin);
router.use(requireAdmin);

// ============================================================
// FINANCIAL
// ============================================================
router.get('/finance/transactions', (req, res) => {
  const { from, to, type, category } = req.query;
  res.json(financialService.listTransactions(req.dormitoryId, { from, to, type, category }));
});

router.post('/finance/transactions', (req, res) => {
  res.json(financialService.createTransaction(req.dormitoryId, req.body, req.session.adminId));
});

router.put('/finance/transactions/:id', (req, res) => {
  res.json(financialService.updateTransaction(req.params.id, req.dormitoryId, req.body));
});

router.delete('/finance/transactions/:id', (req, res) => {
  financialService.deleteTransaction(req.params.id, req.dormitoryId);
  res.json({ success: true });
});

router.get('/finance/categories', (req, res) => {
  res.json({ income: financialService.INCOME_CATEGORIES, expense: financialService.EXPENSE_CATEGORIES });
});

router.get('/finance/analytics', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  res.json(financialService.analytics(req.dormitoryId, year));
});

router.get('/finance/tax-report', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  res.json(financialService.taxReport(req.dormitoryId, year));
});

router.get('/finance/owner-statement', (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  res.json(financialService.ownerStatement(req.dormitoryId, year, month));
});

// Bank reconciliation
router.get('/finance/bank-statements', (req, res) => {
  res.json(financialService.listBankStatements(req.dormitoryId, req.query));
});

router.post('/finance/bank-statements', (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows ต้องเป็น array' });
  res.json(financialService.importBankStatement(req.dormitoryId, rows));
});

router.post('/finance/bank-statements/auto-match', (req, res) => {
  res.json(financialService.autoMatchBankStatements(req.dormitoryId));
});

router.post('/finance/bank-statements/:id/match/:paymentId', (req, res) => {
  financialService.matchBankStatement(req.params.id, req.params.paymentId);
  res.json({ success: true });
});

// ============================================================
// INSPECTIONS
// ============================================================
const inspectionDir = path.join(__dirname, '../../uploads/inspections');
if (!fs.existsSync(inspectionDir)) fs.mkdirSync(inspectionDir, { recursive: true });
const inspectionUpload = multer({ dest: inspectionDir });

router.get('/inspections', (req, res) => {
  res.json(operationsService.listInspections(req.dormitoryId, req.query));
});

router.get('/inspections/:id', (req, res) => {
  const i = operationsService.getInspection(req.params.id, req.dormitoryId);
  if (!i) return res.status(404).json({ error: 'Not found' });
  res.json(i);
});

router.post('/inspections', (req, res) => {
  res.json(operationsService.createInspection(req.dormitoryId, req.body, req.session.adminId));
});

router.put('/inspections/:id', (req, res) => {
  res.json(operationsService.updateInspection(req.params.id, req.dormitoryId, req.body));
});

router.delete('/inspections/:id', (req, res) => {
  operationsService.deleteInspection(req.params.id, req.dormitoryId);
  res.json({ success: true });
});

router.post('/inspections/:id/photos', inspectionUpload.single('photo'), (req, res) => {
  const i = operationsService.getInspection(req.params.id, req.dormitoryId);
  if (!i) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const newPath = `uploads/inspections/${req.file.filename}.jpg`;
  fs.renameSync(req.file.path, path.join(__dirname, '../..', newPath));
  db.prepare('INSERT INTO inspection_photos (inspection_id, photo_path, caption) VALUES (?,?,?)')
    .run(req.params.id, newPath, req.body.caption || '');
  res.json({ success: true, photo_path: newPath });
});

// ============================================================
// ASSETS
// ============================================================
router.get('/assets', (req, res) => {
  if (req.query.room_id) res.json(operationsService.listAssets(req.query.room_id));
  else res.json(operationsService.listAllAssets(req.dormitoryId));
});

router.post('/assets', (req, res) => {
  res.json(operationsService.createAsset(req.body.room_id, req.body));
});

router.put('/assets/:id', (req, res) => {
  res.json(operationsService.updateAsset(req.params.id, req.body));
});

router.delete('/assets/:id', (req, res) => {
  operationsService.deleteAsset(req.params.id);
  res.json({ success: true });
});

// ============================================================
// VENDORS
// ============================================================
router.get('/vendors', (req, res) => res.json(operationsService.listVendors(req.dormitoryId)));
router.post('/vendors', (req, res) => res.json(operationsService.createVendor(req.dormitoryId, req.body)));
router.put('/vendors/:id', (req, res) => res.json(operationsService.updateVendor(req.params.id, req.dormitoryId, req.body)));
router.delete('/vendors/:id', (req, res) => { operationsService.deleteVendor(req.params.id, req.dormitoryId); res.json({ success: true }); });
router.get('/vendors/:id/jobs', (req, res) => res.json(operationsService.listVendorJobs(req.params.id)));
router.post('/vendors/:id/jobs', (req, res) => res.json(operationsService.createVendorJob(req.params.id, req.body)));

// ============================================================
// CALENDAR
// ============================================================
router.get('/calendar/events', (req, res) => res.json(operationsService.listCalendarEvents(req.dormitoryId, req.query)));
router.post('/calendar/events', (req, res) => res.json(operationsService.createEvent(req.dormitoryId, req.body)));
router.put('/calendar/events/:id', (req, res) => { operationsService.updateEvent(req.params.id, req.dormitoryId, req.body); res.json({ success: true }); });
router.delete('/calendar/events/:id', (req, res) => { operationsService.deleteEvent(req.params.id, req.dormitoryId); res.json({ success: true }); });
router.post('/calendar/generate-reminders', async (req, res) => {
  res.json(await operationsService.generateUpcomingReminders(req.dormitoryId));
});

// ============================================================
// REMINDERS
// ============================================================
router.get('/reminders/settings', (req, res) => res.json(operationsService.getReminderSettings(req.dormitoryId)));
router.put('/reminders/settings', (req, res) => res.json(operationsService.updateReminderSettings(req.dormitoryId, req.body)));

// ============================================================
// MOVE-OUT (admin side)
// ============================================================
router.get('/move-out', (req, res) => res.json(tenantService.listMoveOutRequests(req.dormitoryId, req.query)));
router.put('/move-out/:id', (req, res) => res.json(tenantService.updateMoveOutRequest(req.params.id, req.dormitoryId, req.body)));

// ============================================================
// DEPOSIT (admin manage)
// ============================================================
router.get('/tenants/:tenantId/deposit', (req, res) => {
  res.json({
    balance: tenantService.depositBalance(req.params.tenantId),
    transactions: tenantService.listDepositTxs(req.params.tenantId)
  });
});

router.post('/tenants/:tenantId/deposit', (req, res) => {
  res.json(tenantService.createDepositTx(req.params.tenantId, req.body, req.session.adminId));
});

router.delete('/deposit-tx/:id', (req, res) => {
  tenantService.deleteDepositTx(req.params.id);
  res.json({ success: true });
});

// ============================================================
// BLACKLIST
// ============================================================
router.get('/blacklist', (req, res) => res.json(miscService.listBlacklist(req.dormitoryId)));
router.post('/blacklist', (req, res) => res.json(miscService.addBlacklist(req.dormitoryId, req.body, req.session.adminId)));
router.delete('/blacklist/:id', (req, res) => { miscService.removeBlacklist(req.params.id, req.dormitoryId); res.json({ success: true }); });
router.post('/blacklist/check', (req, res) => res.json({ match: miscService.checkBlacklist(req.body.id_card, req.body.phone) }));

// ============================================================
// MULTI-PROPERTY
// ============================================================
router.get('/properties', (req, res) => res.json(miscService.listAccessibleDormitories(req.session.adminId)));

router.post('/properties', (req, res) => {
  res.json(miscService.createDormitory(req.session.adminId, req.body));
});

router.post('/properties/:id/switch', (req, res) => {
  if (!miscService.hasAccess(req.session.adminId, req.params.id))
    return res.status(403).json({ error: 'No access' });
  miscService.setDefaultDormitory(req.session.adminId, parseInt(req.params.id));
  // Update admin_users.dormitory_id (the active one)
  db.prepare('UPDATE admin_users SET dormitory_id=? WHERE id=?').run(req.params.id, req.session.adminId);
  res.json({ success: true });
});

// ============================================================
// E-SIGNATURE (admin generate token)
// ============================================================
router.post('/contracts/:id/sign-token/:type', (req, res) => {
  const c = db.prepare('SELECT id FROM contracts WHERE id=? AND dormitory_id=?').get(req.params.id, req.dormitoryId);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const type = req.params.type;
  if (!['tenant','landlord'].includes(type)) return res.status(400).json({ error: 'Invalid signer type' });
  res.json(miscService.createSignToken(req.params.id, type));
});

router.get('/contracts/:id/signatures', (req, res) => {
  res.json(miscService.getSignatures(req.params.id));
});

// ============================================================
// RICH MENU
// ============================================================
const richMenuService = require('../services/richMenuService');
const broadcastService = require('../services/broadcastService');

const richMenuDir = path.join(__dirname, '../../public/richmenu');
if (!fs.existsSync(richMenuDir)) fs.mkdirSync(richMenuDir, { recursive: true });
const richMenuUpload = multer({ dest: richMenuDir, limits: { fileSize: 1024*1024 } });

router.get('/richmenu/list', async (req, res) => {
  try { res.json(await richMenuService.listRichMenus(req.dormitoryId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/richmenu/status', (req, res) => {
  const dorm = require('../db/database').prepare('SELECT rich_menu_tenant_id, rich_menu_owner_id, line_channel_access_token FROM dormitories WHERE id=?').get(req.dormitoryId);
  res.json({
    has_token: !!dorm?.line_channel_access_token,
    tenant_menu_id: dorm?.rich_menu_tenant_id || null,
    owner_menu_id: dorm?.rich_menu_owner_id || null,
    has_tenant_image: fs.existsSync(path.join(richMenuDir, 'tenant.png')),
    has_owner_image: fs.existsSync(path.join(richMenuDir, 'owner.png'))
  });
});

router.post('/richmenu/upload-image/:type', richMenuUpload.single('image'), (req, res) => {
  if (!['tenant','owner'].includes(req.params.type)) return res.status(400).json({ error: 'invalid type' });
  if (!req.file) return res.status(400).json({ error: 'no image' });
  const dest = path.join(richMenuDir, `${req.params.type}.png`);
  fs.renameSync(req.file.path, dest);
  res.json({ success: true, path: `/richmenu/${req.params.type}.png` });
});

router.post('/richmenu/setup', async (req, res) => {
  try {
    const result = await richMenuService.setupRichMenusForDormitory(req.dormitoryId);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/richmenu/:id', async (req, res) => {
  try { await richMenuService.deleteRichMenu(req.dormitoryId, req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// BROADCAST
// ============================================================
router.post('/broadcast/send', async (req, res) => {
  const { title, body, building, floor, format } = req.body;
  try {
    const filter = {};
    if (building) filter.building = building;
    if (floor) filter.floor = parseInt(floor);
    const r = format === 'flex'
      ? await broadcastService.sendAnnouncementFlex(req.dormitoryId, filter, title || 'ประกาศ', body)
      : await broadcastService.sendAnnouncement(req.dormitoryId, filter, title || 'ประกาศ', body);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/broadcast/dashboard-now', async (req, res) => {
  try {
    const r = await broadcastService.sendDailyDashboard(req.dormitoryId, 'manual');
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/broadcast/preview-recipients', (req, res) => {
  const { building, floor } = req.query;
  const filter = {};
  if (building) filter.building = building;
  if (floor) filter.floor = parseInt(floor);
  const recipients = broadcastService.selectTenants(req.dormitoryId, filter);
  res.json({ count: recipients.length, recipients: recipients.map(t => ({ room: t.room_code, name: t.display_name })) });
});

module.exports = router;
