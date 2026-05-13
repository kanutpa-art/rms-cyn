/**
 * seed.js — สร้างข้อมูลเริ่มต้น + Demo Data ที่สมจริง
 * รัน: node scripts/seed.js
 * - idempotent: รันซ้ำได้โดยไม่สร้างข้อมูลซ้ำ
 * - ถ้า SEED_DEMO=true หรือ NODE_ENV=demo → สร้างผู้เช่า+บิลตัวอย่างด้วย
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/db/database');

const dormName     = process.env.DORMITORY_NAME || 'หอพักสุขใจ';
const adminName    = process.env.ADMIN_NAME     || 'เจ้าของหอ';
const adminEmail   = process.env.ADMIN_EMAIL    || 'admin@example.com';
const adminPassword= process.env.ADMIN_PASSWORD || 'demo1234';
const seedDemo     = process.env.SEED_DEMO === 'true' || process.env.NODE_ENV === 'demo' || true; // เปิด demo เสมอ

console.log('\n🌱 Seeding database...\n');

// ============================================================
// 1. สร้าง Dormitory
// ============================================================
let dorm = db.prepare('SELECT id FROM dormitories WHERE name = ?').get(dormName);
let dormId;
if (dorm) {
  dormId = dorm.id;
  console.log(`✅ Dormitory: "${dormName}" (id: ${dormId})`);
} else {
  const r = db.prepare(`
    INSERT INTO dormitories (name, address, water_rate, electric_rate,
      promptpay_number, promptpay_name,
      line_channel_id, line_channel_secret, line_channel_access_token, liff_id,
      setup_completed, rent_due_day)
    VALUES (?, ?, 18, 8, ?, ?, ?, ?, ?, ?, 1, 5)
  `).run(
    dormName,
    '123 ถ.รัชดา แขวงดินแดง กรุงเทพฯ 10400',
    process.env.PROMPTPAY_NUMBER || '',
    process.env.PROMPTPAY_NAME   || '',
    process.env.LINE_CHANNEL_ID  || '',
    process.env.LINE_CHANNEL_SECRET || '',
    process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    process.env.LIFF_ID || ''
  );
  dormId = r.lastInsertRowid;
  console.log(`✅ Created dormitory: "${dormName}" (id: ${dormId})`);
}

// ============================================================
// 2. สร้าง Admin User
// ============================================================
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(adminEmail);
let adminId;
if (existingAdmin) {
  adminId = existingAdmin.id;
  console.log(`✅ Admin: ${adminEmail}`);
} else {
  const hash = bcrypt.hashSync(adminPassword, 10);
  const r = db.prepare(`
    INSERT INTO admin_users (dormitory_id, name, email, password_hash)
    VALUES (?, ?, ?, ?)
  `).run(dormId, adminName, adminEmail, hash);
  adminId = r.lastInsertRowid;
  console.log(`✅ Created admin: ${adminEmail} / ${adminPassword}`);
}

// ============================================================
// 3. owner_dormitory_access
// ============================================================
const accExists = db.prepare(
  'SELECT id FROM owner_dormitory_access WHERE admin_user_id=? AND dormitory_id=?'
).get(adminId, dormId);
if (!accExists) {
  db.prepare(`INSERT OR IGNORE INTO owner_dormitory_access (admin_user_id, dormitory_id, role, is_default)
    VALUES (?,?,?,1)`).run(adminId, dormId, 'owner');
}

// ============================================================
// 4. Default collection policy + contract template
// ============================================================
const collectionService = require('../src/services/collectionService');
const contractService   = require('../src/services/contractService');
collectionService.getPolicy(dormId);
contractService.ensureDefaultTemplate(dormId);
console.log('✅ Collection policy & contract template ready');

// ============================================================
// 5. ห้องพัก 15 ห้อง (2 อาคาร)
// ============================================================
const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id = ?').get(dormId).c;
const roomMap = {}; // code → id

if (roomCount === 0) {
  const rooms = [
    // อาคาร A
    { b:'A', f:1, n:'01', rent:3500 },
    { b:'A', f:1, n:'02', rent:3500 },
    { b:'A', f:1, n:'03', rent:3500 },
    { b:'A', f:2, n:'01', rent:4000 },
    { b:'A', f:2, n:'02', rent:4000 },
    { b:'A', f:2, n:'03', rent:4000 },
    { b:'A', f:2, n:'04', rent:4000 },
    { b:'A', f:3, n:'01', rent:4500 },
    // อาคาร B
    { b:'B', f:1, n:'01', rent:3800 },
    { b:'B', f:1, n:'02', rent:3800 },
    { b:'B', f:1, n:'03', rent:3800 },
    { b:'B', f:2, n:'01', rent:4200 },
    { b:'B', f:2, n:'02', rent:4200 },
    { b:'B', f:2, n:'03', rent:4200 },
    { b:'B', f:2, n:'04', rent:4200 },
  ];
  for (const r of rooms) {
    const code = `${r.b}${r.f}${r.n}`;
    const res = db.prepare(`
      INSERT INTO rooms (dormitory_id, building, floor, room_number, room_code,
        monthly_rent, initial_water_meter, initial_electric_meter, operational_status)
      VALUES (?,?,?,?,?,?,?,?,'vacant')
    `).run(dormId, r.b, r.f, r.n, code, r.rent, 100, 200);
    roomMap[code] = res.lastInsertRowid;
  }
  console.log(`✅ Created 15 rooms (A: 8 ห้อง, B: 7 ห้อง)`);
} else {
  // โหลด room map จาก DB
  const existing = db.prepare('SELECT id, room_code FROM rooms WHERE dormitory_id=?').all(dormId);
  existing.forEach(r => { roomMap[r.room_code] = r.id; });
  console.log(`✅ Rooms: ${roomCount} ห้อง`);
}

// ============================================================
// 6. Demo Data: ผู้เช่า + บิล + maintenance (ถ้ายังไม่มี)
// ============================================================
const tenantCount = db.prepare('SELECT COUNT(*) as c FROM tenants t JOIN rooms r ON t.room_id=r.id WHERE r.dormitory_id=?').get(dormId).c;

if (tenantCount === 0 && seedDemo) {
  console.log('\n📦 Creating demo data...');

  // วันที่ปัจจุบัน
  const now   = new Date();
  const thisM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; // YYYY-MM
  const prevM = (() => {
    const d = new Date(now); d.setMonth(d.getMonth()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  })();
  const prev2M = (() => {
    const d = new Date(now); d.setMonth(d.getMonth()-2);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  })();

  // due_date = วันที่ 5 ของเดือน
  const dueDate     = `${thisM}-05`;
  const prevDueDate = `${prevM}-05`;

  // ============================================================
  // ผู้เช่า 10 คน (10/15 ห้อง occupied)
  // ============================================================
  const tenants = [
    { room:'A101', name:'สมชาย ใจดี',        phone:'081-111-2222', lineId:'U_demo_01', wPrev:100, wCurr:118, ePrev:200, eCurr:245 },
    { room:'A102', name:'นิดา วงศ์ใหญ่',     phone:'082-222-3333', lineId:'U_demo_02', wPrev:100, wCurr:122, ePrev:200, eCurr:258 },
    { room:'A103', name:'ประสิทธิ์ แก้วสว่าง', phone:'083-333-4444', lineId:'U_demo_03', wPrev:100, wCurr:115, ePrev:200, eCurr:231 },
    { room:'A201', name:'มาลี ทองคำ',         phone:'084-444-5555', lineId:'U_demo_04', wPrev:100, wCurr:120, ePrev:200, eCurr:250 },
    { room:'A202', name:'วิชัย เจริญรัตน์',   phone:'085-555-6666', lineId:'U_demo_05', wPrev:100, wCurr:117, ePrev:200, eCurr:238 },
    { room:'A301', name:'นวลจันทร์ สุขใส',   phone:'086-666-7777', lineId:'U_demo_06', wPrev:100, wCurr:125, ePrev:200, eCurr:270 },
    { room:'B101', name:'กิตติ สมบูรณ์',      phone:'087-777-8888', lineId:'U_demo_07', wPrev:100, wCurr:119, ePrev:200, eCurr:248 },
    { room:'B102', name:'ปาริชาต เดชมงคล',   phone:'088-888-9999', lineId:'U_demo_08', wPrev:100, wCurr:121, ePrev:200, eCurr:252 },
    { room:'B201', name:'สุดา รักษ์ดี',       phone:'089-999-0000', lineId:'U_demo_09', wPrev:100, wCurr:116, ePrev:200, eCurr:235 },
    { room:'B202', name:'ธนวัฒน์ ชัยมงคล',   phone:'090-000-1111', lineId:'U_demo_10', wPrev:100, wCurr:123, ePrev:200, eCurr:262 },
  ];

  const tenantIds = {};

  db.transaction(() => {
    for (const t of tenants) {
      const roomId = roomMap[t.room];
      if (!roomId) { console.warn(`  ⚠️  ไม่พบห้อง ${t.room}`); continue; }
      const shareToken = uuidv4().replace(/-/g,'');
      const r = db.prepare(`
        INSERT INTO tenants (room_id, line_user_id, display_name, phone,
          contract_start_date, deposit_amount, move_in_date, share_token)
        VALUES (?,?,?,?, date('now','-3 months'), ?, date('now','-3 months'), ?)
      `).run(roomId, t.lineId, t.name, t.phone, t.rent || 3800, shareToken);
      tenantIds[t.room] = r.lastInsertRowid;
      db.prepare("UPDATE rooms SET operational_status='occupied' WHERE id=?").run(roomId);

      // deposit transaction
      const room = db.prepare('SELECT monthly_rent FROM rooms WHERE id=?').get(roomId);
      db.prepare(`INSERT INTO deposit_transactions (tenant_id, type, amount, description)
        VALUES (?,'deposit',?,'เงินประกันแรกเข้า')`).run(r.lastInsertRowid, room.monthly_rent);
    }
  })();
  console.log(`  ✅ สร้างผู้เช่า ${tenants.length} คน`);

  // ============================================================
  // บิลเดือนปัจจุบัน (สถานะต่างกัน เพื่อให้ demo เห็นภาพ)
  // ============================================================
  const water_rate = 18, elec_rate = 8;

  const billScenarios = [
    { room:'A101', status:'paid',      slip:true,  approved:true  }, // ✅ จ่ายแล้ว
    { room:'A102', status:'reviewing', slip:true,  approved:false }, // 🔄 รอตรวจสลิป
    { room:'A103', status:'overdue',   slip:false, approved:false }, // 🔴 เกินกำหนด
    { room:'A201', status:'paid',      slip:true,  approved:true  }, // ✅ จ่ายแล้ว
    { room:'A202', status:'pending',   slip:false, approved:false }, // 🟡 รอชำระ
    { room:'A301', status:'paid',      slip:true,  approved:true  }, // ✅ จ่ายแล้ว
    { room:'B101', status:'pending',   slip:false, approved:false }, // 🟡 รอชำระ
    { room:'B102', status:'overdue',   slip:false, approved:false }, // 🔴 เกินกำหนด
    { room:'B201', status:'paid',      slip:true,  approved:true  }, // ✅ จ่ายแล้ว
    { room:'B202', status:'reviewing', slip:true,  approved:false }, // 🔄 รอตรวจสลิป
  ];

  db.transaction(() => {
    for (const s of billScenarios) {
      const roomId = roomMap[s.room];
      if (!roomId) continue;
      const t = tenants.find(x => x.room === s.room);
      if (!t) continue;

      const wUnits = t.wCurr - t.wPrev;
      const eUnits = t.eCurr - t.ePrev;
      const room   = db.prepare('SELECT monthly_rent FROM rooms WHERE id=?').get(roomId);
      const wAmt   = wUnits * water_rate;
      const eAmt   = eUnits * elec_rate;
      const total  = room.monthly_rent + wAmt + eAmt;

      const billR = db.prepare(`
        INSERT INTO bills (room_id, billing_month, due_date, status,
          water_meter_prev, water_meter_curr, electric_meter_prev, electric_meter_curr,
          water_units, electric_units, rent_amount, water_amount, electric_amount,
          other_amount, late_fee, total_amount)
        VALUES (?,?,?,?, ?,?,?,?, ?,?, ?,?,?, 0, 0, ?)
      `).run(
        roomId, thisM, dueDate, s.status,
        t.wPrev, t.wCurr, t.ePrev, t.eCurr,
        wUnits, eUnits, room.monthly_rent, wAmt, eAmt, total
      );
      const billId = billR.lastInsertRowid;

      if (s.slip) {
        const payR = db.prepare(`
          INSERT INTO payments (bill_id, amount, method, slip_path, status, paid_at,
            approved_at, approved_by)
          VALUES (?,?,'promptpay','uploads/slips/demo_slip.jpg',?,
            datetime('now','-2 days'),
            ${s.approved ? "datetime('now','-1 days')" : 'NULL'},
            ${s.approved ? adminId : 'NULL'})
        `).run(billId, total, s.approved ? 'approved' : 'pending');

        if (s.approved) {
          db.prepare("UPDATE bills SET status='paid' WHERE id=?").run(billId);
          // income record
          db.prepare(`INSERT INTO financial_transactions
            (dormitory_id, type, category, description, amount, transaction_date, reference_type, reference_id, created_by)
            VALUES (?,?,?,?,?, date('now'), 'payment', ?, ?)`).run(
            dormId, 'income', 'rent', `ค่าเช่าห้อง ${s.room} เดือน ${thisM}`, total, payR.lastInsertRowid, adminId
          );
        }
      }
    }
  })();
  console.log(`  ✅ สร้างบิลเดือน ${thisM} (${billScenarios.length} ใบ)`);

  // ============================================================
  // บิลเดือนก่อน (ทั้งหมด paid แล้ว)
  // ============================================================
  db.transaction(() => {
    for (const t of tenants) {
      const roomId = roomMap[t.room];
      if (!roomId) continue;
      const room = db.prepare('SELECT monthly_rent FROM rooms WHERE id=?').get(roomId);
      const wUnits = Math.floor(15 + Math.random()*10);
      const eUnits = Math.floor(40 + Math.random()*20);
      const wAmt = wUnits * water_rate;
      const eAmt = eUnits * elec_rate;
      const total = room.monthly_rent + wAmt + eAmt;

      const billR = db.prepare(`
        INSERT INTO bills (room_id, billing_month, due_date, status,
          water_meter_prev, water_meter_curr, electric_meter_prev, electric_meter_curr,
          water_units, electric_units, rent_amount, water_amount, electric_amount,
          other_amount, late_fee, total_amount)
        VALUES (?,?,?,'paid', ?,?,?,?, ?,?, ?,?,?, 0, 0, ?)
      `).run(
        roomId, prevM, prevDueDate,
        t.wPrev, t.wPrev + wUnits, t.ePrev, t.ePrev + eUnits,
        wUnits, eUnits, room.monthly_rent, wAmt, eAmt, total
      );
      const billId = billR.lastInsertRowid;
      const payR = db.prepare(`
        INSERT INTO payments (bill_id, amount, method, slip_path, status, paid_at, approved_at, approved_by)
        VALUES (?,'${total}','promptpay','uploads/slips/demo_slip.jpg','approved',
          datetime('now','-32 days'), datetime('now','-31 days'), ?)
      `).run(billId, adminId);
      db.prepare(`INSERT INTO financial_transactions
        (dormitory_id, type, category, description, amount, transaction_date, reference_type, reference_id, created_by)
        VALUES (?,?,?,?,?, date('now','-1 month'),'payment',?,?)`).run(
        dormId,'income','rent',`ค่าเช่าห้อง ${t.room} เดือน ${prevM}`, total, payR.lastInsertRowid, adminId
      );
    }
  })();
  console.log(`  ✅ สร้างบิลเดือนก่อน ${prevM} (${tenants.length} ใบ — paid ทั้งหมด)`);

  // ============================================================
  // แจ้งซ่อม 3 รายการ
  // ============================================================
  db.transaction(() => {
    const maintenanceItems = [
      { room:'A103', title:'ก๊อกน้ำในห้องน้ำรั่ว',    desc:'น้ำหยดตลอดเวลา ทำให้น้ำสิ้นเปลือง',         status:'pending',     created_at:"datetime('now','-5 days')" },
      { room:'A201', title:'แอร์ไม่เย็น ทำงานผิดปกติ', desc:'แอร์เปิดแล้วไม่เย็น มีเสียงดังผิดปกติ',      status:'in_progress', created_at:"datetime('now','-10 days')" },
      { room:'B102', title:'หลอดไฟทางเดินหน้าห้องดับ', desc:'ไฟดับมา 3 วันแล้ว กลัวอันตรายตอนกลางคืน', status:'completed',   created_at:"datetime('now','-15 days')" },
    ];
    for (const m of maintenanceItems) {
      const roomId = roomMap[m.room];
      if (!roomId) continue;
      db.prepare(`
        INSERT INTO maintenance_requests (room_id, title, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ${m.created_at}, ${m.created_at})
      `).run(roomId, m.title, m.desc, m.status);
    }
  })();
  console.log(`  ✅ สร้างแจ้งซ่อม 3 รายการ`);

  // ============================================================
  // Calendar events
  // ============================================================
  db.transaction(() => {
    const events = [
      { title:'ตรวจมิเตอร์น้ำ-ไฟทุกห้อง',     type:'meter_reading', days: 5 },
      { title:'สัญญาห้อง A103 ครบ 1 ปี',       type:'contract_expiry', days: 25 },
      { title:'นัดตรวจสอบแอร์ห้อง A201',       type:'maintenance', days: 2 },
    ];
    for (const e of events) {
      db.prepare(`
        INSERT INTO calendar_events (dormitory_id, title, event_type, event_date)
        VALUES (?, ?, ?, date('now','+${e.days} days'))
      `).run(dormId, e.title, e.type);
    }
  })();
  console.log(`  ✅ สร้าง calendar events 3 รายการ`);

  console.log(`\n🎉 Demo data ready!\n`);

} else if (tenantCount > 0) {
  console.log(`✅ Demo data: มีผู้เช่า ${tenantCount} คนอยู่แล้ว`);
}

// ============================================================
// Summary
// ============================================================
const stats = {
  rooms:   db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id=?').get(dormId).c,
  tenants: db.prepare('SELECT COUNT(*) as c FROM tenants t JOIN rooms r ON t.room_id=r.id WHERE r.dormitory_id=?').get(dormId).c,
  bills:   db.prepare('SELECT COUNT(*) as c FROM bills b JOIN rooms r ON b.room_id=r.id WHERE r.dormitory_id=?').get(dormId).c,
};

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏠  ${dormName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑  Admin Login URL:
    https://cyn-jewelry.com/RMS/admin

📧  Email:    ${adminEmail}
🔐  Password: ${adminPassword}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊  ข้อมูลใน Demo:
    🏠 ห้องทั้งหมด:  ${stats.rooms} ห้อง
    👤 ผู้เช่า:      ${stats.tenants} คน
    📋 บิลทั้งหมด:   ${stats.bills} ใบ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

process.exit(0);
