const db = require('../db/database');
const lineService = require('./lineService');

// ============================================================
// BROADCAST: ส่งข้อความถึงลูกบ้านหลายคนพร้อมกัน
// ============================================================

// เลือกลูกบ้านตามเงื่อนไข
function selectTenants(dormitoryId, filter = {}) {
  let q = `SELECT t.line_user_id, t.display_name, r.room_code, r.room_number, r.building, r.floor
    FROM tenants t JOIN rooms r ON t.room_id=r.id
    WHERE r.dormitory_id=? AND t.line_user_id IS NOT NULL AND t.line_user_id NOT LIKE 'pending%'`;
  const p = [dormitoryId];
  if (filter.building) { q += ' AND r.building=?'; p.push(filter.building); }
  if (filter.floor)    { q += ' AND r.floor=?'; p.push(filter.floor); }
  if (filter.room_id)  { q += ' AND r.id=?'; p.push(filter.room_id); }
  if (filter.overdue) {
    q += ` AND r.id IN (SELECT room_id FROM bills WHERE status IN ('pending','overdue') AND due_date < date('now'))`;
  }
  return db.prepare(q).all(...p);
}

// ส่งข้อความ broadcast
async function broadcast(dormitoryId, filter, messages, options = {}) {
  const tenants = selectTenants(dormitoryId, filter);
  if (!tenants.length) return { sent: 0, total: 0, errors: [] };

  let sent = 0, errors = [];
  for (const t of tenants) {
    try {
      await lineService.pushMessage(dormitoryId, t.line_user_id, messages);
      sent++;
      // log
      db.prepare(`INSERT INTO chat_logs (dormitory_id, line_user_id, direction, message_type, content)
        VALUES (?,?,?,?,?)`).run(
        dormitoryId, t.line_user_id, 'out', 'broadcast',
        typeof messages === 'object' ? (messages.text || messages.altText || 'flex') : String(messages)
      );
    } catch (e) {
      errors.push({ user: t.line_user_id, room: t.room_code, error: e.message });
    }
    // rate limit: 50ms between sends to be safe
    if (options.rateLimitMs !== 0) await new Promise(r => setTimeout(r, options.rateLimitMs || 100));
  }

  return { sent, total: tenants.length, errors, recipients: tenants.map(t => t.room_code) };
}

// ส่งประกาศแบบข้อความ (มี emoji หัวข้อ)
async function sendAnnouncement(dormitoryId, filter, title, body) {
  const dorm = db.prepare('SELECT name FROM dormitories WHERE id=?').get(dormitoryId);
  const text = `📢 ประกาศจาก ${dorm?.name || 'หอพัก'}\n\n${title}\n${'━'.repeat(15)}\n${body}`;
  return broadcast(dormitoryId, filter, { type: 'text', text });
}

// ส่ง Flex card สวยๆ
async function sendAnnouncementFlex(dormitoryId, filter, title, body) {
  const dorm = db.prepare('SELECT name FROM dormitories WHERE id=?').get(dormitoryId);
  const flex = {
    type: 'flex',
    altText: `📢 ${title}`,
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: '#06C755' } },
      header: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: '📢 ประกาศ', color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: dorm?.name || 'หอพัก', color: '#ddffdd', size: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: title, size: 'lg', weight: 'bold', wrap: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: body, size: 'sm', wrap: true, color: '#444444', margin: 'md' },
          { type: 'text', text: new Date().toLocaleString('th-TH'), size: 'xs', color: '#aaaaaa', margin: 'md' }
        ]
      }
    }
  };
  return broadcast(dormitoryId, filter, flex);
}

// ============================================================
// DAILY DASHBOARD: สรุปข้อมูลส่งให้ Owner
// ============================================================
async function sendDailyDashboard(dormitoryId, when = 'morning') {
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormitoryId);
  if (!dorm) return { skipped: true };

  const admins = db.prepare(`SELECT line_user_id FROM admin_line_links WHERE dormitory_id=?`).all(dormitoryId);
  if (!admins.length) return { skipped: true, reason: 'no_admin_linked' };

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  // Stats
  const rooms = db.prepare(`SELECT COUNT(*) as total,
    SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) as occupied
    FROM rooms r LEFT JOIN tenants t ON r.id=t.room_id WHERE r.dormitory_id=?`).get(dormitoryId);

  const overdue = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(b.total_amount),0) as total
    FROM bills b JOIN rooms r ON b.room_id=r.id
    WHERE r.dormitory_id=? AND b.status IN ('pending','overdue') AND b.due_date < ?`).get(dormitoryId, today);

  const pendingSlips = db.prepare(`SELECT COUNT(*) as c FROM payments p
    JOIN bills b ON p.bill_id=b.id JOIN rooms r ON b.room_id=r.id
    WHERE r.dormitory_id=? AND p.status='pending'`).get(dormitoryId);

  const newMaint = db.prepare(`SELECT COUNT(*) as c FROM maintenance_requests mr
    JOIN rooms r ON mr.room_id=r.id
    WHERE r.dormitory_id=? AND mr.status='pending'`).get(dormitoryId);

  const todayRevenue = db.prepare(`SELECT COALESCE(SUM(p.amount),0) as total FROM payments p
    JOIN bills b ON p.bill_id=b.id JOIN rooms r ON b.room_id=r.id
    WHERE r.dormitory_id=? AND p.status='approved' AND date(p.approved_at)=?`).get(dormitoryId, today);

  const monthRevenue = db.prepare(`SELECT COALESCE(SUM(p.amount),0) as total FROM payments p
    JOIN bills b ON p.bill_id=b.id JOIN rooms r ON b.room_id=r.id
    WHERE r.dormitory_id=? AND p.status='approved' AND strftime('%Y-%m', p.approved_at)=?`).get(dormitoryId, month);

  const fmt = n => Number(n||0).toLocaleString('th-TH');
  const greeting = when === 'morning' ? '🌅 สวัสดีตอนเช้า!' : when === 'evening' ? '🌆 สรุปประจำวัน' : '📊 สรุปข้อมูล';

  const flex = {
    type: 'flex',
    altText: `${greeting} ${dorm.name}`,
    contents: {
      type: 'bubble', size: 'mega',
      styles: { header: { backgroundColor: '#06C755' }, footer: { backgroundColor: '#f8f9fa' } },
      header: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: greeting, color: '#ffffff', size: 'sm' },
          { type: 'text', text: dorm.name, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: new Date().toLocaleDateString('th-TH', { dateStyle: 'long' }), color: '#ddffdd', size: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          {
            type: 'box', layout: 'horizontal', contents: [
              statBox('🏠', 'ห้องว่าง', `${rooms.total - rooms.occupied}/${rooms.total}`, '#3b82f6'),
              statBox('💰', 'รายรับวันนี้', `฿${fmt(todayRevenue.total)}`, '#10b981')
            ]
          },
          {
            type: 'box', layout: 'horizontal', contents: [
              statBox('⚠️', 'ค้างชำระ', `${overdue.count} ห้อง`, '#ef4444'),
              statBox('📊', 'รายรับเดือน', `฿${fmt(monthRevenue.total)}`, '#8b5cf6')
            ]
          },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: [
              row('💸 ยอดค้างรวม', `฿${fmt(overdue.total)}`),
              row('📄 สลิปรอตรวจ', `${pendingSlips.c} ใบ`),
              row('🔧 แจ้งซ่อมใหม่', `${newMaint.c} รายการ`)
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: 'พิมพ์ "help" เพื่อดูคำสั่ง', size: 'xs', color: '#888888', align: 'center' }
        ]
      }
    }
  };

  let sent = 0;
  for (const a of admins) {
    try { await lineService.pushMessage(dormitoryId, a.line_user_id, flex); sent++; } catch {}
  }
  return { sent, total: admins.length };
}

function statBox(icon, label, value, color) {
  return {
    type: 'box', layout: 'vertical', flex: 1, spacing: 'xs', contents: [
      { type: 'text', text: icon, size: 'lg', align: 'center' },
      { type: 'text', text: label, size: 'xs', align: 'center', color: '#888888' },
      { type: 'text', text: value, size: 'md', align: 'center', weight: 'bold', color }
    ]
  };
}
function row(label, value) {
  return {
    type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: label, size: 'sm', flex: 3 },
      { type: 'text', text: value, size: 'sm', align: 'end', weight: 'bold', flex: 2 }
    ]
  };
}

module.exports = {
  selectTenants,
  broadcast, sendAnnouncement, sendAnnouncementFlex,
  sendDailyDashboard
};
