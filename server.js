require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// BASE_PATH: set to '/RMS' when hosting at cyn-jewelry.com/RMS
// Leave empty (default) for root hosting
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, ''); // e.g. '/RMS' or ''

// ============================================================
// Helper: serve HTML with injected base-path fetch interceptor
// When BASE is set, all absolute fetch('/api/...') calls in the
// frontend are transparently rewritten to fetch('/RMS/api/...')
// so nginx can proxy them correctly.
// ============================================================
function serveHtml(htmlPath) {
  return (req, res) => {
    try {
      let html = fs.readFileSync(htmlPath, 'utf8');
      if (BASE) {
        const script = `<script>` +
          `(function(){` +
          `var B="${BASE}";` +
          `window.__RMS_BASE__=B;` +
          `function fix(u){return (typeof u==='string'&&u.charAt(0)==='/'&&u.charAt(1)!=='/'&&u.indexOf(B+'/')!==0&&u!==B)?B+u:u;}` +
          // Intercept fetch
          `var _f=window.fetch;` +
          `window.fetch=function(u,o){return _f.call(this,fix(u),o);};` +
          // Intercept XMLHttpRequest
          `var _x=XMLHttpRequest.prototype.open;` +
          `XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fix(u);return _x.apply(this,arguments);};` +
          // Rewrite <a href> and <img src> on click/load (and dynamic content)
          `function walk(root){` +
            `(root||document).querySelectorAll('a[href^="/"],img[src^="/"],form[action^="/"]').forEach(function(el){` +
              `['href','src','action'].forEach(function(at){` +
                `var v=el.getAttribute(at);` +
                `if(v&&v.charAt(0)==='/'&&v.charAt(1)!=='/'&&v.indexOf(B+'/')!==0&&v!==B)el.setAttribute(at,B+v);` +
              `});` +
            `});` +
          `}` +
          `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){walk();});` +
          `else walk();` +
          // Watch for dynamically-added DOM (admin uses innerHTML a lot)
          `try{new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes&&m.addedNodes.forEach(function(n){if(n.nodeType===1)walk(n);});});}).observe(document.documentElement||document,{childList:true,subtree:true});}catch(e){}` +
          `})();` +
          `</script>`;
        // Inject right before </head>
        if (html.includes('</head>')) {
          html = html.replace('</head>', script + '</head>');
        } else {
          html = script + html;
        }
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) {
      res.sendFile(htmlPath);
    }
  };
}

// ตรวจสอบ uploads folder
['uploads/slips', 'uploads/maintenance', 'data'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// ============================================================
// Custom SQLite session store (replaces session-file-store)
// Uses the same better-sqlite3 DB — survives across restarts
// ============================================================
const db = require('./src/db/database');

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    // Clean up expired sessions every 15 minutes
    setInterval(() => {
      try { this.db.prepare('DELETE FROM sessions WHERE expired_at < ?').run(Date.now()); }
      catch (_) {}
    }, 15 * 60 * 1000);
  }
  get(sid, cb) {
    try {
      const row = this.db.prepare(
        'SELECT sess FROM sessions WHERE sid=? AND expired_at > ?'
      ).get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const ttl = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.db.prepare(
        'INSERT OR REPLACE INTO sessions(sid, sess, expired_at) VALUES(?,?,?)'
      ).run(sid, JSON.stringify(sess), ttl);
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb(null); }
    catch (e) { cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

// ============================================================
// Security: trust Vercel proxy for HTTPS detection
// ============================================================
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Helmet — security headers (CSP disabled to avoid breaking inline scripts)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ============================================================
// Rate limiters
// ============================================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 120,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
// Middleware
// ============================================================
// LINE webhook needs the raw request body for signature verification.
// Register this before the default JSON parser so it may consume the body first.
app.use('/line/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

// Apply rate limiters
app.use('/auth/login', authLimiter);
app.use('/auth/line/verify', authLimiter);
app.use('/join', joinLimiter);
if (BASE) {
  app.use(`${BASE}/auth/login`, authLimiter);
  app.use(`${BASE}/auth/line/verify`, authLimiter);
  app.use(`${BASE}/join`, joinLimiter);
}
app.use('/api', apiLimiter);
if (BASE) app.use(`${BASE}/api`, apiLimiter);

// Serve static files - disable directory redirect/index so /admin stays /admin
// (prevents Vercel proxy from getting redirected outside /RMS prefix)
const staticOpts = { index: false, redirect: false };
if (BASE) {
  app.use(BASE, express.static(path.join(__dirname, 'public'), staticOpts));
  app.use(`${BASE}/uploads`, express.static(path.join(__dirname, 'uploads')));
}
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  store: new SQLiteSessionStore(db),
  secret: process.env.SESSION_SECRET || 'rms-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'rms.sid',
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: isProd,   // HTTPS-only in production (Vercel sets x-forwarded-proto)
    sameSite: 'lax',
  },
}));

// ============================================================
// Health check (for UptimeRobot / Render readiness probe)
// ============================================================
function healthHandler(req, res) {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), env: process.env.NODE_ENV || 'development' });
  } catch (e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
}
app.get('/health', healthHandler);
if (BASE) app.get(`${BASE}/health`, healthHandler);

// ============================================================
// Demo info page — แสดง credential + สถิติ สำหรับทดสอบระบบ
// ============================================================
function demoInfoHandler(req, res) {
  try {
    const dorm = db.prepare('SELECT * FROM dormitories LIMIT 1').get();
    const stats = dorm ? {
      rooms:    db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id=?').get(dorm.id).c,
      tenants:  db.prepare('SELECT COUNT(*) as c FROM tenants t JOIN rooms r ON t.room_id=r.id WHERE r.dormitory_id=?').get(dorm.id).c,
      bills:    db.prepare('SELECT COUNT(*) as c FROM bills b JOIN rooms r ON b.room_id=r.id WHERE r.dormitory_id=?').get(dorm.id).c,
      paid:     db.prepare("SELECT COUNT(*) as c FROM bills b JOIN rooms r ON b.room_id=r.id WHERE r.dormitory_id=? AND b.status='paid'").get(dorm.id).c,
      pending:  db.prepare("SELECT COUNT(*) as c FROM bills b JOIN rooms r ON b.room_id=r.id WHERE r.dormitory_id=? AND b.status='pending'").get(dorm.id).c,
      overdue:  db.prepare("SELECT COUNT(*) as c FROM bills b JOIN rooms r ON b.room_id=r.id WHERE r.dormitory_id=? AND b.status='overdue'").get(dorm.id).c,
    } : {};
    const baseUrl = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RMS Demo Info</title>
<style>
  body{font-family:'Sarabun',sans-serif;background:#f0fdf4;margin:0;padding:20px;color:#1a1a1a}
  .card{background:#fff;border-radius:16px;padding:28px;max-width:520px;margin:20px auto;box-shadow:0 4px 20px rgba(0,0,0,.08)}
  h1{color:#06C755;margin:0 0 4px;font-size:1.6rem}
  .sub{color:#888;margin:0 0 24px;font-size:.9rem}
  .badge{background:#06C755;color:#fff;padding:4px 12px;border-radius:20px;font-size:.8rem;font-weight:bold}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  td{padding:10px 12px;border-bottom:1px solid #f0f0f0}
  td:first-child{color:#555;font-size:.9rem}
  td:last-child{font-weight:600;text-align:right}
  .btn{display:block;background:#06C755;color:#fff;text-align:center;padding:14px;border-radius:10px;text-decoration:none;font-size:1.1rem;font-weight:bold;margin:8px 0}
  .btn.outline{background:#fff;color:#06C755;border:2px solid #06C755}
  .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
  .stat{text-align:center;background:#f0fdf4;border-radius:10px;padding:12px 8px}
  .stat-num{font-size:1.8rem;font-weight:bold;color:#06C755}
  .stat-label{font-size:.75rem;color:#666}
  .warn{background:#fff7ed;border-left:4px solid #f97316;padding:12px 16px;border-radius:8px;font-size:.85rem;color:#9a3412;margin-top:16px}
</style>
</head><body>
<div class="card">
  <h1>🏠 RMS Demo</h1>
  <p class="sub">${dorm?.name || 'หอพักสุขใจ (Demo)'} &nbsp;<span class="badge">DEMO</span></p>

  <div class="stat-grid">
    <div class="stat"><div class="stat-num">${stats.rooms||0}</div><div class="stat-label">ห้องทั้งหมด</div></div>
    <div class="stat"><div class="stat-num">${stats.tenants||0}</div><div class="stat-label">ผู้เช่า</div></div>
    <div class="stat"><div class="stat-num">${stats.bills||0}</div><div class="stat-label">บิลรวม</div></div>
  </div>

  <table>
    <tr><td>🔑 Admin URL</td><td><a href="${baseUrl}/admin">${baseUrl}/admin</a></td></tr>
    <tr><td>📧 Email</td><td>${process.env.ADMIN_EMAIL || 'admin@rms-demo.com'}</td></tr>
    <tr><td>🔐 Password</td><td>${process.env.ADMIN_PASSWORD || 'demo1234'}</td></tr>
    <tr><td>✅ บิลชำระแล้ว</td><td style="color:#16a34a">${stats.paid||0} ใบ</td></tr>
    <tr><td>🟡 รอชำระ</td><td style="color:#ca8a04">${stats.pending||0} ใบ</td></tr>
    <tr><td>🔴 เกินกำหนด</td><td style="color:#dc2626">${stats.overdue||0} ใบ</td></tr>
  </table>

  <a href="${baseUrl}/admin" class="btn">เข้า Admin Panel →</a>

  <div class="warn">
    ⚠️ Demo นี้รันบน Render Free Tier<br>
    ข้อมูลอาจ reset เมื่อ server restart<br>
    Uptime: ${Math.floor(process.uptime()/60)} นาที
  </div>
</div>
</body></html>`);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
}
app.get('/demo-info', demoInfoHandler);
if (BASE) app.get(`${BASE}/demo-info`, demoInfoHandler);

// ============================================================
// Routes
// ============================================================
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/admin', require('./src/routes/adminExt'));
app.use('/api/admin', require('./src/routes/adminUsers'));
app.use('/api/admin', require('./src/routes/operator'));
app.use('/api/tenant', require('./src/routes/tenant'));
app.use('/line', require('./src/routes/line'));
app.use('/auth', require('./src/routes/auth'));
app.use('/sign', require('./src/routes/sign'));
app.use('/share', require('./src/routes/tenantShare'));

// ============================================================
// SPA Fallbacks — serve HTML for browser navigation
// When BASE is set, also register routes under the BASE prefix
// ============================================================
const _adminHtml    = serveHtml(path.join(__dirname, 'public/admin/index.html'));
const _setupHtml    = serveHtml(path.join(__dirname, 'public/admin/setup.html'));
const _operatorHtml = serveHtml(path.join(__dirname, 'public/operator/index.html'));
const _liffHtml     = serveHtml(path.join(__dirname, 'public/liff/index.html'));
const _joinHtml     = serveHtml(path.join(__dirname, 'public/liff/join.html'));
const _adminLinkHtml= serveHtml(path.join(__dirname, 'public/liff/admin-link.html'));
const _signHtml     = serveHtml(path.join(__dirname, 'public/liff/sign.html'));
const _shareHtml    = serveHtml(path.join(__dirname, 'public/share/index.html'));

// Helper: register a route at both plain path and BASE+path
function r(path_, handler) {
  app.get(path_, handler);
  if (BASE) app.get(BASE + path_, handler);
}

r('/admin/setup',    _setupHtml);
r('/admin',          _adminHtml);
r('/admin/*',        _adminHtml);
r('/operator',       _operatorHtml);
r('/operator/*',     _operatorHtml);
r('/liff/*',         _liffHtml);
r('/join/:token',    _joinHtml);
r('/admin-link/:token', _adminLinkHtml);
r('/sign/:token',    _signHtml);
r('/tenant/:token',  _shareHtml);

app.get('/', (req, res) => res.redirect((BASE || '') + '/admin'));
if (BASE) {
  app.get(BASE + '/', (req, res) => res.redirect(BASE + '/admin'));
  app.get(BASE,       (req, res) => res.redirect(BASE + '/admin'));
}

// ============================================================
// Error handler (Express)
// ============================================================
app.use((err, req, res, next) => {
  console.error('[Express Error]', err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ============================================================
// Global unhandled error safety net (CHAOS-007 fix)
// ป้องกัน unhandled rejection / exception crash
// ============================================================
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
  // ไม่ exit — log แล้วทำงานต่อ (ดีกว่า crash บน Render free tier)
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.stack || err);
  // graceful shutdown — ให้ Render restart
  try { server.close(); } catch (_) {}
  setTimeout(() => process.exit(1), 3000);
});

// ============================================================
// Cron jobs — ทุก job มี overlap guard + timeout (CHAOS-004 fix)
// ============================================================
const collectionService = require('./src/services/collectionService');
const operationsService = require('./src/services/operationsService');
const broadcastService = require('./src/services/broadcastService');

// Helper: สร้าง guarded cron runner
// - ป้องกัน overlap (ถ้ายังรันอยู่ → ข้าม)
// - timeout: ถ้ารันนานเกิน maxMs → log warning แต่ไม่ kill (async ยังรันอยู่)
function makeCron(name, fn, maxMs) {
  let running = false;
  return async function () {
    if (running) { console.warn(`[${name}] skipped — previous run still active`); return; }
    running = true;
    const timer = setTimeout(
      () => console.warn(`[${name}] WARNING: running longer than ${maxMs / 60000}m`),
      maxMs
    );
    try { await fn(); }
    catch (e) { console.error(`[${name}] error:`, e.message); }
    finally { running = false; clearTimeout(timer); }
  };
}

const runCollectionCycle = makeCron('collection', async () => {
  const r = await collectionService.runAllDormitories();
  if (r.some(x => x.sent > 0)) console.log('[collection] cycle complete:', r);
}, 50 * 60 * 1000); // warn ถ้านานกว่า 50 นาที

const runDailyReminders = makeCron('reminders', async () => {
  const dorms = db.prepare('SELECT id FROM dormitories').all();
  for (const d of dorms) {
    await operationsService.generateUpcomingReminders(d.id);
    await operationsService.sendDailyReminders(d.id);
  }
}, 5 * 60 * 1000); // warn ถ้านานกว่า 5 นาที

let lastDashboardSend = { morning: null, evening: null };
const runDashboardCheck = makeCron('dashboard', async () => {
  const now = new Date();
  const hour = now.getHours();
  const today = now.toISOString().slice(0, 10);
  let when = null;
  if (hour === 8  && lastDashboardSend.morning !== today) when = 'morning';
  else if (hour === 18 && lastDashboardSend.evening !== today) when = 'evening';
  if (!when) return;
  const dorms = db.prepare('SELECT id FROM dormitories').all();
  for (const d of dorms) await broadcastService.sendDailyDashboard(d.id, when);
  lastDashboardSend[when] = today;
  console.log(`[dashboard] ${when} push sent`);
}, 2 * 60 * 1000);

setInterval(runCollectionCycle, 60 * 60 * 1000);  // ทุก 1 ชม.
setTimeout(runCollectionCycle, 30 * 1000);          // รอบแรก 30s หลัง start
setInterval(runDailyReminders, 6 * 60 * 60 * 1000); // ทุก 6 ชม.
setTimeout(runDailyReminders, 60 * 1000);
setInterval(runDashboardCheck, 5 * 60 * 1000);      // ตรวจทุก 5 นาที

const server = app.listen(PORT, () => {
  console.log(`\n🏠 RMS Server running on http://localhost:${PORT}`);
  console.log(`📋 Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`⚙️  Collection cron: every 1 hour`);
  console.log(`\nEnvironment: ${process.env.NODE_ENV || 'development'}\n`);
});
