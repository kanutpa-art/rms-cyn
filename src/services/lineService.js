const fetch = require('node-fetch');
const db = require('../db/database');

const LINE_API = 'https://api.line.me/v2/bot';

// ดึง channel access token ของหอพักนั้น
function getToken(dormitoryId) {
  const dorm = db.prepare('SELECT line_channel_access_token FROM dormitories WHERE id = ?').get(dormitoryId);
  return dorm?.line_channel_access_token;
}

// ส่งข้อความ push ไปหา LINE user
async function pushMessage(dormitoryId, userId, messages) {
  const token = getToken(dormitoryId);
  if (!token || !userId) return;

  const payload = {
    to: userId,
    messages: Array.isArray(messages) ? messages : [messages]
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error('LINE push error:', data);
    return data;
  } catch (err) {
    console.error('LINE push exception:', err.message);
  } finally {
    clearTimeout(timer);
  }
}

// ตอบกลับ reply token (ใช้ใน webhook)
async function replyMessage(replyToken, dormitoryId, messages) {
  const token = getToken(dormitoryId);
  if (!token) return;

  const payload = {
    replyToken,
    messages: Array.isArray(messages) ? messages : [messages]
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error('LINE reply error:', data);
    return data;
  } catch (err) {
    console.error('LINE reply exception:', err.message);
  } finally {
    clearTimeout(timer);
  }
}

// ดาวน์โหลดรูปภาพจาก LINE (สำหรับรับสลิป)
async function downloadImage(dormitoryId, messageId) {
  const token = getToken(dormitoryId);
  if (!token) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000); // 15s — image download อาจช้า
  try {
    const res = await fetch(`${LINE_API}/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    return res.buffer();
  } catch (err) {
    if (err.name === 'AbortError') console.warn('[LINE] downloadImage timeout');
    else console.error('[LINE] downloadImage error:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ดึงโปรไฟล์ user จาก LINE
async function getUserProfile(dormitoryId, userId) {
  const token = getToken(dormitoryId);
  if (!token) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${LINE_API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') console.warn('[LINE] getUserProfile timeout');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Message Templates
// ============================================================

function billMessage(bill, room, dormName) {
  const month = bill.billing_month;
  const lines = [
    `🏠 *${dormName}*`,
    `📋 ใบแจ้งหนี้เดือน ${month}`,
    `ห้อง ${room.room_number}`,
    ``,
    `💧 ค่าน้ำ: ฿${bill.water_amount.toFixed(2)} (${bill.water_units} หน่วย)`,
    `⚡ ค่าไฟ: ฿${bill.electric_amount.toFixed(2)} (${bill.electric_units} หน่วย)`,
    `🏠 ค่าเช่า: ฿${bill.rent_amount.toFixed(2)}`,
  ];
  if (bill.other_amount > 0) lines.push(`📌 ${bill.other_label || 'อื่นๆ'}: ฿${bill.other_amount.toFixed(2)}`);
  lines.push(``, `💰 *รวมทั้งสิ้น: ฿${bill.total_amount.toFixed(2)}*`);
  if (bill.due_date) lines.push(`📅 กำหนดชำระ: ${bill.due_date}`);
  lines.push(``, `📲 ชำระเงินผ่าน LINE: กดปุ่มด้านล่าง`);

  return {
    type: 'text',
    text: lines.join('\n')
  };
}

function billFlexMessage(bill, room, dormName, liffUrl) {
  return {
    type: 'flex',
    altText: `ใบแจ้งหนี้เดือน ${bill.billing_month} ห้อง ${room.room_number} ฿${bill.total_amount.toFixed(2)}`,
    contents: {
      type: 'bubble',
      styles: { header: { backgroundColor: '#06C755' } },
      header: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: dormName, color: '#ffffff', size: 'sm', weight: 'bold' },
          { type: 'text', text: `ใบแจ้งหนี้เดือน ${bill.billing_month}`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: `ห้อง ${room.room_number}`, color: '#ddffdd', size: 'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          makeRow('💧 ค่าน้ำ', `฿${bill.water_amount.toFixed(2)}`, `${bill.water_units} หน่วย`),
          makeRow('⚡ ค่าไฟ', `฿${bill.electric_amount.toFixed(2)}`, `${bill.electric_units} หน่วย`),
          makeRow('🏠 ค่าเช่า', `฿${bill.rent_amount.toFixed(2)}`, ''),
          ...(bill.other_amount > 0 ? [makeRow(`📌 ${bill.other_label || 'อื่นๆ'}`, `฿${bill.other_amount.toFixed(2)}`, '')] : []),
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: 'รวมทั้งสิ้น', size: 'md', weight: 'bold', flex: 1 },
              { type: 'text', text: `฿${bill.total_amount.toFixed(2)}`, size: 'xl', weight: 'bold', color: '#06C755', align: 'end' }
            ]
          },
          ...(bill.due_date ? [{ type: 'text', text: `กำหนดชำระ: ${bill.due_date}`, size: 'xs', color: '#aaaaaa', margin: 'sm' }] : [])
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [
          {
            type: 'button', style: 'primary', color: '#06C755',
            action: { type: 'uri', label: '💳 ชำระเงิน / ดูรายละเอียด', uri: `${liffUrl}/bill/${bill.id}` }
          }
        ]
      }
    }
  };
}

function makeRow(label, value, sub) {
  return {
    type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: label, size: 'sm', color: '#555555', flex: 2 },
      {
        type: 'box', layout: 'vertical', flex: 3, contents: [
          { type: 'text', text: value, size: 'sm', align: 'end', weight: 'bold' },
          ...(sub ? [{ type: 'text', text: sub, size: 'xs', color: '#aaaaaa', align: 'end' }] : [])
        ]
      }
    ]
  };
}

function paymentReceiptMessage(bill, room, dormName) {
  return {
    type: 'text',
    text: [
      `✅ ชำระเงินเรียบร้อยแล้ว`,
      `🏠 ${dormName} ห้อง ${room.room_number}`,
      `📋 บิลเดือน ${bill.billing_month}`,
      `💰 ยอด ฿${bill.total_amount.toFixed(2)}`,
      ``,
      `ขอบคุณที่ชำระค่าเช่าตรงเวลานะคะ 🙏`
    ].join('\n')
  };
}

function maintenanceConfirmMessage(req, room) {
  return {
    type: 'text',
    text: [
      `🔧 รับเรื่องแจ้งซ่อมแล้วค่ะ`,
      `ห้อง ${room.room_number}: ${req.title}`,
      ``,
      `ทีมงานจะดำเนินการโดยเร็วที่สุดนะคะ`
    ].join('\n')
  };
}

module.exports = {
  pushMessage,
  replyMessage,
  downloadImage,
  getUserProfile,
  billMessage,
  billFlexMessage,
  paymentReceiptMessage,
  maintenanceConfirmMessage
};
