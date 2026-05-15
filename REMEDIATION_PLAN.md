# RMS PLATFORM - REMEDIATION ACTION PLAN
## Critical Fixes Required for Production Deployment

**Priority Level:** IMMEDIATE  
**Estimated Effort:** 4-6 weeks with full team  
**Risk of Not Fixing:** Complete platform failure, data breach, business shutdown

---

## PHASE 1: CRITICAL SECURITY FIXES (Week 1-2)

### FIX #1: Implement Secure Session Management (Redis)

**Issue:** File-based sessions in plaintext, not scalable, insecure  
**Impact:** Session hijacking, insecure for multi-instance deployment  

**Implementation:**

1. **Install dependencies:**
```bash
npm install redis connect-redis cookie-parser
```

2. **Update server.js:**
```javascript
// BEFORE (INSECURE)
const FileStore = require('session-file-store')(session);
app.use(session({
  store: new FileStore({ path: './data/sessions' }),
  secret: process.env.SESSION_SECRET || 'rms-secret-change-in-production',
  // ...
}));

// AFTER (SECURE)
const redis = require('redis');
const RedisStore = require('connect-redis').default;
const cookieParser = require('cookie-parser');

// Create Redis client
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  retry_strategy: (options) => {
    if (options.total_retry_time > 1000 * 60 * 60) return new Error('Redis: Retry time exhausted');
    if (options.attempt > 10) return undefined;
    return Math.min(options.attempt * 100, 3000);
  }
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
  process.exit(1);
});

redisClient.on('connect', () => {
  console.log('Redis connected');
});

app.use(cookieParser());
app.use(session({
  store: new RedisStore({ client: redisClient, prefix: 'rms-sess:' }),
  secret: process.env.SESSION_SECRET, // MUST be set in .env!
  name: 'rms_session_id', // Custom cookie name (obfuscation)
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, // Prevent JavaScript access
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict', // Prevent CSRF
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/'
  }
}));

// Validate SESSION_SECRET on startup
if (!process.env.SESSION_SECRET) {
  console.error('FATAL ERROR: SESSION_SECRET environment variable not set!');
  console.error('Set a random 32+ character string in your .env file');
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('FATAL ERROR: SESSION_SECRET must be at least 32 characters!');
  process.exit(1);
}
```

3. **Update .env.example:**
```bash
# ===== SECURITY =====
SESSION_SECRET=your-random-32-char-secure-string-here-min-length-32-chars
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
COOKIE_DOMAIN=.yourdomain.com

# Force HTTPS in production
NODE_ENV=production
SECURE_COOKIES=true
```

4. **Add validation script (.env.setup.js):**
```javascript
const fs = require('fs');
const crypto = require('crypto');

// Check if .env exists
if (!fs.existsSync('.env')) {
  console.error('ERROR: .env file not found!');
  process.exit(1);
}

// Load and validate
require('dotenv').config();

const REQUIRED_VARS = {
  'SESSION_SECRET': (v) => v && v.length >= 32,
  'REDIS_HOST': (v) => v && v.length > 0,
  'LINE_CHANNEL_ID': (v) => v && v.length > 0,
  'LINE_CHANNEL_SECRET': (v) => v && v.length > 0,
  'LINE_CHANNEL_ACCESS_TOKEN': (v) => v && v.length > 0,
  'GEMINI_API_KEY': (v) => v && v.length > 0
};

let valid = true;
for (const [key, validator] of Object.entries(REQUIRED_VARS)) {
  if (!validator(process.env[key])) {
    console.error(`❌ Missing or invalid: ${key}`);
    valid = false;
  }
}

if (!valid) {
  console.error('\n❌ Environment configuration is invalid!');
  process.exit(1);
}

console.log('✅ Environment configuration validated');
```

5. **Call validation on startup (server.js):**
```javascript
require('./env.setup'); // Validates BEFORE creating server
```

---

### FIX #2: Implement Rate Limiting on All Endpoints

**Issue:** No rate limiting, enables DDoS, brute force, API abuse  
**Impact:** Service disruption, credential compromise, resource exhaustion  

**Implementation:**

1. **Install dependencies:**
```bash
npm install express-rate-limit redis-rate-limit-flexible
```

2. **Create rate-limit middleware (src/middleware/rateLimiter.js):**
```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

// Different limits for different endpoints
const loginLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rms-rl:login:'
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP
  message: 'Too many login attempts. Please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.session?.adminId, // Skip if already authenticated
  keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip
});

const apiLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rms-rl:api:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // For authenticated users, use user ID; for anonymous, use IP
    return req.session?.adminId || (req.headers['x-forwarded-for'] || req.ip);
  }
});

const fileUploadLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rms-rl:upload:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 uploads per minute
  message: 'Too many uploads. Please try again later.',
  keyGenerator: (req) => req.session?.lineUserId || req.ip
});

const slipUploadLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rms-rl:slip:'
  }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 20, // 20 slip uploads per day per tenant
  message: 'Daily slip upload limit exceeded. Please try again tomorrow.'
});

module.exports = {
  loginLimiter,
  apiLimiter,
  fileUploadLimiter,
  slipUploadLimiter
};
```

3. **Apply to routes (server.js):**
```javascript
const { loginLimiter, apiLimiter, fileUploadLimiter, slipUploadLimiter } = require('./src/middleware/rateLimiter');

// Apply rate limiting
app.post('/api/auth/login', loginLimiter, authRoutes);
app.use('/api/', apiLimiter);

// Specific endpoints
app.post('/api/tenant/payment', slipUploadLimiter, tenantRoutes);
```

---

### FIX #3: Implement Comprehensive Input Validation

**Issue:** No input validation enables SQL injection, XSS, malware  
**Impact:** Data breach, system compromise, malware distribution  

**Implementation:**

1. **Install express-validator:**
```bash
npm install express-validator
```

2. **Create validation middleware (src/middleware/validators.js):**
```javascript
const { body, param, query, validationResult } = require('express-validator');

// Validation chains
const roomValidators = {
  create: [
    body('room_number').trim()
      .notEmpty().withMessage('Room number required')
      .isLength({ min: 1, max: 20 }).withMessage('Invalid room number length')
      .matches(/^[A-Z0-9\-]+$/i).withMessage('Only alphanumeric and hyphens allowed'),
    
    body('monthly_rent').isFloat({ min: 0, max: 999999 })
      .withMessage('Rent must be between 0 and 999,999'),
    
    body('building').optional().trim()
      .matches(/^[A-Z]$/).withMessage('Building must be single letter A-Z'),
    
    body('floor').optional().isInt({ min: 1, max: 50 })
      .withMessage('Floor must be between 1 and 50'),
    
    body('notes').optional().trim()
      .isLength({ max: 500 }).withMessage('Notes too long (max 500 chars)')
      .escape() // Escape HTML/special chars
  ],

  update: [
    param('roomId').isInt().withMessage('Invalid room ID'),
    body('monthly_rent').optional()
      .isFloat({ min: 0, max: 999999 }).withMessage('Invalid rent'),
    body('notes').optional().trim().escape()
  ]
};

const billingValidators = {
  create: [
    body('room_id').isInt().withMessage('Invalid room ID'),
    
    body('billing_month').matches(/^\d{4}-\d{2}$/)
      .withMessage('Month must be YYYY-MM format'),
    
    body('water_meter_curr').isInt({ min: 0, max: 999999 })
      .withMessage('Invalid water meter reading'),
    
    body('electric_meter_curr').isInt({ min: 0, max: 999999 })
      .withMessage('Invalid electric meter reading')
  ]
};

const paymentValidators = {
  submit: [
    body('bill_id').isInt().withMessage('Invalid bill ID'),
    
    body('amount').isFloat({ min: 1, max: 999999 })
      .withMessage('Invalid payment amount'),
    
    body('method').isIn(['transfer', 'cash', 'check'])
      .withMessage('Invalid payment method')
  ]
};

// Middleware to handle validation errors
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({
        field: e.param,
        message: e.msg
      }))
    });
  }
  next();
}

module.exports = {
  roomValidators,
  billingValidators,
  paymentValidators,
  handleValidationErrors
};
```

3. **Apply to admin.js:**
```javascript
const { roomValidators, billingValidators, handleValidationErrors } = require('../middleware/validators');

// Before
router.post('/admin/rooms/create', (req, res) => {
  const { room_number, monthly_rent } = req.body;
  // No validation!
});

// After
router.post('/admin/rooms/create',
  roomValidators.create,
  handleValidationErrors,
  (req, res) => {
    const { room_number, monthly_rent, building, floor, notes } = req.body;
    // Now fully validated
  }
);
```

---

### FIX #4: Add CSRF Protection

**Issue:** Cross-site request forgery attacks possible  
**Impact:** Admin actions hijacked, unauthorized operations  

**Implementation:**

1. **Install csurf:**
```bash
npm install csurf
```

2. **Add CSRF middleware (server.js):**
```javascript
const csrf = require('csurf');
const cookieParser = require('cookie-parser');

app.use(cookieParser());

// CSRF protection middleware
const csrfProtection = csrf({ cookie: false }); // Use session instead of cookie

// Generate CSRF token for forms
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Apply to all state-changing API endpoints
app.post('/api/admin/*', csrfProtection, (req, res, next) => {
  // Token validated automatically by middleware
  next();
});

app.put('/api/admin/*', csrfProtection, (req, res, next) => next());
app.delete('/api/admin/*', csrfProtection, (req, res, next) => next());

// Error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    res.status(403).json({ error: 'Invalid CSRF token' });
  } else {
    next(err);
  }
});
```

3. **Update frontend to include CSRF token:**
```javascript
// Client-side helper
async function apiRequest(url, options = {}) {
  const response = await fetch('/api/csrf-token');
  const { csrfToken } = await response.json();
  
  const headers = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    ...options.headers
  };
  
  return fetch(url, {
    ...options,
    headers
  });
}

// Usage
apiRequest('/api/admin/bill/delete/123', {
  method: 'DELETE'
});
```

---

### FIX #5: Enforce HTTPS + Security Headers

**Issue:** No HTTPS enforcement, missing security headers  
**Impact:** Man-in-the-middle attacks, credential theft  

**Implementation:**

```javascript
// server.js

// 1. Force HTTPS redirect (if behind proxy)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    // Check if connection is NOT HTTPS
    const isHttps = req.header('x-forwarded-proto') === 'https' || 
                    req.connection.encrypted;
    if (!isHttps) {
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
  }
  next();
});

// 2. Add security headers
app.use((req, res, next) => {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent XSS
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net", // For LINE SDK
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.line.me https://generativelanguage.googleapis.com",
    "frame-ancestors 'none'"
  ].join('; '));
  
  // HSTS (HTTP Strict-Transport-Security)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Feature policy
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  next();
});

// 3. Secure cookies (already in session config above)
// cookie: { httpOnly: true, secure: true, sameSite: 'strict' }

// 4. CORS configuration (if needed for third-party APIs)
const cors = require('cors');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://yourdomain.com').split(',');
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  maxAge: 3600
}));
```

---

### FIX #6: Implement Comprehensive Audit Logging

**Issue:** No audit trail for admin actions  
**Impact:** Undetectable fraud, compliance violation, no accountability  

**Implementation:**

1. **Create audit table:**
```javascript
// In database.js - add to schema
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- e.g., 'bill_approved', 'payment_rejected', 'user_deleted'
    resource_type TEXT, -- e.g., 'payment', 'bill', 'admin_user'
    resource_id INTEGER,
    previous_values TEXT, -- JSON of old values
    new_values TEXT, -- JSON of new values
    ip_address TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'success', -- success, failure
    error_message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(timestamp, admin_user_id, action, resource_type, resource_id)
  );
  
  CREATE INDEX idx_audit_admin ON audit_logs(admin_user_id);
  CREATE INDEX idx_audit_dorm ON audit_logs(dormitory_id);
  CREATE INDEX idx_audit_action ON audit_logs(action);
  CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
  CREATE INDEX idx_audit_time ON audit_logs(timestamp DESC);
`);
```

2. **Create audit service:**
```javascript
// src/services/auditService.js
const db = require('../db/database');

function logAuditEvent({
  adminId,
  dormitoryId,
  action,
  resourceType,
  resourceId,
  previousValues = {},
  newValues = {},
  ipAddress,
  userAgent,
  status = 'success',
  errorMessage = null
}) {
  try {
    db.prepare(`
      INSERT INTO audit_logs
      (admin_user_id, dormitory_id, action, resource_type, resource_id,
       previous_values, new_values, ip_address, user_agent, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adminId,
      dormitoryId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(previousValues),
      JSON.stringify(newValues),
      ipAddress,
      userAgent,
      status,
      errorMessage
    );
  } catch (err) {
    console.error('Audit logging failed:', err);
    // Don't throw - audit logging failures should not break operations
  }
}

function getAuditLog(dormitoryId, filters = {}) {
  const { action, resourceType, startDate, endDate, adminId, limit = 1000 } = filters;
  
  let query = 'SELECT * FROM audit_logs WHERE dormitory_id = ?';
  const params = [dormitoryId];
  
  if (action) { query += ' AND action = ?'; params.push(action); }
  if (resourceType) { query += ' AND resource_type = ?'; params.push(resourceType); }
  if (adminId) { query += ' AND admin_user_id = ?'; params.push(adminId); }
  if (startDate) { query += ' AND timestamp >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND timestamp <= ?'; params.push(endDate); }
  
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  
  return db.prepare(query).all(...params);
}

module.exports = { logAuditEvent, getAuditLog };
```

3. **Add audit middleware:**
```javascript
// src/middleware/auditMiddleware.js
const auditService = require('../services/auditService');

// Capture client info
function attachClientInfo(req, res, next) {
  req.clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  req.userAgent = req.headers['user-agent'];
  next();
}

// Wrap response to capture status
function auditWrapper(req, res, auditConfig) {
  const originalJson = res.json.bind(res);
  
  res.json = function(data) {
    // Log audit event after successful response
    if (res.statusCode < 400 && auditConfig) {
      auditService.logAuditEvent({
        adminId: req.session?.adminId,
        dormitoryId: req.dormitoryId,
        action: auditConfig.action,
        resourceType: auditConfig.resourceType,
        resourceId: auditConfig.resourceId,
        previousValues: auditConfig.previousValues || {},
        newValues: auditConfig.newValues || data,
        ipAddress: req.clientIp,
        userAgent: req.userAgent,
        status: 'success'
      });
    }
    
    return originalJson(data);
  };
  
  return res;
}

module.exports = { attachClientInfo, auditWrapper };
```

4. **Use in admin routes:**
```javascript
// admin.js
const { auditWrapper, attachClientInfo } = require('../middleware/auditMiddleware');

router.use(attachClientInfo);

// Example: Payment approval with audit log
router.post('/admin/payment/:paymentId/approve', (req, res) => {
  const paymentId = req.params.paymentId;
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  
  if (!payment) return res.status(404).json({ error: 'Not found' });
  if (payment.dormitory_id !== req.dormitoryId) return res.status(403).json({ error: 'Forbidden' });
  
  const previousValues = { status: payment.status, approved_by: payment.approved_by };
  
  db.prepare(`
    UPDATE payments SET status = 'approved', approved_by = ?, approved_at = datetime('now')
    WHERE id = ?
  `).run(req.session.adminId, paymentId);
  
  const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  
  // Audit the action
  auditWrapper(req, res, {
    action: 'payment_approved',
    resourceType: 'payment',
    resourceId: paymentId,
    previousValues,
    newValues: { status: updated.status, approved_by: updated.approved_by }
  });
  
  res.json({ success: true, payment: updated });
});
```

---

## PHASE 2: HIGH PRIORITY FIXES (Week 3)

### FIX #7: Fix Multi-tenant Data Isolation

**Critical:** Every endpoint must verify dormitory access

**Implementation Pattern:**

```javascript
// BEFORE (VULNERABLE)
router.get('/admin/bills', (req, res) => {
  const bills = db.prepare(`
    SELECT * FROM bills WHERE room_id IN (
      SELECT id FROM rooms WHERE dormitory_id = ?
    )
  `).all(req.dormitoryId);
  res.json(bills);
});

// AFTER (SECURE)
router.get('/admin/bills', requireAdmin, (req, res) => {
  // 1. Verify admin access to this dormitory
  const adminAccess = db.prepare(`
    SELECT * FROM admin_users WHERE id = ? AND dormitory_id = ?
  `).get(req.session.adminId, req.dormitoryId);
  
  if (!adminAccess) {
    return res.status(403).json({ error: 'No access to this dormitory' });
  }
  
  // 2. Query with explicit dormitory filter
  const bills = db.prepare(`
    SELECT b.* FROM bills b
    JOIN rooms r ON b.room_id = r.id
    WHERE r.dormitory_id = ?
    ORDER BY b.created_at DESC
  `).all(req.dormitoryId);
  
  res.json(bills);
});
```

**Audit all routes for this pattern** - systematic review required.

---

### FIX #8: Prevent Duplicate Payments (Race Condition Fix)

**Implementation:**

```javascript
router.post('/tenant/payment', requireTenant, (req, res) => {
  const { bill_id, amount } = req.body;
  
  try {
    const result = db.transaction(() => {
      // 1. Lock and check for existing payment
      const existingPayment = db.prepare(`
        SELECT id FROM payments 
        WHERE bill_id = ? AND status IN ('pending', 'approved')
      `).get(bill_id);
      
      if (existingPayment) {
        throw new Error('Payment already pending for this bill');
      }
      
      // 2. Verify bill exists and belongs to user
      const bill = db.prepare(`
        SELECT b.*, r.id as room_id FROM bills b
        JOIN rooms r ON b.room_id = r.id
        JOIN tenants t ON r.id = t.room_id
        WHERE b.id = ? AND t.line_user_id = ? AND b.status IN ('pending', 'overdue')
      `).get(bill_id, req.session.lineUserId);
      
      if (!bill) throw new Error('Bill not found or already paid');
      
      // 3. Validate amount
      if (Math.abs(parseFloat(amount) - parseFloat(bill.total_amount)) > 0.01) {
        throw new Error('Payment amount mismatch');
      }
      
      // 4. Insert payment atomically
      const result = db.prepare(`
        INSERT INTO payments (bill_id, amount, slip_path, status, paid_at)
        VALUES (?, ?, ?, 'pending', datetime('now'))
      `).run(bill_id, amount, req.file?.filename || null);
      
      // 5. Update bill status
      db.prepare(`UPDATE bills SET status = 'reviewing' WHERE id = ?`).run(bill_id);
      
      return { paymentId: result.lastInsertRowid, billId: bill_id };
    })();
    
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

---

### FIX #9: Add Database Encryption at Rest

**Implementation:**

```bash
# 1. Install SQL cipher (SQLite encryption)
npm install sql.js-httpvfs

# 2. Or use application-level encryption for sensitive fields
npm install crypto
```

```javascript
// Encrypt sensitive data at application level
const crypto = require('crypto');

function encrypt(text, key = process.env.ENCRYPTION_KEY) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text, key = process.env.ENCRYPTION_KEY) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Encrypt ID card numbers, phone numbers
// When storing: db.prepare('INSERT INTO tenants (id_card) VALUES (?)').run(encrypt(idCard));
// When retrieving: decrypt(tenant.id_card);
```

---

### FIX #10: Add Automated Backup System

**Implementation:**

```javascript
// src/services/backupService.js
const cron = require('node-cron');
const fs = require('fs-extra');
const path = require('path');
const AWS = require('aws-sdk');
const db = require('../db/database');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'ap-southeast-1'
});

async function backupDatabase() {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    await fs.ensureDir(backupDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `rms_${timestamp}.db`);
    
    // Create backup using SQL
    const backupDb = new (require('better-sqlite3'))(backupFile);
    db.exec(`VACUUM INTO '${backupFile}'`);
    backupDb.close();
    
    // Upload to S3
    const fileStream = fs.createReadStream(backupFile);
    const params = {
      Bucket: process.env.AWS_BACKUP_BUCKET || 'rms-backups',
      Key: `daily/${timestamp}.db`,
      Body: fileStream,
      ServerSideEncryption: 'AES256'
    };
    
    await s3.upload(params).promise();
    console.log(`✅ Backup uploaded: ${timestamp}.db`);
    
    // Cleanup old local backups (keep 7 days)
    const files = await fs.readdir(backupDir);
    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stat = await fs.stat(filePath);
      const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
      if (ageHours > 168) { // 7 days
        await fs.remove(filePath);
      }
    }
    
  } catch (err) {
    console.error('Backup failed:', err);
    // Alert admin
    await notifyAdmin(`Database backup failed: ${err.message}`);
  }
}

// Run daily at 2 AM
cron.schedule('0 2 * * *', backupDatabase);

module.exports = { backupDatabase };
```

**.env configuration:**
```bash
# Backup
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_BACKUP_BUCKET=rms-backups
AWS_REGION=ap-southeast-1
```

---

## PHASE 3: MONITORING & ALERTING (Week 4)

### FIX #11: Setup Health Check Endpoint

```javascript
// server.js - Add health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    checks: {}
  };
  
  try {
    // Database check
    const dbCheck = db.prepare('SELECT 1').get();
    health.checks.database = dbCheck ? 'UP' : 'DOWN';
    
    // Redis check
    await new Promise((resolve, reject) => {
      redisClient.ping((err, pong) => {
        if (err) reject(err);
        health.checks.redis = pong ? 'UP' : 'DOWN';
        resolve();
      });
    });
    
    // LINE API check (optional, from cache)
    health.checks.line_api = 'UP'; // Assume UP unless last call failed
    
  } catch (err) {
    health.status = 'DOWN';
    health.error = err.message;
  }
  
  const statusCode = health.status === 'UP' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

## TESTING VALIDATION

### Security Testing Checklist:

```javascript
// tests/security/auth.test.js
const test = require('@playwright/test');

test.describe('Authentication Security', () => {
  test('Should reject brute force login attempts', async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await page.goto('/admin/login');
      await page.fill('input[name="email"]', 'admin@test.com');
      await page.fill('input[name="password"]', 'wrong' + i);
      await page.click('button[type="submit"]');
      
      if (i > 5) {
        // Should be rate limited after 5 attempts
        const error = await page.locator('text=/too many|rate limit/i');
        await error.waitFor({ timeout: 5000 });
      }
    }
  });
  
  test('Should validate CSRF token on form submission', async ({ page }) => {
    await page.goto('/admin');
    
    // Try to submit form without CSRF token
    const response = await page.evaluate(() => {
      return fetch('/api/admin/bill/approve/1', {
        method: 'POST',
        body: JSON.stringify({ status: 'approved' })
      }).then(r => r.status);
    });
    
    // Should be rejected with 403
    test.expect(response).toBe(403);
  });
});
```

---

## DEPLOYMENT CHECKLIST

Before going live, verify:

- [ ] All CRITICAL fixes implemented
- [ ] Rate limiting enabled and tested
- [ ] CSRF protection active
- [ ] HTTPS enforced
- [ ] Sessions using Redis
- [ ] Audit logging working
- [ ] Multi-tenant isolation verified
- [ ] Automated backups running
- [ ] Health check endpoint working
- [ ] Monitoring dashboards setup
- [ ] Alerting configured
- [ ] Security headers present
- [ ] Input validation on all endpoints
- [ ] File uploads validated
- [ ] Error handling user-friendly
- [ ] Secrets in environment variables only
- [ ] .env not committed to Git
- [ ] Professional security audit completed
- [ ] Load testing passed (1000 concurrent users)
- [ ] Disaster recovery drill successful

---

## ESTIMATED TIMELINE

| Phase | Tasks | Timeline | Team |
|-------|-------|----------|------|
| Phase 1 | Session management, rate limiting, input validation, CSRF, HTTPS, audit logging | 2 weeks | 2-3 developers |
| Phase 2 | Multi-tenant isolation, payment race conditions, encryption, backups | 1 week | 1-2 developers |
| Phase 3 | Monitoring, alerting, health checks, testing | 1 week | 1 developer |
| Phase 4 | Security audit, load testing, final validation | 1-2 weeks | Security team + QA |
| **TOTAL** | | **5-6 weeks** | **4-5 people** |

---

**This remediation plan is comprehensive but achievable. Success depends on:**
1. Executive commitment to security
2. Sufficient engineering resources
3. Professional security review
4. Rigorous testing before launch

**Do not skip steps or cut corners - the reputation and legality of the business depends on it.**
