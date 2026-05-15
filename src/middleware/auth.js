// ============================================================
// AUTH MIDDLEWARE
// ============================================================
// Note: BASE_PATH must be respected — when deployed at /RMS,
// redirects without it land outside the Vercel rewrite → 404.
// ============================================================
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');

// ตรวจสอบว่า admin login แล้วหรือยัง
// Note: when used inside a Router mounted at /api/admin, req.path is the
// path WITHIN that router (e.g. "/dormitory"). The full path is
// req.originalUrl. We use originalUrl + accepts() so API clients get JSON
// 401 while browser navigations get a redirect.
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  const loginPath = BASE + '/admin';
  const isApiCall =
    req.originalUrl.includes('/api/') ||
    req.xhr ||
    req.get('accept')?.includes('application/json') ||
    req.get('content-type')?.includes('application/json');

  if (isApiCall) {
    return res.status(401).json({
      error: 'Not authenticated',
      code: 'AUTH_REQUIRED',
      redirect: loginPath,
    });
  }
  res.redirect(loginPath);
}

// แนบข้อมูล admin เข้า req.admin
function loadAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    const db = require('../db/database');
    const admin = db.prepare(`
      SELECT a.*, d.name as dormitory_name, d.id as dormitory_id
      FROM admin_users a
      JOIN dormitories d ON a.dormitory_id = d.id
      WHERE a.id = ?
    `).get(req.session.adminId);
    req.admin = admin;
    req.dormitoryId = admin?.dormitory_id;
  }
  next();
}

module.exports = { requireAdmin, loadAdmin };
