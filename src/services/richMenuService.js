const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { getBaseUrl } = require('../utils/url');

const LINE_API = 'https://api.line.me/v2/bot';
const LINE_DATA_API = 'https://api-data.line.me/v2/bot';

function getToken(dormitoryId) {
  const dorm = db.prepare('SELECT line_channel_access_token FROM dormitories WHERE id=?').get(dormitoryId);
  return dorm?.line_channel_access_token;
}

// ============================================================
// Rich Menu Templates
// ============================================================
// LINE Rich Menu image: 2500x1686 (full) or 2500x843 (compact)
// 6 buttons (3x2) with action per button

const TENANT_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'tenant-menu',
  chatBarText: '☰ เมนูลูกบ้าน',
  areas: [
    { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'message', text: 'บิล' } },
    { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: 'message', text: 'ชำระเงิน' } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'message', text: 'แจ้งซ่อม' } },
    { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'uri', uri: 'PLACEHOLDER_LIFF_URL' } },
    { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: 'message', text: 'ประวัติบิล' } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'help' } }
  ]
};

const OWNER_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'owner-menu',
  chatBarText: '☰ เมนูเจ้าของหอ',
  areas: [
    { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'message', text: 'สรุปวันนี้' } },
    { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: 'message', text: 'ห้องว่าง' } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'message', text: 'สรุปค้างชำระ' } },
    { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'สลิปรอตรวจ' } },
    { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: 'message', text: 'ประกาศ' } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'uri', uri: 'PLACEHOLDER_ADMIN_URL' } }
  ]
};

// ============================================================
// LINE Rich Menu API wrappers
// ============================================================

async function createRichMenu(dormitoryId, menuConfig) {
  const token = getToken(dormitoryId);
  if (!token) throw new Error('No LINE channel token');

  const res = await fetch(`${LINE_API}/richmenu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(menuConfig)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`createRichMenu: ${JSON.stringify(data)}`);
  return data.richMenuId;
}

async function uploadRichMenuImage(dormitoryId, richMenuId, imagePath) {
  const token = getToken(dormitoryId);
  if (!token) throw new Error('No LINE channel token');

  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

  const res = await fetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { 'Content-Type': mime, Authorization: `Bearer ${token}` },
    body: buf
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`uploadRichMenuImage: ${err}`);
  }
  return true;
}

async function setDefaultRichMenu(dormitoryId, richMenuId) {
  const token = getToken(dormitoryId);
  const res = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('setDefaultRichMenu failed');
  return true;
}

async function linkRichMenuToUser(dormitoryId, lineUserId, richMenuId) {
  const token = getToken(dormitoryId);
  const res = await fetch(`${LINE_API}/user/${lineUserId}/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

async function listRichMenus(dormitoryId) {
  const token = getToken(dormitoryId);
  if (!token) return [];
  try {
    const res = await fetch(`${LINE_API}/richmenu/list`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.richmenus || [];
  } catch { return []; }
}

async function deleteRichMenu(dormitoryId, richMenuId) {
  const token = getToken(dormitoryId);
  const res = await fetch(`${LINE_API}/richmenu/${richMenuId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

// ============================================================
// Setup helpers — store created menu IDs in dormitories table
// ============================================================
function ensureMenuStorage() {
  // Add columns if not exist (idempotent)
  const cols = db.prepare(`PRAGMA table_info(dormitories)`).all();
  const has = c => cols.some(x => x.name === c);
  if (!has('rich_menu_tenant_id')) {
    try { db.exec(`ALTER TABLE dormitories ADD COLUMN rich_menu_tenant_id TEXT`); } catch {}
  }
  if (!has('rich_menu_owner_id')) {
    try { db.exec(`ALTER TABLE dormitories ADD COLUMN rich_menu_owner_id TEXT`); } catch {}
  }
}
ensureMenuStorage();

async function setupRichMenusForDormitory(dormitoryId, opts = {}) {
  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormitoryId);
  if (!dorm?.line_channel_access_token) throw new Error('LINE token ยังไม่ได้ตั้งค่า');

  const baseUrl = getBaseUrl();
  const liffUrl = dorm.liff_id ? `https://liff.line.me/${dorm.liff_id}` : `${baseUrl}/liff/`;
  const adminUrl = `${baseUrl}/admin`;

  const tenantMenu = JSON.parse(JSON.stringify(TENANT_MENU));
  tenantMenu.areas[3].action.uri = liffUrl;

  const ownerMenu = JSON.parse(JSON.stringify(OWNER_MENU));
  ownerMenu.areas[5].action.uri = adminUrl;

  // ลบเมนูเก่า (ถ้ามี)
  if (dorm.rich_menu_tenant_id) { try { await deleteRichMenu(dormitoryId, dorm.rich_menu_tenant_id); } catch {} }
  if (dorm.rich_menu_owner_id)  { try { await deleteRichMenu(dormitoryId, dorm.rich_menu_owner_id); } catch {} }

  // สร้างใหม่
  const tenantId = await createRichMenu(dormitoryId, tenantMenu);
  const ownerId = await createRichMenu(dormitoryId, ownerMenu);

  // Upload รูปภาพ (ใช้ default ที่อยู่ใน /public/richmenu/ หรือที่อัปโหลดไว้)
  const tenantImg = opts.tenantImagePath || path.join(__dirname, '../../public/richmenu/tenant.png');
  const ownerImg = opts.ownerImagePath || path.join(__dirname, '../../public/richmenu/owner.png');

  if (fs.existsSync(tenantImg)) await uploadRichMenuImage(dormitoryId, tenantId, tenantImg);
  if (fs.existsSync(ownerImg))  await uploadRichMenuImage(dormitoryId, ownerId, ownerImg);

  // ตั้ง default = tenant menu (คนส่วนใหญ่)
  if (fs.existsSync(tenantImg)) await setDefaultRichMenu(dormitoryId, tenantId);

  // Save to DB
  db.prepare('UPDATE dormitories SET rich_menu_tenant_id=?, rich_menu_owner_id=? WHERE id=?')
    .run(tenantId, ownerId, dormitoryId);

  return {
    tenant_menu_id: tenantId,
    owner_menu_id: ownerId,
    has_tenant_image: fs.existsSync(tenantImg),
    has_owner_image: fs.existsSync(ownerImg),
    note: !fs.existsSync(tenantImg) ? 'ยังไม่มีรูป Rich Menu — อัปโหลดในหน้า Admin' : null
  };
}

// อัตโนมัติเปลี่ยนเมนูตามบทบาท
async function autoLinkMenuByRole(dormitoryId, lineUserId) {
  const dorm = db.prepare('SELECT rich_menu_tenant_id, rich_menu_owner_id FROM dormitories WHERE id=?').get(dormitoryId);
  if (!dorm) return;

  // ถ้าเป็น admin → owner menu
  const isAdmin = db.prepare(`SELECT 1 FROM admin_line_links WHERE dormitory_id=? AND line_user_id=?`).get(dormitoryId, lineUserId);
  const menuId = isAdmin ? dorm.rich_menu_owner_id : dorm.rich_menu_tenant_id;
  if (menuId) await linkRichMenuToUser(dormitoryId, lineUserId, menuId);
}

module.exports = {
  TENANT_MENU, OWNER_MENU,
  createRichMenu, uploadRichMenuImage, setDefaultRichMenu, linkRichMenuToUser,
  listRichMenus, deleteRichMenu,
  setupRichMenusForDormitory, autoLinkMenuByRole
};
