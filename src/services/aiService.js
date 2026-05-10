const fetch = require('node-fetch');
const db = require('../db/database');
const collectionService = require('./collectionService');
const { getBaseUrl } = require('../utils/url');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ============================================================
// IDENTIFY: tenant vs admin vs unknown
// ============================================================
function identifyUser(lineUserId, dormitoryId) {
  const adminLink = db.prepare(`
    SELECT au.id, au.name, au.email FROM admin_line_links al
    JOIN admin_users au ON al.admin_user_id = au.id
    WHERE al.line_user_id=? AND al.dormitory_id=?
  `).get(lineUserId, dormitoryId);
  if (adminLink) return { role: 'admin', admin: adminLink };

  const tenant = db.prepare(`
    SELECT t.*, r.room_number, r.room_code, r.building, r.floor, r.monthly_rent
    FROM tenants t JOIN rooms r ON t.room_id=r.id
    WHERE t.line_user_id=? AND r.dormitory_id=?
  `).get(lineUserId, dormitoryId);
  if (tenant) return { role: 'tenant', tenant };

  return { role: 'unknown' };
}

// ============================================================
// TENANT CONTEXT (rich data for AI/rules)
// ============================================================
function getTenantContext(tenant) {
  const latestBill = db.prepare(`
    SELECT * FROM bills WHERE room_id=? ORDER BY billing_month DESC LIMIT 1
  `).get(tenant.room_id);

  const liveBill = latestBill ? collectionService.computeLive(latestBill.id) : null;

  const billHistory = db.prepare(`
    SELECT billing_month, total_amount, status FROM bills WHERE room_id=?
    ORDER BY billing_month DESC LIMIT 6
  `).all(tenant.room_id);

  const pendingMaintenance = db.prepare(`
    SELECT title, status FROM maintenance_requests WHERE room_id=? AND status NOT IN ('completed','cancelled')
    ORDER BY created_at DESC
  `).all(tenant.room_id);

  return { tenant, latestBill: liveBill, billHistory, pendingMaintenance };
}

// ============================================================
// RULE-BASED for tenant (precise data)
// ============================================================
function tenantRuleAnswer(ctx, message) {
  const msg = message.toLowerCase().trim();
  const { tenant, latestBill, billHistory, pendingMaintenance } = ctx;
  const fmt = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ค่าน้ำ
  if (/ค่าน้ำ|น้ำเท่าไหร่|น้ำกี่บาท/.test(msg)) {
    if (!latestBill) return 'ยังไม่มีบิลในระบบค่ะ';
    return `💧 บิลเดือน ${latestBill.billing_month}\nค่าน้ำ ฿${fmt(latestBill.water_amount)} (${latestBill.water_units} หน่วย)`;
  }
  // ค่าไฟ
  if (/ค่าไฟ|ไฟเท่าไหร่|ไฟกี่บาท/.test(msg)) {
    if (!latestBill) return 'ยังไม่มีบิลในระบบค่ะ';
    return `⚡ บิลเดือน ${latestBill.billing_month}\nค่าไฟ ฿${fmt(latestBill.electric_amount)} (${latestBill.electric_units} หน่วย)`;
  }
  // ค่าเช่า / ยอดรวม / บิล
  if (/ค่าเช่า|ยอด|บิล|ทั้งหมด|รวม/.test(msg)) {
    if (!latestBill) return 'ยังไม่มีบิลในระบบค่ะ';
    const statusTh = { pending: 'รอชำระ', reviewing: 'กำลังตรวจสลิป', paid: 'ชำระแล้ว', overdue: 'เกินกำหนด' };
    let s = `📋 บิลเดือน ${latestBill.billing_month}\n`;
    s += `• ค่าเช่า ฿${fmt(latestBill.rent_amount)}\n`;
    s += `• ค่าน้ำ ฿${fmt(latestBill.water_amount)}\n`;
    s += `• ค่าไฟ ฿${fmt(latestBill.electric_amount)}\n`;
    if (latestBill.other_amount > 0) s += `• ${latestBill.other_label || 'อื่นๆ'} ฿${fmt(latestBill.other_amount)}\n`;
    if (latestBill.computed_late_fee > 0) s += `• ค่าปรับ ฿${fmt(latestBill.computed_late_fee)} (ช้า ${latestBill.days_overdue} วัน)\n`;
    s += `\n💰 รวม ฿${fmt(latestBill.computed_total)}\nสถานะ: ${statusTh[latestBill.status] || latestBill.status}`;
    if (latestBill.due_date) s += `\nกำหนด: ${latestBill.due_date}`;
    return s;
  }
  // ชำระแล้วหรือยัง
  if (/จ่ายไป|ชำระแล้ว|ชำระยัง|เงินถึง|ยืนยัน/.test(msg)) {
    if (!latestBill) return 'ยังไม่มีบิลในระบบค่ะ';
    if (latestBill.status === 'paid') return `✅ บิลเดือน ${latestBill.billing_month} ชำระเรียบร้อยแล้วค่ะ`;
    if (latestBill.status === 'reviewing') return `🔄 สลิปได้รับแล้ว แอดมินกำลังตรวจสอบค่ะ`;
    if (latestBill.status === 'overdue') return `⚠️ บิลเดือน ${latestBill.billing_month} เลยกำหนด ${latestBill.days_overdue} วัน ยอด ฿${fmt(latestBill.computed_total)}`;
    return `🔔 บิลเดือน ${latestBill.billing_month} ยังไม่ชำระค่ะ ยอด ฿${fmt(latestBill.computed_total)}`;
  }
  // กำหนดชำระเมื่อไหร่
  if (/กำหนด|ครบรอบ|วันสุดท้าย|เมื่อไหร่|เมื่อไร|due/.test(msg)) {
    if (!latestBill?.due_date) return 'ยังไม่ได้กำหนดวันชำระค่ะ';
    return `📅 บิลเดือน ${latestBill.billing_month} กำหนดชำระภายใน ${latestBill.due_date}\nยอด ฿${fmt(latestBill.computed_total)}`;
  }
  // ประวัติบิล
  if (/ประวัติ|ย้อนหลัง|history/.test(msg)) {
    if (!billHistory.length) return 'ยังไม่มีประวัติบิลค่ะ';
    const lines = billHistory.map(b => {
      const st = { pending: '🟡 รอ', paid: '✅ จ่าย', reviewing: '🔄 ตรวจ', overdue: '🔴 เกิน' }[b.status] || b.status;
      return `${b.billing_month}  ฿${fmt(b.total_amount)}  ${st}`;
    });
    return `📜 ประวัติบิล\n${lines.join('\n')}`;
  }
  // แจ้งซ่อม
  if (/ซ่อม|เสีย|พัง|รั่ว|ชำรุด/.test(msg)) {
    if (pendingMaintenance.length) {
      return `🔧 รายการแจ้งซ่อมที่ค้างอยู่:\n${pendingMaintenance.map(m => `• ${m.title} (${m.status})`).join('\n')}\n\nต้องการแจ้งเพิ่ม กดเมนู "แจ้งซ่อม" ค่ะ`;
    }
    return '🔧 หากต้องการแจ้งซ่อม กรุณากดเมนู "แจ้งซ่อม" หรือส่งรูปปัญหามาในแชทค่ะ';
  }
  // ทักทาย
  if (/สวัสดี|หวัดดี|hello|hi|ดีครับ|ดีค่ะ/.test(msg)) {
    return `สวัสดีค่ะ คุณ${tenant.display_name || ''} 😊\nห้อง ${tenant.room_code || tenant.room_number} มีอะไรให้ช่วยไหมคะ?\nลองพิมพ์: บิล • ค่าน้ำ • ค่าไฟ • กำหนดชำระ • ประวัติ • แจ้งซ่อม`;
  }

  return null; // ไม่มี rule ตรง → fallback AI
}

// ============================================================
// ADMIN COMMAND PARSER
// ============================================================
function parseAdminCommand(message) {
  const m = message.trim();

  // dashboard / สรุปวันนี้
  if (/^(สรุปวันนี้|dashboard|ภาพรวม)$/i.test(m)) return { cmd: 'daily_dashboard' };

  // ห้องว่าง
  if (/^(ห้องว่าง|vacant)$/i.test(m)) return { cmd: 'vacant_rooms' };

  // สลิปรอตรวจ
  if (/^(สลิป|สลิปรอตรวจ|pending|ตรวจสลิป)$/i.test(m)) return { cmd: 'pending_slips' };

  // ประกาศ "..."
  let mt = m.match(/^ประกาศ\s+(.+)/i);
  if (mt) return { cmd: 'broadcast', text: mt[1] };

  // เพิ่มห้อง XXX 4500
  mt = m.match(/^เพิ่มห้อง\s+([A-Za-z]?\d+)\s+(\d+)/i);
  if (mt) return { cmd: 'add_room', room_code: mt[1].toUpperCase(), rent: parseFloat(mt[2]) };

  // มิเตอร์ XXX น้ำ 105 ไฟ 1820
  mt = m.match(/มิเตอร์\s*([A-Za-z]?\d+)\s+น้ำ\s+(\d+)\s+ไฟ\s+(\d+)/i);
  if (mt) return { cmd: 'set_meter', room_code: mt[1].toUpperCase(), water: parseInt(mt[2]), electric: parseInt(mt[3]) };

  // อนุมัติสลิปทั้งหมด
  if (/^อนุมัติสลิปทั้งหมด$/i.test(m)) return { cmd: 'approve_all_slips' };

  // สร้างลิงค์ห้อง / สร้าง invite ห้อง
  mt = m.match(/(?:สร้าง.*?(?:ลิงค์|ลิงก์|invite).*?ห้อง|invite\s+room)\s*([A-Za-z]?\s*\d+)/i);
  if (mt) return { cmd: 'create_invite', room_code: mt[1].replace(/\s+/g, '').toUpperCase() };

  // ห้อง XXX ค้างชำระไหม / ดูบิล
  mt = m.match(/ห้อง\s*([A-Za-z]?\d+).*?(ค้าง|บิล|สถานะ|จ่าย)/i);
  if (mt) return { cmd: 'room_status', room_code: mt[1].toUpperCase() };

  // สรุปค้างชำระ / รายงานค้าง
  if (/สรุปค้าง|รายงานค้าง|ค้างชำระทั้งหมด|ค้างทั้งหมด|overdue/i.test(m)) {
    return { cmd: 'overdue_report' };
  }

  // ตามหนี้ห้อง XXX
  mt = m.match(/(?:ตามหนี้|เตือน|reminder).*?ห้อง\s*([A-Za-z]?\d+)/i);
  if (mt) return { cmd: 'send_reminder', room_code: mt[1].toUpperCase() };

  // help
  if (/^(help|ช่วยเหลือ|คำสั่ง|menu)$/i.test(m)) return { cmd: 'help' };

  return null;
}

async function executeAdminCommand(parsed, dormitoryId, adminId) {
  const fmt = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (parsed.cmd === 'help') {
    return [
      '🛠️ คำสั่งสำหรับแอดมิน:',
      '',
      '📊 ภาพรวม:',
      '• สรุปวันนี้ — Dashboard',
      '• ห้องว่าง — รายการห้องว่าง',
      '• สลิปรอตรวจ — รายการสลิปรอ',
      '• สรุปค้างชำระ — รายงานรวม',
      '',
      '🏠 จัดการห้อง:',
      '• เพิ่มห้อง A308 4500 — สร้างห้อง+ค่าเช่า',
      '• ห้อง A101 ค้างไหม — ดูสถานะ',
      '• สร้างลิงค์ห้อง A101',
      '• มิเตอร์ A101 น้ำ 105 ไฟ 1820',
      '',
      '💸 การเงิน:',
      '• ตามหนี้ห้อง A101 — ส่งเตือน',
      '• อนุมัติสลิปทั้งหมด',
      '',
      '📢 ประกาศ:',
      '• ประกาศ พรุ่งนี้น้ำไม่ไหล',
      '',
      '• help — แสดงคำสั่งนี้'
    ].join('\n');
  }

  if (parsed.cmd === 'daily_dashboard') {
    const broadcastService = require('./broadcastService');
    await broadcastService.sendDailyDashboard(dormitoryId, 'manual');
    return null; // sendDailyDashboard ส่ง flex เอง
  }

  if (parsed.cmd === 'vacant_rooms') {
    const list = db.prepare(`SELECT r.room_code, r.monthly_rent FROM rooms r
      WHERE r.dormitory_id=? AND r.id NOT IN (SELECT room_id FROM tenants)
      ORDER BY r.building, r.floor, r.room_number`).all(dormitoryId);
    if (!list.length) return '🎉 ไม่มีห้องว่าง — เต็มทุกห้อง!';
    return `🏠 ห้องว่าง ${list.length} ห้อง:\n${list.map(r => `• ${r.room_code} ฿${fmt(r.monthly_rent)}/ด.`).join('\n')}`;
  }

  if (parsed.cmd === 'pending_slips') {
    const list = db.prepare(`SELECT p.id, b.billing_month, r.room_code, t.display_name, p.amount
      FROM payments p JOIN bills b ON p.bill_id=b.id
      JOIN rooms r ON b.room_id=r.id LEFT JOIN tenants t ON r.id=t.room_id
      WHERE r.dormitory_id=? AND p.status='pending'
      ORDER BY p.created_at LIMIT 10`).all(dormitoryId);
    if (!list.length) return '✅ ไม่มีสลิปรอตรวจ';
    const baseUrl = getBaseUrl();
    return `📄 สลิปรอตรวจ ${list.length} ใบ:\n${list.map(p => `• ห้อง ${p.room_code} • ${p.billing_month} • ฿${fmt(p.amount)}`).join('\n')}\n\nตรวจที่: ${baseUrl}/admin/#payments`;
  }

  if (parsed.cmd === 'broadcast') {
    const broadcastService = require('./broadcastService');
    const r = await broadcastService.sendAnnouncementFlex(dormitoryId, {}, 'ประกาศจากเจ้าของหอ', parsed.text);
    return `📢 ส่งประกาศแล้ว ${r.sent}/${r.total} ห้อง`;
  }

  if (parsed.cmd === 'add_room') {
    const dormCheck = db.prepare('SELECT room_quota FROM dormitories WHERE id=?').get(dormitoryId);
    const used = db.prepare('SELECT COUNT(*) as c FROM rooms WHERE dormitory_id=?').get(dormitoryId).c;
    if (used >= (dormCheck?.room_quota || 30)) return `❌ เกินโควต้า ${dormCheck?.room_quota} ห้อง`;
    const code = parsed.room_code;
    const m = code.match(/^([A-Z]?)(\d)(\d+)$/);
    if (!m) return `❌ รูปแบบรหัสห้องไม่ถูกต้อง (ตัวอย่าง A101)`;
    const [, building, floor, roomNum] = m;
    try {
      db.prepare(`INSERT INTO rooms (dormitory_id, building, floor, room_number, room_code, monthly_rent, operational_status)
        VALUES (?,?,?,?,?,?, 'vacant')`).run(dormitoryId, building || 'A', parseInt(floor), roomNum, code, parsed.rent);
      return `✅ เพิ่มห้อง ${code} ค่าเช่า ฿${fmt(parsed.rent)} เรียบร้อย`;
    } catch (e) { return `❌ ${e.message}`; }
  }

  if (parsed.cmd === 'set_meter') {
    const room = db.prepare('SELECT * FROM rooms WHERE dormitory_id=? AND room_code=?').get(dormitoryId, parsed.room_code);
    if (!room) return `❌ ไม่พบห้อง ${parsed.room_code}`;
    const month = new Date().toISOString().slice(0, 7);
    const billingService = require('./billingService');
    try {
      const bill = billingService.createOrUpdateBill({
        roomId: room.id, dormitoryId, billingMonth: month,
        waterCurr: parsed.water, electricCurr: parsed.electric,
        otherAmount: 0, otherLabel: ''
      });
      return `✅ บันทึกมิเตอร์ห้อง ${parsed.room_code} เดือน ${month}\nน้ำ ${parsed.water} • ไฟ ${parsed.electric}\nบิลรวม ฿${fmt(bill.total_amount)}`;
    } catch (e) { return `❌ ${e.message}`; }
  }

  if (parsed.cmd === 'approve_all_slips') {
    const slips = db.prepare(`SELECT p.id FROM payments p
      JOIN bills b ON p.bill_id=b.id JOIN rooms r ON b.room_id=r.id
      WHERE r.dormitory_id=? AND p.status='pending'`).all(dormitoryId);
    let approved = 0;
    for (const s of slips) {
      try {
        db.prepare(`UPDATE payments SET status='approved', approved_at=datetime('now'), approved_by=? WHERE id=?`)
          .run(adminId, s.id);
        const p = db.prepare('SELECT bill_id FROM payments WHERE id=?').get(s.id);
        db.prepare(`UPDATE bills SET status='paid' WHERE id=?`).run(p.bill_id);
        approved++;
      } catch {}
    }
    return `✅ อนุมัติสลิปทั้งหมด ${approved}/${slips.length} ใบ`;
  }

  if (parsed.cmd === 'create_invite') {
    const room = db.prepare('SELECT * FROM rooms WHERE dormitory_id=? AND UPPER(room_code)=?')
      .get(dormitoryId, parsed.room_code);
    if (!room) return `❌ ไม่พบห้อง ${parsed.room_code}`;

    const { v4: uuidv4 } = require('uuid');
    db.prepare("UPDATE room_invites SET used_at=datetime('now') WHERE room_id=? AND used_at IS NULL").run(room.id);
    const token = uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO room_invites (room_id, token, expires_at) VALUES (?,?,?)').run(room.id, token, expiresAt);
    const baseUrl = getBaseUrl();
    return `✅ สร้างลิงก์ห้อง ${room.room_code} แล้ว\n\n${baseUrl}/join/${token}\n\nหมดอายุ ${expiresAt.slice(0,10)} (ใช้ได้ครั้งเดียว)`;
  }

  if (parsed.cmd === 'room_status') {
    const room = db.prepare('SELECT * FROM rooms WHERE dormitory_id=? AND UPPER(room_code)=?')
      .get(dormitoryId, parsed.room_code);
    if (!room) return `❌ ไม่พบห้อง ${parsed.room_code}`;
    const tenant = db.prepare('SELECT display_name, phone FROM tenants WHERE room_id=?').get(room.id);
    const bill = db.prepare('SELECT * FROM bills WHERE room_id=? ORDER BY billing_month DESC LIMIT 1').get(room.id);
    let s = `🏠 ห้อง ${room.room_code}\n`;
    s += tenant ? `ผู้เช่า: ${tenant.display_name || '-'}${tenant.phone ? ' ('+tenant.phone+')' : ''}\n` : 'ผู้เช่า: ว่าง\n';
    if (!bill) return s + 'ยังไม่มีบิล';
    const live = collectionService.computeLive(bill.id);
    const statusTh = { pending: 'รอชำระ', reviewing: 'รอตรวจสลิป', paid: 'ชำระแล้ว', overdue: 'เกินกำหนด' };
    s += `บิลล่าสุด: ${bill.billing_month}\n`;
    s += `ยอด: ฿${fmt(live.computed_total)}\n`;
    s += `สถานะ: ${statusTh[bill.status]}`;
    if (live.days_overdue > 0) s += ` (ค้าง ${live.days_overdue} วัน, ค่าปรับ ฿${fmt(live.computed_late_fee)})`;
    return s;
  }

  if (parsed.cmd === 'overdue_report') {
    const overdue = collectionService.getOverdueBills(dormitoryId);
    if (!overdue.length) return '✅ ไม่มีบิลค้างชำระ';
    const lines = overdue.slice(0, 20).map(b =>
      `• ห้อง ${b.room_code || b.room_number}: ค้าง ${b.days_overdue} วัน ฿${fmt(b.computed_total)}`
    );
    let s = `📊 บิลค้างชำระ ${overdue.length} ห้อง\n${lines.join('\n')}`;
    if (overdue.length > 20) s += `\n... และอีก ${overdue.length - 20} ห้อง`;
    const total = overdue.reduce((sum, b) => sum + b.computed_total, 0);
    s += `\n\n💰 รวมยอดค้าง ฿${fmt(total)}`;
    return s;
  }

  if (parsed.cmd === 'send_reminder') {
    const room = db.prepare('SELECT * FROM rooms WHERE dormitory_id=? AND UPPER(room_code)=?')
      .get(dormitoryId, parsed.room_code);
    if (!room) return `❌ ไม่พบห้อง ${parsed.room_code}`;
    const tenant = db.prepare('SELECT line_user_id, display_name FROM tenants WHERE room_id=?').get(room.id);
    if (!tenant?.line_user_id) return `❌ ห้อง ${parsed.room_code} ยังไม่มีผู้เช่าผูก LINE`;
    const bill = db.prepare("SELECT * FROM bills WHERE room_id=? AND status IN ('pending','overdue') ORDER BY billing_month DESC LIMIT 1").get(room.id);
    if (!bill) return `✅ ห้อง ${room.room_code} ไม่มีบิลค้าง`;
    const live = collectionService.computeLive(bill.id);
    const policy = collectionService.getPolicy(dormitoryId);
    const tpl = policy.reminder1_template || 'บิล {month} ห้อง {room} ยอด ฿{total} ครบกำหนดแล้วค่ะ';
    const text = tpl
      .replace('{month}', bill.billing_month)
      .replace('{room}', room.room_code)
      .replace('{total}', fmt(live.computed_total))
      .replace('{late_fee}', fmt(live.computed_late_fee))
      .replace('{days}', live.days_overdue);
    const lineService = require('./lineService');
    await lineService.pushMessage(dormitoryId, tenant.line_user_id, { type: 'text', text });
    db.prepare("INSERT INTO collection_logs (bill_id, stage, days_overdue, message_sent, sent_by) VALUES (?,?,?,?,?)")
      .run(bill.id, 'manual', live.days_overdue, text, `admin:${adminId}`);
    return `✅ ส่งข้อความเตือนห้อง ${room.room_code} แล้ว`;
  }

  return null;
}

// ============================================================
// MAIN: process incoming LINE message
// ============================================================
async function processMessage(lineUserId, dormitoryId, userMessage) {
  const id = identifyUser(lineUserId, dormitoryId);

  // Admin path
  if (id.role === 'admin') {
    const parsed = parseAdminCommand(userMessage);
    if (parsed) {
      const out = await executeAdminCommand(parsed, dormitoryId, id.admin.id);
      if (out) return out;
    }
    return [
      `สวัสดีค่ะแอดมิน ${id.admin.name}`,
      '',
      'ลองพิมพ์: help — เพื่อดูคำสั่งทั้งหมด',
      '',
      'ตัวอย่าง:',
      '• สร้างลิงค์ห้อง A307',
      '• ห้อง B202 ค้างชำระไหม',
      '• สรุปค้างชำระ'
    ].join('\n');
  }

  // Unknown user
  if (id.role === 'unknown') {
    return 'ยังไม่พบข้อมูลในระบบค่ะ\nหากเป็นลูกบ้าน — ขอ Invite Link จากแอดมินเพื่อลงทะเบียนห้อง\nหากเป็นแอดมิน — ลิงก์ LINE กับบัญชีแอดมินในหน้าตั้งค่าระบบ';
  }

  // Tenant path
  const ctx = getTenantContext(id.tenant);
  const ruleAnswer = tenantRuleAnswer(ctx, userMessage);
  if (ruleAnswer) return ruleAnswer;

  // Fallback: AI
  if (!GEMINI_API_KEY) {
    return 'ขอบคุณค่ะ ลองพิมพ์: บิล • ค่าน้ำ • ค่าไฟ • กำหนดชำระ • ประวัติ • แจ้งซ่อม';
  }

  const dorm = db.prepare('SELECT name FROM dormitories WHERE id=?').get(dormitoryId);
  const fmt = n => Number(n || 0).toFixed(2);
  let sys = `คุณคือ AI ของหอพัก "${dorm?.name}" ตอบลูกบ้านเป็นภาษาไทย กระชับ เป็นกันเอง ห้ามแต่งข้อมูลที่ไม่ได้ให้มา\n\n`;
  sys += `ข้อมูลผู้เช่า: ${ctx.tenant.display_name || ''} ห้อง ${ctx.tenant.room_code || ctx.tenant.room_number}`;
  if (ctx.latestBill) {
    sys += `\nบิลล่าสุด: เดือน ${ctx.latestBill.billing_month} ยอด ฿${fmt(ctx.latestBill.computed_total)} สถานะ ${ctx.latestBill.status}`;
    if (ctx.latestBill.days_overdue > 0) sys += ` (ค้าง ${ctx.latestBill.days_overdue} วัน)`;
  }

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: sys }] },
          { role: 'model', parts: [{ text: 'รับทราบค่ะ' }] },
          { role: 'user', parts: [{ text: userMessage }] }
        ],
        generationConfig: { maxOutputTokens: 500, temperature: 0.5 }
      })
    });
    if (!res.ok) return 'ขออภัยค่ะ ลองพิมพ์คำสั่งสั้นๆ เช่น "บิล" หรือ "ค่าไฟ" ดูนะคะ';
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'ขออภัยค่ะ ไม่เข้าใจคำถาม';
  } catch {
    return 'ขออภัยค่ะ ลองพิมพ์ "บิล" เพื่อดูยอดล่าสุด หรือ "แจ้งซ่อม" ได้เลยค่ะ';
  }
}

module.exports = { processMessage, identifyUser, parseAdminCommand };
