require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
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
// Middleware
// ============================================================
// LINE webhook needs the raw request body for signature verification.
// Register this before the default JSON parser so it may consume the body first.
app.use('/line/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static files - disable directory redirect/index so /admin stays /admin
// (prevents Vercel proxy from getting redirected outside /RMS prefix)
const staticOpts = { index: false, redirect: false };
if (BASE) {
  app.use(BASE, express.static(path.join(__dirname, 'public'), staticOpts));
  app.use(`${BASE}/uploads`, express.static(path.join(__dirname, 'uploads')));
}
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  store: new FileStore({ path: './data/sessions', retries: 1, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'rms-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

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
// Error handler
// ============================================================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ============================================================
// Daily collection cron — รันทุก 1 ชั่วโมง ตรวจบิลค้างชำระและส่งเตือนตาม policy
// ============================================================
const collectionService = require('./src/services/collectionService');
async function runCollectionCycle() {
  try {
    const r = await collectionService.runAllDormitories();
    if (r.some(x => x.sent > 0)) {
      console.log(`[collection] cycle complete:`, r);
    }
  } catch (e) { console.error('[collection] error:', e.message); }
}
setInterval(runCollectionCycle, 60 * 60 * 1000); // ทุก 1 ชม.
setTimeout(runCollectionCycle, 30 * 1000); // start แรกหลัง server ขึ้น 30 วินาที

// Daily reminder cron — generate calendar events + send today reminders to admins
const operationsService = require('./src/services/operationsService');
async function runDailyReminders() {
  try {
    const dorms = require('./src/db/database').prepare('SELECT id FROM dormitories').all();
    for (const d of dorms) {
      await operationsService.generateUpcomingReminders(d.id);
      await operationsService.sendDailyReminders(d.id);
    }
  } catch (e) { console.error('[reminders] error:', e.message); }
}
setInterval(runDailyReminders, 6 * 60 * 60 * 1000); // ทุก 6 ชม.
setTimeout(runDailyReminders, 60 * 1000);

// ============================================================
// Daily Dashboard Push to Owner (8am + 6pm)
// ============================================================
const broadcastService = require('./src/services/broadcastService');
let lastDashboardSend = { morning: null, evening: null };
async function runDashboardCheck() {
  const now = new Date();
  const hour = now.getHours();
  const today = now.toISOString().slice(0,10);
  let when = null;
  if (hour === 8 && lastDashboardSend.morning !== today) when = 'morning';
  else if (hour === 18 && lastDashboardSend.evening !== today) when = 'evening';
  if (!when) return;
  try {
    const dorms = require('./src/db/database').prepare('SELECT id FROM dormitories').all();
    for (const d of dorms) await broadcastService.sendDailyDashboard(d.id, when);
    lastDashboardSend[when] = today;
    console.log(`[dashboard] ${when} push sent`);
  } catch (e) { console.error('[dashboard] error:', e.message); }
}
setInterval(runDashboardCheck, 5 * 60 * 1000); // ตรวจทุก 5 นาที

app.listen(PORT, () => {
  console.log(`\n🏠 RMS Server running on http://localhost:${PORT}`);
  console.log(`📋 Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`⚙️  Collection cron: every 1 hour`);
  console.log(`\nEnvironment: ${process.env.NODE_ENV || 'development'}\n`);
});
