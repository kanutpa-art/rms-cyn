/**
 * seed.js — สร้างข้อมูลเริ่มต้น (หอพัก + admin account)
 * รัน: node scripts/seed.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db/database');

const dormName = process.env.DORMITORY_NAME || 'หอพักตัวอย่าง';
const adminName = process.env.ADMIN_NAME || 'แอดมิน';
const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';

console.log('\n🌱 Seeding database...\n');

// ============================================================
// 1. สร้าง Dormitory
// ============================================================
const existingDorm = db.prepare('SELECT id FROM dormitories WHERE name = ?').get(dormName);

let dormId;
if (existingDorm) {
  dormId = existingDorm.id;
  console.log(`✅ Dormitory already exists: "${dormName}" (id: ${dormId})`);
} else {
  const result = db.prepare(`
    INSERT INTO dormitories (name, water_rate, electric_rate,
      line_channel_id, line_channel_secret, line_channel_access_token, liff_id)
    VALUES (?, 18, 8, ?, ?, ?, ?)
  `).run(
    dormName,
    process.env.LINE_CHANNEL_ID || '',
    process.env.LINE_CHANNEL_SECRET || '',
    process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    process.env.LIFF_ID || ''
  );
  dormId = result.lastInsertRowid;
  console.log(`✅ Created dormitory: "${dormName}" (id: ${dormId})`);
}

// ============================================================
// 2. สร้าง Admin User
// ============================================================
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(adminEmail);

if (existingAdmin) {
  console.log(`✅ Admin already exists: ${adminEmail}`);
} else {
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(`
    INSERT INTO admin_users (dormitory_id, name, email, password_hash)
    VALUES (?, ?, ?, ?)
  `).run(dormId, adminName, adminEmail, hash);
  console.log(`✅ Created admin: ${adminEmail} / ${adminPassword}`);
}

// ============================================================
// 3. สร้างห้องตัวอย่าง (ถ้ายังไม่มี)
// ============================================================
const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id = ?').get(dormId);

if (roomCount.c === 0) {
  const sampleRooms = [
    { building: 'A', floor: 1, room_number: '01', monthly_rent: 3500 },
    { building: 'A', floor: 1, room_number: '02', monthly_rent: 3500 },
    { building: 'A', floor: 2, room_number: '01', monthly_rent: 4000 },
    { building: 'A', floor: 2, room_number: '02', monthly_rent: 4000 },
    { building: 'A', floor: 3, room_number: '07', monthly_rent: 4500 },
    { building: 'B', floor: 1, room_number: '01', monthly_rent: 3800 },
    { building: 'B', floor: 2, room_number: '02', monthly_rent: 4200 },
  ];

  for (const r of sampleRooms) {
    const code = `${r.building}${r.floor}${r.room_number}`;
    db.prepare(`
      INSERT INTO rooms (dormitory_id, building, floor, room_number, room_code, monthly_rent, initial_water_meter, initial_electric_meter)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    `).run(dormId, r.building, r.floor, r.room_number, code, r.monthly_rent);
  }
  console.log(`✅ Created ${sampleRooms.length} sample rooms (multi-building)`);
} else {
  console.log(`✅ Rooms already exist (${roomCount.c} rooms)`);
}

// ============================================================
// 4. ตั้งค่า default collection policy & contract template
// ============================================================
const collectionService = require('../src/services/collectionService');
const contractService = require('../src/services/contractService');
collectionService.getPolicy(dormId);
contractService.ensureDefaultTemplate(dormId);
console.log('✅ Initialized default collection policy & contract template');

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏠 Seed completed!

Admin Login:
  Email:    ${adminEmail}
  Password: ${adminPassword}

Admin Panel: http://localhost:${process.env.PORT || 3000}/admin

LINE Webhook URL (กรอกใน LINE Developers Console):
  http://localhost:${process.env.PORT || 3000}/line/webhook/${dormId}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
