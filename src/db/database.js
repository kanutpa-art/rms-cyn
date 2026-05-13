// ใช้ better-sqlite3 (รองรับทุก Node version ตั้งแต่ 14+)
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DATA_DIR: set to '/data' on Render (persistent disk) or custom path
// Falls back to <project>/data for local dev
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'rms.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ============================================================
// SCHEMA — Core tables
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS dormitories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    line_channel_id TEXT,
    line_channel_secret TEXT,
    line_channel_access_token TEXT,
    liff_id TEXT,
    promptpay_number TEXT,
    promptpay_name TEXT,
    water_rate REAL DEFAULT 18,
    electric_rate REAL DEFAULT 8,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    line_user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    building TEXT DEFAULT 'A',
    floor INTEGER DEFAULT 1,
    room_number TEXT NOT NULL,
    room_code TEXT,
    monthly_rent REAL NOT NULL DEFAULT 0,
    notes TEXT,
    initial_water_meter INTEGER DEFAULT 0,
    initial_electric_meter INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dormitory_id, room_code)
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
    line_user_id TEXT NOT NULL UNIQUE,
    display_name TEXT,
    picture_url TEXT,
    phone TEXT,
    id_card TEXT,
    contract_start_date DATE,
    deposit_amount REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS room_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    billing_month TEXT NOT NULL,
    water_meter_prev INTEGER DEFAULT 0,
    water_meter_curr INTEGER DEFAULT 0,
    electric_meter_prev INTEGER DEFAULT 0,
    electric_meter_curr INTEGER DEFAULT 0,
    water_units INTEGER DEFAULT 0,
    electric_units INTEGER DEFAULT 0,
    rent_amount REAL DEFAULT 0,
    water_amount REAL DEFAULT 0,
    electric_amount REAL DEFAULT 0,
    other_amount REAL DEFAULT 0,
    other_label TEXT,
    late_fee REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','reviewing','paid','overdue')),
    due_date DATE,
    line_message_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, billing_month)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    method TEXT DEFAULT 'transfer',
    slip_path TEXT,
    slip_line_message_id TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    reject_reason TEXT,
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    approved_by INTEGER REFERENCES admin_users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS maintenance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    image_path TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER REFERENCES dormitories(id),
    line_user_id TEXT,
    direction TEXT CHECK(direction IN ('in','out')),
    message_type TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- COLLECTION POLICY (per dormitory)
  -- ============================================================
  CREATE TABLE IF NOT EXISTS collection_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL UNIQUE REFERENCES dormitories(id) ON DELETE CASCADE,
    grace_period_days INTEGER DEFAULT 3,
    late_fee_type TEXT DEFAULT 'percentage' CHECK(late_fee_type IN ('percentage','fixed','none')),
    late_fee_value REAL DEFAULT 5,
    late_fee_max REAL DEFAULT 0,
    reminder1_day INTEGER DEFAULT 1,
    reminder1_template TEXT,
    reminder2_day INTEGER DEFAULT 3,
    reminder2_template TEXT,
    formal_notice_day INTEGER DEFAULT 7,
    formal_notice_template TEXT,
    escalation_day INTEGER DEFAULT 30,
    escalation_actions TEXT,
    escalation_template TEXT,
    enabled INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- log การติดตามหนี้แต่ละครั้ง
  CREATE TABLE IF NOT EXISTS collection_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    stage TEXT CHECK(stage IN ('reminder1','reminder2','formal_notice','escalation','manual')),
    days_overdue INTEGER,
    message_sent TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_by TEXT DEFAULT 'system'
  );

  -- ============================================================
  -- CONTRACTS
  -- ============================================================
  CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    contract_number TEXT,
    tenant_name TEXT,
    tenant_id_card TEXT,
    tenant_phone TEXT,
    tenant_address TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    monthly_rent REAL NOT NULL,
    deposit_amount REAL DEFAULT 0,
    payment_due_day INTEGER DEFAULT 5,
    custom_terms TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','expiring','expired','terminated')),
    pdf_path TEXT,
    signed_at DATETIME,
    terminated_at DATETIME,
    termination_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contract_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- ADMIN ↔ LINE LINK
  -- ============================================================
  CREATE TABLE IF NOT EXISTS admin_line_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    line_user_id TEXT NOT NULL,
    linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dormitory_id, line_user_id)
  );

  CREATE TABLE IF NOT EXISTS admin_link_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- FINANCIAL: รายรับ-รายจ่าย
  -- ============================================================
  CREATE TABLE IF NOT EXISTS financial_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('income','expense')),
    category TEXT,
    description TEXT,
    amount REAL NOT NULL,
    transaction_date DATE NOT NULL,
    reference_type TEXT,
    reference_id INTEGER,
    bank_account TEXT,
    bank_ref TEXT,
    created_by INTEGER REFERENCES admin_users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_fintx_dorm_date ON financial_transactions(dormitory_id, transaction_date);

  -- ============================================================
  -- SESSIONS (replaces session-file-store; survives restarts)
  -- ============================================================
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired_at);

  CREATE TABLE IF NOT EXISTS bank_statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    statement_date DATE,
    description TEXT,
    amount REAL,
    balance REAL,
    reference TEXT,
    matched_payment_id INTEGER REFERENCES payments(id),
    matched_at DATETIME,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- TENANT BLACKLIST
  -- ============================================================
  CREATE TABLE IF NOT EXISTS tenant_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER REFERENCES dormitories(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    id_card TEXT,
    phone TEXT,
    reason TEXT,
    severity TEXT DEFAULT 'medium' CHECK(severity IN ('low','medium','high')),
    created_by INTEGER REFERENCES admin_users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- INSPECTIONS (Move-in / Move-out)
  -- ============================================================
  CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK(type IN ('move_in','move_out')),
    inspection_date DATE NOT NULL,
    water_meter INTEGER,
    electric_meter INTEGER,
    overall_condition TEXT,
    notes TEXT,
    damages_json TEXT,
    total_deduction REAL DEFAULT 0,
    inspector_id INTEGER REFERENCES admin_users(id),
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','completed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS inspection_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    photo_path TEXT,
    caption TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- ASSETS (per room inventory)
  -- ============================================================
  CREATE TABLE IF NOT EXISTS room_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    serial_number TEXT,
    purchase_date DATE,
    purchase_price REAL DEFAULT 0,
    condition TEXT DEFAULT 'good' CHECK(condition IN ('new','good','fair','poor','broken')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- VENDORS
  -- ============================================================
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    rating INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS vendor_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    maintenance_id INTEGER REFERENCES maintenance_requests(id) ON DELETE SET NULL,
    cost REAL DEFAULT 0,
    job_date DATE,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- CALENDAR
  -- ============================================================
  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT,
    event_date DATE NOT NULL,
    event_time TEXT,
    related_room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    related_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    reminded INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- MOVE-OUT REQUESTS
  -- ============================================================
  CREATE TABLE IF NOT EXISTS move_out_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    requested_date DATE,
    actual_date DATE,
    reason TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','completed','rejected','cancelled')),
    admin_note TEXT,
    inspection_id INTEGER REFERENCES inspections(id),
    final_deposit_refund REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- DEPOSIT TRANSACTIONS
  -- ============================================================
  CREATE TABLE IF NOT EXISTS deposit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('deposit','deduction','refund','adjustment')),
    amount REAL NOT NULL,
    description TEXT,
    reference_type TEXT,
    reference_id INTEGER,
    created_by INTEGER REFERENCES admin_users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- E-SIGNATURE
  -- ============================================================
  CREATE TABLE IF NOT EXISTS contract_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    signer_type TEXT NOT NULL CHECK(signer_type IN ('tenant','landlord')),
    signer_name TEXT,
    signer_line_id TEXT,
    signature_data TEXT,
    signed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    UNIQUE(contract_id, signer_type)
  );

  CREATE TABLE IF NOT EXISTS contract_sign_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    signer_type TEXT,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ============================================================
  -- MULTI-PROPERTY: owner ↔ dormitory access
  -- ============================================================
  CREATE TABLE IF NOT EXISTS owner_dormitory_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'admin' CHECK(role IN ('owner','admin','manager','technician')),
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(admin_user_id, dormitory_id)
  );

  -- ============================================================
  -- REMINDER SETTINGS
  -- ============================================================
  CREATE TABLE IF NOT EXISTS reminder_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL UNIQUE REFERENCES dormitories(id) ON DELETE CASCADE,
    meter_reading_day INTEGER DEFAULT 25,
    contract_expiry_warn_days INTEGER DEFAULT 30,
    bill_due_warn_days INTEGER DEFAULT 3,
    enabled INTEGER DEFAULT 1
  );
`);

// Auto-migrate: every existing admin gets owner_dormitory_access entry
db.exec(`
  INSERT OR IGNORE INTO owner_dormitory_access (admin_user_id, dormitory_id, role, is_default)
  SELECT id, dormitory_id, 'owner', 1 FROM admin_users
`);

// New tables for charges, status log
db.exec(`
  CREATE TABLE IF NOT EXISTS dormitory_charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('deposit','recurring','onetime')),
    amount REAL NOT NULL DEFAULT 0,
    refundable INTEGER DEFAULT 1,
    required INTEGER DEFAULT 0,
    description TEXT,
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dormitory_id, code)
  );

  CREATE TABLE IF NOT EXISTS room_status_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    note TEXT,
    changed_by INTEGER REFERENCES admin_users(id),
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Per-user Operator UI permissions (which sections they see / can act on)
  CREATE TABLE IF NOT EXISTS operator_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    dormitory_id INTEGER NOT NULL REFERENCES dormitories(id) ON DELETE CASCADE,
    can_view_buildings INTEGER DEFAULT 1,
    can_view_rooms INTEGER DEFAULT 1,
    can_change_status INTEGER DEFAULT 1,
    can_view_tenant_info INTEGER DEFAULT 1,
    can_view_bills INTEGER DEFAULT 1,
    can_create_bills INTEGER DEFAULT 0,
    can_approve_payments INTEGER DEFAULT 0,
    can_handle_maintenance INTEGER DEFAULT 1,
    can_send_reminders INTEGER DEFAULT 0,
    can_create_invite INTEGER DEFAULT 0,
    visible_buildings TEXT,
    UNIQUE(admin_user_id, dormitory_id)
  );

  -- CONTRACT RENEWAL REQUESTS (from tenant share page)
  CREATE TABLE IF NOT EXISTS contract_renewal_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    requested_months INTEGER NOT NULL,
    note TEXT,
    images_json TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ============================================================
// MIGRATIONS — handle existing DBs (idempotent)
// ============================================================
function columnExists(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === col);
}
function tryAddColumn(table, col, ddl) {
  if (!columnExists(table, col)) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); }
    catch (e) { console.warn(`migrate ${table}.${col}:`, e.message); }
  }
}

// rooms: operational status (operator view)
tryAddColumn('rooms', 'operational_status', "TEXT DEFAULT 'vacant'");
tryAddColumn('rooms', 'status_note', 'TEXT');
tryAddColumn('rooms', 'status_updated_at', 'DATETIME');

// dormitories: setup wizard flag + rent due day + room quota
tryAddColumn('dormitories', 'setup_completed', 'INTEGER DEFAULT 0');
tryAddColumn('dormitories', 'rent_due_day', 'INTEGER DEFAULT 5');
tryAddColumn('dormitories', 'rent_proration_enabled', 'INTEGER DEFAULT 1');
tryAddColumn('dormitories', 'room_quota', 'INTEGER DEFAULT 30'); // 10/20/30/40/50/60 — license tier
tryAddColumn('dormitories', 'water_rate_type', "TEXT DEFAULT 'flat'"); // flat | tiered | min_charge
tryAddColumn('dormitories', 'water_min_charge', 'REAL DEFAULT 0');
tryAddColumn('dormitories', 'water_tiers_json', 'TEXT');
tryAddColumn('dormitories', 'electric_rate_type', "TEXT DEFAULT 'flat'");
tryAddColumn('dormitories', 'electric_min_charge', 'REAL DEFAULT 0');
tryAddColumn('dormitories', 'electric_tiers_json', 'TEXT');

// rooms: building, floor (INTEGER), room_code
tryAddColumn('rooms', 'building', "TEXT DEFAULT 'A'");
// floor was TEXT in old schema — keep both compatible (skip if exists)
if (!columnExists('rooms', 'room_code')) {
  tryAddColumn('rooms', 'room_code', 'TEXT');
}

// bills: late_fee
tryAddColumn('bills', 'late_fee', 'REAL DEFAULT 0');

// admin_users: line_user_id
tryAddColumn('admin_users', 'line_user_id', 'TEXT');

// tenants: id_card + Thai-standard fields + share_token
tryAddColumn('tenants', 'id_card', 'TEXT');
tryAddColumn('tenants', 'address', 'TEXT');
tryAddColumn('tenants', 'occupation', 'TEXT');
tryAddColumn('tenants', 'workplace', 'TEXT');
tryAddColumn('tenants', 'emergency_name', 'TEXT');
tryAddColumn('tenants', 'emergency_phone', 'TEXT');
tryAddColumn('tenants', 'emergency_relation', 'TEXT');
tryAddColumn('tenants', 'guarantor_name', 'TEXT');
tryAddColumn('tenants', 'guarantor_phone', 'TEXT');
tryAddColumn('tenants', 'guarantor_id_card', 'TEXT');
tryAddColumn('tenants', 'id_card_photo', 'TEXT');
tryAddColumn('tenants', 'move_in_date', 'DATE');
tryAddColumn('tenants', 'share_token', 'TEXT');  // public link token for tenant share page

// maintenance_requests: multi-image support
tryAddColumn('maintenance_requests', 'images_json', 'TEXT');

// move_out_requests: multi-image support
tryAddColumn('move_out_requests', 'images_json', 'TEXT');

// contract_renewal_requests: multi-image support (table may already exist with column)
tryAddColumn('contract_renewal_requests', 'images_json', 'TEXT');

// Backfill room_code from building+floor+room_number
db.prepare(`
  UPDATE rooms SET room_code = COALESCE(building,'A') || COALESCE(CAST(floor AS TEXT),'1') || room_number
  WHERE room_code IS NULL OR room_code = ''
`).run();

// Auto-derive operational_status (after column exists from migration above)
try {
  db.prepare(`UPDATE rooms SET operational_status='occupied'
    WHERE operational_status='vacant' AND id IN (SELECT room_id FROM tenants)`).run();
} catch(e) { /* may run before column exists in fresh DB */ }

// ============================================================
// helper: แปลง BigInt lastInsertRowid → Number
// ============================================================
const origPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = origPrepare(sql);
  const origRun = stmt.run.bind(stmt);
  stmt.run = (...args) => {
    const result = origRun(...args);
    if (result && typeof result.lastInsertRowid === 'bigint') {
      result.lastInsertRowid = Number(result.lastInsertRowid);
    }
    return result;
  };
  return stmt;
};

module.exports = db;
