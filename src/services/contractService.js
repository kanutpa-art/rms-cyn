const db = require('../db/database');

const DEFAULT_TEMPLATE = `สัญญาเช่าห้องพัก

ทำที่ {dormitory_name}
วันที่ {today}

สัญญาเช่าฉบับนี้ทำขึ้นระหว่าง:
ผู้ให้เช่า: {dormitory_name}
ผู้เช่า: {tenant_name}  เลขบัตรประชาชน: {tenant_id_card}
เบอร์ติดต่อ: {tenant_phone}
ที่อยู่: {tenant_address}

ทั้งสองฝ่ายตกลงทำสัญญาเช่าห้องพักดังนี้:

ข้อ 1. ห้องที่เช่า: {room_code} (ตึก {building} ชั้น {floor} ห้อง {room_number})
ข้อ 2. อัตราค่าเช่า: เดือนละ {monthly_rent} บาท
ข้อ 3. เงินประกัน: {deposit_amount} บาท (คืนเมื่อย้ายออกพร้อมหักค่าเสียหาย)
ข้อ 4. ระยะเวลาเช่า: ตั้งแต่ {start_date} ถึง {end_date}
ข้อ 5. กำหนดชำระค่าเช่า: ทุกวันที่ {payment_due_day} ของเดือน

ข้อ 6. การผิดนัดชำระ:
- ผ่อนผันได้ {grace_period_days} วันหลังครบกำหนด
- หากเกินกำหนดผ่อนผัน คิดค่าปรับ {late_fee_text}
- ค้างชำระเกิน {escalation_day} วัน ผู้ให้เช่ามีสิทธิบอกเลิกสัญญา

ข้อ 7. เงื่อนไขเพิ่มเติม:
{custom_terms}

ลงชื่อผู้ให้เช่า ........................................
ลงชื่อผู้เช่า   ........................................

(ลงนาม ณ วันที่ {today})
`;

function ensureDefaultTemplate(dormitoryId) {
  const existing = db.prepare('SELECT id FROM contract_templates WHERE dormitory_id=? AND is_default=1').get(dormitoryId);
  if (!existing) {
    db.prepare('INSERT INTO contract_templates (dormitory_id, name, body, is_default) VALUES (?,?,?,1)')
      .run(dormitoryId, 'มาตรฐาน', DEFAULT_TEMPLATE);
  }
}

function getDefaultTemplate(dormitoryId) {
  ensureDefaultTemplate(dormitoryId);
  return db.prepare('SELECT * FROM contract_templates WHERE dormitory_id=? AND is_default=1').get(dormitoryId);
}

function listContracts(dormitoryId) {
  return db.prepare(`
    SELECT c.*, r.room_number, r.room_code, r.building, r.floor
    FROM contracts c JOIN rooms r ON c.room_id=r.id
    WHERE c.dormitory_id=? ORDER BY c.created_at DESC
  `).all(dormitoryId);
}

function getContract(id, dormitoryId) {
  return db.prepare(`
    SELECT c.*, r.room_number, r.room_code, r.building, r.floor
    FROM contracts c JOIN rooms r ON c.room_id=r.id
    WHERE c.id=? AND c.dormitory_id=?
  `).get(id, dormitoryId);
}

function createContract(data) {
  const result = db.prepare(`
    INSERT INTO contracts (
      dormitory_id, room_id, tenant_id, contract_number,
      tenant_name, tenant_id_card, tenant_phone, tenant_address,
      start_date, end_date, monthly_rent, deposit_amount, payment_due_day,
      custom_terms, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    data.dormitory_id, data.room_id, data.tenant_id || null,
    data.contract_number || `CT${Date.now()}`,
    data.tenant_name || '', data.tenant_id_card || '', data.tenant_phone || '', data.tenant_address || '',
    data.start_date, data.end_date,
    data.monthly_rent, data.deposit_amount || 0, data.payment_due_day || 5,
    data.custom_terms || '', data.status || 'draft'
  );
  return getContract(result.lastInsertRowid, data.dormitory_id);
}

function updateContract(id, dormitoryId, data) {
  const fields = ['tenant_name','tenant_id_card','tenant_phone','tenant_address',
    'start_date','end_date','monthly_rent','deposit_amount','payment_due_day','custom_terms','status'];
  const set = [], vals = [];
  for (const f of fields) {
    if (data[f] !== undefined) { set.push(`${f}=?`); vals.push(data[f]); }
  }
  if (set.length) {
    vals.push(id, dormitoryId);
    db.prepare(`UPDATE contracts SET ${set.join(',')}, updated_at=datetime('now') WHERE id=? AND dormitory_id=?`).run(...vals);
  }
  return getContract(id, dormitoryId);
}

function deleteContract(id, dormitoryId) {
  return db.prepare('DELETE FROM contracts WHERE id=? AND dormitory_id=?').run(id, dormitoryId);
}

function fillContract(contract, dormitory, policy) {
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(contract.room_id);
  const today = new Date().toISOString().slice(0, 10);
  const lateFeeText = policy?.late_fee_type === 'percentage'
    ? `${policy.late_fee_value}% ของยอดบิล`
    : policy?.late_fee_type === 'fixed'
    ? `${policy.late_fee_value} บาทต่อบิล`
    : 'ไม่มีค่าปรับ';

  const tpl = getDefaultTemplate(dormitory.id);
  return tpl.body.replace(/\{(\w+)\}/g, (_, k) => {
    const map = {
      today,
      dormitory_name: dormitory.name || '',
      tenant_name: contract.tenant_name || '',
      tenant_id_card: contract.tenant_id_card || '-',
      tenant_phone: contract.tenant_phone || '-',
      tenant_address: contract.tenant_address || '-',
      room_code: room?.room_code || room?.room_number || '',
      building: room?.building || 'A',
      floor: room?.floor || 1,
      room_number: room?.room_number || '',
      monthly_rent: Number(contract.monthly_rent || 0).toLocaleString(),
      deposit_amount: Number(contract.deposit_amount || 0).toLocaleString(),
      start_date: contract.start_date,
      end_date: contract.end_date,
      payment_due_day: contract.payment_due_day || 5,
      grace_period_days: policy?.grace_period_days ?? 3,
      late_fee_text: lateFeeText,
      escalation_day: policy?.escalation_day ?? 30,
      custom_terms: contract.custom_terms || '-'
    };
    return map[k] !== undefined ? map[k] : `{${k}}`;
  });
}

function renderHTML(contract, dormitory, policy) {
  const text = fillContract(contract, dormitory, policy);
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>สัญญาเช่า ${contract.contract_number}</title>
<style>
@page { size: A4; margin: 2cm; }
body { font-family: 'Sarabun','TH Sarabun New',serif; font-size: 16pt; line-height: 1.6; white-space: pre-wrap; color: #000; }
.no-print { display: block; padding: 12px; background: #f3f4f6; text-align: center; }
.no-print button { background: #06C755; color: #fff; border: 0; padding: 10px 24px; border-radius: 8px; font-size: 14pt; cursor: pointer; }
@media print { .no-print { display: none } }
</style></head><body>
<div class="no-print"><button onclick="window.print()">🖨️ พิมพ์ / บันทึกเป็น PDF</button></div>
${safe}
</body></html>`;
}

module.exports = {
  ensureDefaultTemplate, getDefaultTemplate,
  listContracts, getContract, createContract, updateContract, deleteContract,
  fillContract, renderHTML
};
