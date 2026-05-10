const router = require('express').Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const lineService = require('../services/lineService');
const aiService = require('../services/aiService');
const { getBaseUrl } = require('../utils/url');

// ============================================================
// Webhook จาก LINE
// ============================================================
router.post('/webhook/:dormId', express_raw_body, async (req, res) => {
  const dormitoryId = parseInt(req.params.dormId);
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id = ?').get(dormitoryId);

  if (!dorm) return res.status(404).send('Not found');

  if (!verifySignature(req.rawBody, dorm.line_channel_secret, req.headers['x-line-signature'])) {
    return res.status(403).send('Invalid signature');
  }

  const events = req.body.events || [];
  res.status(200).send('OK');

  for (const event of events) {
    try { await handleEvent(event, dorm); }
    catch (err) { console.error('Webhook event error:', err.message); }
  }
});

// ============================================================
// Tenant Invite Link join
// ============================================================
router.post('/join/:token', async (req, res) => {
  const { token } = req.params;
  const { lineUserId, displayName, pictureUrl, phone } = req.body;
  if (!lineUserId) return res.status(400).json({ error: 'Missing LINE user ID' });

  const invite = db.prepare(`
    SELECT ri.*, r.dormitory_id FROM room_invites ri
    JOIN rooms r ON ri.room_id = r.id
    WHERE ri.token = ? AND ri.used_at IS NULL AND ri.expires_at > datetime('now')
  `).get(token);

  if (!invite) return res.status(410).json({ error: 'ลิงก์หมดอายุหรือถูกใช้แล้ว' });
  const existing = db.prepare('SELECT id FROM tenants WHERE room_id = ?').get(invite.room_id);
  if (existing) return res.status(409).json({ error: 'ห้องนี้มีการลงทะเบียนแล้ว' });
  const dupLine = db.prepare('SELECT id FROM tenants WHERE line_user_id = ?').get(lineUserId);
  if (dupLine) return res.status(409).json({ error: 'LINE บัญชีนี้ผูกกับห้องอื่นแล้ว' });

  db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO tenants (room_id, line_user_id, display_name, picture_url, phone, contract_start_date)
      VALUES (?, ?, ?, ?, ?, date('now'))
    `).run(invite.room_id, lineUserId, displayName || '', pictureUrl || '', phone || '');
    db.prepare("UPDATE room_invites SET used_at = datetime('now') WHERE id = ?").run(invite.id);
    // ถ้ามี deposit_amount เริ่มต้นใน rooms — ใส่ deposit transaction (default = 1 เดือนค่าเช่า)
    const room = db.prepare('SELECT monthly_rent FROM rooms WHERE id=?').get(invite.room_id);
    const depositAmount = room?.monthly_rent || 0;
    if (depositAmount > 0) {
      db.prepare(`INSERT INTO deposit_transactions (tenant_id, type, amount, description)
        VALUES (?,'deposit',?,?)`).run(ins.lastInsertRowid, depositAmount, 'เงินประกันแรกเข้า');
    }
  })();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(invite.room_id);
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id = ?').get(invite.dormitory_id);

  await lineService.pushMessage(invite.dormitory_id, lineUserId, {
    type: 'text',
    text: [
      `🏠 ยินดีต้อนรับสู่ ${dorm?.name || 'หอพัก'}!`,
      `ลงทะเบียนห้อง ${room.room_code || room.room_number} เรียบร้อยแล้ว`,
      ``, `เมนูด่วน:`, `📋 พิมพ์ "บิล" — ดูยอด`,
      `💧 พิมพ์ "ค่าน้ำ" / "ค่าไฟ"`,
      `📅 พิมพ์ "กำหนดชำระ"`, `🔧 พิมพ์ "แจ้งซ่อม"`
    ].join('\n')
  });

  res.json({ success: true, room_number: room.room_code || room.room_number });
});

// ============================================================
// Admin LINE Link: ผูก LINE ของ admin → admin_line_links
// ============================================================
router.post('/admin-link/:token', async (req, res) => {
  const { token } = req.params;
  const { lineUserId, dormitoryId } = req.body;
  if (!lineUserId || !dormitoryId) return res.status(400).json({ error: 'Missing data' });

  const link = db.prepare(`
    SELECT * FROM admin_link_tokens WHERE token=? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(token);
  if (!link) return res.status(410).json({ error: 'ลิงก์หมดอายุหรือถูกใช้แล้ว' });

  const admin = db.prepare('SELECT * FROM admin_users WHERE id=?').get(link.admin_user_id);
  if (!admin || admin.dormitory_id !== parseInt(dormitoryId)) {
    return res.status(403).json({ error: 'Token ไม่ตรงกับหอพัก' });
  }

  db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO admin_line_links (admin_user_id, dormitory_id, line_user_id) VALUES (?,?,?)`)
      .run(admin.id, admin.dormitory_id, lineUserId);
    db.prepare("UPDATE admin_link_tokens SET used_at=datetime('now') WHERE id=?").run(link.id);
    db.prepare("UPDATE admin_users SET line_user_id=? WHERE id=?").run(lineUserId, admin.id);
  })();

  await lineService.pushMessage(admin.dormitory_id, lineUserId, {
    type: 'text',
    text: `✅ ผูก LINE กับบัญชีแอดมิน "${admin.name}" เรียบร้อย\n\nพิมพ์ "help" เพื่อดูคำสั่งสำหรับแอดมินค่ะ`
  });

  res.json({ success: true, admin_name: admin.name });
});

// ============================================================
// Event handlers
// ============================================================
async function handleEvent(event, dorm) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'message') {
    db.prepare('INSERT INTO chat_logs (dormitory_id, line_user_id, direction, message_type, content) VALUES (?,?,?,?,?)')
      .run(dorm.id, userId, 'in', event.message.type, event.message.text || event.message.id);
  }

  if (event.type === 'follow') {
    const id = aiService.identifyUser(userId, dorm.id);
    const richMenuService = require('../services/richMenuService');

    // Auto-link rich menu by role
    try { await richMenuService.autoLinkMenuByRole(dorm.id, userId); } catch {}

    if (id.role === 'admin') {
      await lineService.replyMessage(event.replyToken, dorm.id, [
        { type:'text', text: `🎉 สวัสดีค่ะแอดมิน ${id.admin.name}!` },
        ownerWelcomeFlex(dorm)
      ]);
    } else if (id.role === 'tenant') {
      await lineService.replyMessage(event.replyToken, dorm.id, [
        { type:'text', text: `สวัสดีค่ะ คุณ${id.tenant.display_name || ''} ห้อง ${id.tenant.room_code || id.tenant.room_number} 😊` },
        tenantWelcomeFlex(dorm, id.tenant)
      ]);
    } else {
      await lineService.replyMessage(event.replyToken, dorm.id, [
        { type:'text', text: `🎉 ยินดีต้อนรับสู่ ${dorm.name}!` },
        unknownWelcomeFlex(dorm)
      ]);
    }
    return;
  }

  if (event.type === 'message') {
    if (event.message.type === 'text') await handleTextMessage(event, dorm, userId);
    else if (event.message.type === 'image') await handleImageMessage(event, dorm, userId);
  }
}

async function handleTextMessage(event, dorm, userId) {
  const text = event.message.text?.trim();
  const reply = await aiService.processMessage(userId, dorm.id, text);
  await lineService.replyMessage(event.replyToken, dorm.id, { type: 'text', text: reply });
  db.prepare('INSERT INTO chat_logs (dormitory_id, line_user_id, direction, message_type, content) VALUES (?,?,?,?,?)')
    .run(dorm.id, userId, 'out', 'text', reply);
}

async function handleImageMessage(event, dorm, userId) {
  const tenant = db.prepare(`
    SELECT t.*, r.id as room_id, r.room_number, r.room_code FROM tenants t
    JOIN rooms r ON t.room_id = r.id
    WHERE t.line_user_id = ? AND r.dormitory_id = ?
  `).get(userId, dorm.id);

  if (!tenant) {
    await lineService.replyMessage(event.replyToken, dorm.id, {
      type: 'text', text: 'ยังไม่พบข้อมูลห้องของคุณค่ะ กรุณาติดต่อแอดมิน'
    });
    return;
  }

  const imageBuffer = await lineService.downloadImage(dorm.id, event.message.id);
  if (!imageBuffer) {
    await lineService.replyMessage(event.replyToken, dorm.id, { type: 'text', text: 'ไม่สามารถรับรูปภาพได้ กรุณาลองใหม่ค่ะ' });
    return;
  }

  const filename = `slip_${Date.now()}_${userId}.jpg`;
  const slipDir = path.join(__dirname, '../../uploads/slips');
  if (!fs.existsSync(slipDir)) fs.mkdirSync(slipDir, { recursive: true });
  fs.writeFileSync(path.join(slipDir, filename), imageBuffer);

  const bill = db.prepare(`
    SELECT * FROM bills WHERE room_id = ? AND status IN ('pending','overdue') ORDER BY billing_month DESC LIMIT 1
  `).get(tenant.room_id);

  if (!bill) {
    await lineService.replyMessage(event.replyToken, dorm.id, { type: 'text', text: 'ได้รับรูปแล้วค่ะ แต่ไม่พบบิลที่รอชำระอยู่' });
    return;
  }

  db.prepare(`
    INSERT INTO payments (bill_id, amount, method, slip_path, slip_line_message_id, status, paid_at)
    VALUES (?, ?, 'transfer', ?, ?, 'pending', datetime('now'))
  `).run(bill.id, bill.total_amount, `uploads/slips/${filename}`, event.message.id);
  db.prepare('UPDATE bills SET status = ? WHERE id = ?').run('reviewing', bill.id);

  await lineService.replyMessage(event.replyToken, dorm.id, {
    type: 'text',
    text: `✅ รับสลิปเรียบร้อย\nห้อง ${tenant.room_code || tenant.room_number} บิลเดือน ${bill.billing_month}\n\nแอดมินจะตรวจสอบภายใน 24 ชม.`
  });
}

function express_raw_body(req, res, next) {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    req.body = JSON.parse(data || '{}');
    next();
  });
}

function verifySignature(body, secret, signature) {
  if (!secret || !signature) return process.env.NODE_ENV !== 'production';
  const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

// ============================================================
// WELCOME FLEX MESSAGES
// ============================================================
function tenantWelcomeFlex(dorm, tenant) {
  const liffUrl = dorm.liff_id ? `https://liff.line.me/${dorm.liff_id}` : '';
  return {
    type: 'flex', altText: 'เมนูหลัก',
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: '#06C755' } },
      header: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: dorm.name, color: '#ffffff', size: 'sm' },
          { type: 'text', text: `ห้อง ${tenant.room_code || tenant.room_number}`, color: '#ffffff', size: 'lg', weight: 'bold' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: 'พิมพ์คำต่อไปนี้เพื่อใช้งาน:', size: 'sm', wrap: true },
          { type: 'text', text: '📋 บิล — ดูยอดเดือนนี้', size: 'sm', color: '#06C755' },
          { type: 'text', text: '💧 ค่าน้ำ / ⚡ ค่าไฟ', size: 'sm', color: '#06C755' },
          { type: 'text', text: '📅 กำหนดชำระ', size: 'sm', color: '#06C755' },
          { type: 'text', text: '🔧 แจ้งซ่อม', size: 'sm', color: '#06C755' },
          { type: 'text', text: '📜 ประวัติบิล', size: 'sm', color: '#06C755' }
        ]
      },
      footer: liffUrl ? {
        type: 'box', layout: 'vertical', contents: [{
          type: 'button', style: 'primary', color: '#06C755',
          action: { type: 'uri', label: '📱 เปิดแอปลูกบ้าน', uri: liffUrl }
        }]
      } : undefined
    }
  };
}

function ownerWelcomeFlex(dorm) {
  const baseUrl = getBaseUrl();
  return {
    type: 'flex', altText: 'เมนูเจ้าของหอ',
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: '#06C755' } },
      header: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: '👑 เจ้าของหอ', color: '#ffffff', size: 'sm' },
          { type: 'text', text: dorm.name, color: '#ffffff', size: 'lg', weight: 'bold' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: 'คำสั่งสำหรับแอดมิน:', size: 'sm', weight: 'bold' },
          { type: 'text', text: '📊 สรุปวันนี้ — Dashboard', size: 'sm', color: '#06C755' },
          { type: 'text', text: '🏠 ห้องว่าง — รายการห้องว่าง', size: 'sm', color: '#06C755' },
          { type: 'text', text: '⚠️ สรุปค้างชำระ', size: 'sm', color: '#06C755' },
          { type: 'text', text: '📄 สลิปรอตรวจ', size: 'sm', color: '#06C755' },
          { type: 'text', text: '📢 ประกาศ ... — broadcast', size: 'sm', color: '#06C755' },
          { type: 'text', text: '🔗 สร้างลิงค์ห้อง A101', size: 'sm', color: '#06C755' },
          { type: 'text', text: 'ตามหนี้ห้อง A101', size: 'sm', color: '#06C755' },
          { type: 'text', text: 'help — คำสั่งทั้งหมด', size: 'sm', color: '#888888' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [{
          type: 'button', style: 'primary', color: '#06C755',
          action: { type: 'uri', label: '⚙️ เปิด Admin Panel', uri: `${baseUrl}/admin` }
        }]
      }
    }
  };
}

function unknownWelcomeFlex(dorm) {
  return {
    type: 'flex', altText: 'ยินดีต้อนรับ',
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: '#06C755' } },
      header: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: '🎉 ยินดีต้อนรับ', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: dorm.name, color: '#ffffff', size: 'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: 'คุณยังไม่ได้ลงทะเบียน', size: 'lg', weight: 'bold', wrap: true },
          { type: 'separator' },
          { type: 'text', text: '👤 หากเป็นลูกบ้าน:', size: 'sm', weight: 'bold' },
          { type: 'text', text: 'ขอ "Invite Link" จากเจ้าของหอ → คลิกลิงก์ → ลงทะเบียน', size: 'sm', wrap: true, color: '#666666' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '👑 หากเป็นเจ้าของหอ:', size: 'sm', weight: 'bold' },
          { type: 'text', text: 'เปิด Admin Panel → ตั้งค่า → ผูก LINE ของคุณ', size: 'sm', wrap: true, color: '#666666' }
        ]
      }
    }
  };
}

module.exports = router;
