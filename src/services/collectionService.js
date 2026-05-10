const db = require('../db/database');
const lineService = require('./lineService');

const DEFAULT_POLICY = {
  grace_period_days: 3,
  late_fee_type: 'percentage',
  late_fee_value: 5,
  late_fee_max: 0,
  reminder1_day: 1,
  reminder1_template: '🔔 แจ้งเตือน: บิลเดือน {month} ห้อง {room} ยอด ฿{total} ครบกำหนดชำระแล้วค่ะ\n\nกรุณาชำระเงินและส่งสลิปทาง LINE นะคะ 🙏',
  reminder2_day: 3,
  reminder2_template: '⚠️ แจ้งเตือนครั้งที่ 2: บิลเดือน {month} ห้อง {room} เลยกำหนดชำระ {days} วันแล้วค่ะ\nยอดรวม ฿{total} (รวมค่าปรับ ฿{late_fee})\n\nกรุณาชำระโดยด่วนค่ะ',
  formal_notice_day: 7,
  formal_notice_template: '📌 หนังสือแจ้งเตือนอย่างเป็นทางการ\n\nบิลเดือน {month} ห้อง {room} ค้างชำระมาแล้ว {days} วัน\nยอดค้าง ฿{total} (รวมค่าปรับ ฿{late_fee})\n\nหากยังไม่ชำระภายใน 7 วันถัดไป จะดำเนินการตามข้อสัญญาเช่าค่ะ',
  escalation_day: 30,
  escalation_actions: 'notify_admin',
  escalation_template: '🚨 แจ้งเตือนสุดท้าย\n\nบิลเดือน {month} ห้อง {room} ค้างชำระเกิน {days} วัน\nยอดค้าง ฿{total}\n\nกรุณาติดต่อแอดมินด่วนเพื่อหลีกเลี่ยงการบอกเลิกสัญญาค่ะ',
  enabled: 1
};

function getPolicy(dormitoryId) {
  let p = db.prepare('SELECT * FROM collection_policies WHERE dormitory_id = ?').get(dormitoryId);
  if (!p) {
    db.prepare(`INSERT INTO collection_policies
      (dormitory_id, grace_period_days, late_fee_type, late_fee_value, late_fee_max,
       reminder1_day, reminder1_template, reminder2_day, reminder2_template,
       formal_notice_day, formal_notice_template, escalation_day, escalation_actions, escalation_template, enabled)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      dormitoryId,
      DEFAULT_POLICY.grace_period_days, DEFAULT_POLICY.late_fee_type, DEFAULT_POLICY.late_fee_value, DEFAULT_POLICY.late_fee_max,
      DEFAULT_POLICY.reminder1_day, DEFAULT_POLICY.reminder1_template,
      DEFAULT_POLICY.reminder2_day, DEFAULT_POLICY.reminder2_template,
      DEFAULT_POLICY.formal_notice_day, DEFAULT_POLICY.formal_notice_template,
      DEFAULT_POLICY.escalation_day, DEFAULT_POLICY.escalation_actions, DEFAULT_POLICY.escalation_template,
      DEFAULT_POLICY.enabled
    );
    p = db.prepare('SELECT * FROM collection_policies WHERE dormitory_id = ?').get(dormitoryId);
  }
  return p;
}

function updatePolicy(dormitoryId, fields) {
  getPolicy(dormitoryId);
  const allowed = ['grace_period_days','late_fee_type','late_fee_value','late_fee_max',
    'reminder1_day','reminder1_template','reminder2_day','reminder2_template',
    'formal_notice_day','formal_notice_template','escalation_day','escalation_actions','escalation_template','enabled'];
  const setSql = [], values = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { setSql.push(`${k}=?`); values.push(fields[k]); }
  }
  if (!setSql.length) return getPolicy(dormitoryId);
  values.push(dormitoryId);
  db.prepare(`UPDATE collection_policies SET ${setSql.join(',')}, updated_at=datetime('now') WHERE dormitory_id=?`).run(...values);
  return getPolicy(dormitoryId);
}

function calcLateFee(policy, baseAmount, daysOverdue) {
  if (!policy.enabled) return 0;
  if (daysOverdue <= policy.grace_period_days) return 0;
  let fee = 0;
  if (policy.late_fee_type === 'percentage') {
    fee = baseAmount * (policy.late_fee_value / 100);
  } else if (policy.late_fee_type === 'fixed') {
    fee = policy.late_fee_value;
  }
  if (policy.late_fee_max > 0 && fee > policy.late_fee_max) fee = policy.late_fee_max;
  return Math.round(fee * 100) / 100;
}

function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// ดึงบิลที่ overdue + คำนวณ days/late_fee/stage
function getOverdueBills(dormitoryId) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT b.*, r.room_number, r.room_code, r.dormitory_id, t.line_user_id, t.display_name
    FROM bills b
    JOIN rooms r ON b.room_id = r.id
    LEFT JOIN tenants t ON r.id = t.room_id
    WHERE r.dormitory_id = ? AND b.status IN ('pending','overdue')
      AND b.due_date IS NOT NULL AND b.due_date < ?
    ORDER BY b.due_date ASC
  `).all(dormitoryId, today);

  const policy = getPolicy(dormitoryId);
  return rows.map(b => {
    const days = daysBetween(b.due_date, today);
    const baseTotal = (b.total_amount || 0) - (b.late_fee || 0);
    const fee = calcLateFee(policy, baseTotal, days);
    return { ...b, days_overdue: days, computed_late_fee: fee, computed_total: baseTotal + fee };
  });
}

function determineStage(policy, days) {
  if (days >= policy.escalation_day) return 'escalation';
  if (days >= policy.formal_notice_day) return 'formal_notice';
  if (days >= policy.reminder2_day) return 'reminder2';
  if (days >= policy.reminder1_day) return 'reminder1';
  return null;
}

function alreadySent(billId, stage) {
  return db.prepare('SELECT 1 FROM collection_logs WHERE bill_id=? AND stage=?').get(billId, stage);
}

function buildMessage(template, bill) {
  return fillTemplate(template, {
    month: bill.billing_month,
    room: bill.room_code || bill.room_number,
    total: Number(bill.computed_total).toFixed(2),
    late_fee: Number(bill.computed_late_fee).toFixed(2),
    days: bill.days_overdue
  });
}

// run a single dormitory's collection cycle
async function runCollectionForDormitory(dormitoryId) {
  const policy = getPolicy(dormitoryId);
  if (!policy.enabled) return { sent: 0, skipped: 0 };

  const overdue = getOverdueBills(dormitoryId);
  let sent = 0, skipped = 0;

  for (const bill of overdue) {
    const stage = determineStage(policy, bill.days_overdue);
    if (!stage) { skipped++; continue; }

    // อัปเดตค่าปรับและสถานะ
    db.prepare("UPDATE bills SET late_fee=?, total_amount=?, status='overdue' WHERE id=?")
      .run(bill.computed_late_fee, bill.computed_total, bill.id);

    if (alreadySent(bill.id, stage)) { skipped++; continue; }

    const tplKey = stage === 'reminder1' ? 'reminder1_template'
      : stage === 'reminder2' ? 'reminder2_template'
      : stage === 'formal_notice' ? 'formal_notice_template'
      : 'escalation_template';
    const text = buildMessage(policy[tplKey] || '', bill);

    if (bill.line_user_id && !bill.line_user_id.startsWith('pending:')) {
      try {
        await lineService.pushMessage(dormitoryId, bill.line_user_id, { type: 'text', text });
        sent++;
      } catch (e) {
        console.error(`Collection LINE push failed (bill ${bill.id}):`, e.message);
      }
    } else {
      skipped++;
      continue; // ข้ามการ log สำหรับ tenant ที่ยังไม่ผูก LINE
    }

    db.prepare(`INSERT INTO collection_logs (bill_id, stage, days_overdue, message_sent, sent_by)
      VALUES (?,?,?,?,?)`).run(bill.id, stage, bill.days_overdue, text, 'system');

    // ขั้น escalation: notify admin
    if (stage === 'escalation' && (policy.escalation_actions || '').includes('notify_admin')) {
      const admins = db.prepare(`SELECT line_user_id FROM admin_line_links WHERE dormitory_id=?`).all(dormitoryId);
      for (const a of admins) {
        try {
          await lineService.pushMessage(dormitoryId, a.line_user_id, {
            type: 'text',
            text: `🚨 [Admin Alert] ห้อง ${bill.room_code || bill.room_number} ค้างชำระ ${bill.days_overdue} วัน ยอด ฿${bill.computed_total.toFixed(2)} - กรุณาดำเนินการ`
          });
        } catch {}
      }
    }
  }
  return { sent, skipped, total_overdue: overdue.length };
}

async function runAllDormitories() {
  const dorms = db.prepare('SELECT id FROM dormitories').all();
  const results = [];
  for (const d of dorms) {
    const r = await runCollectionForDormitory(d.id);
    results.push({ dormitory_id: d.id, ...r });
  }
  return results;
}

// คำนวณยอดบิลแบบ live (ไม่บันทึก) — ใช้ตอนตอบใน LINE
function computeLive(billId) {
  const bill = db.prepare(`
    SELECT b.*, r.dormitory_id, r.room_number, r.room_code FROM bills b
    JOIN rooms r ON b.room_id = r.id WHERE b.id = ?
  `).get(billId);
  if (!bill) return null;
  if (bill.status === 'paid') return { ...bill, days_overdue: 0, computed_late_fee: 0, computed_total: bill.total_amount };
  if (!bill.due_date) return { ...bill, days_overdue: 0, computed_late_fee: 0, computed_total: bill.total_amount };

  const today = new Date().toISOString().slice(0, 10);
  const days = Math.max(0, daysBetween(bill.due_date, today));
  const policy = getPolicy(bill.dormitory_id);
  const baseTotal = (bill.total_amount || 0) - (bill.late_fee || 0);
  const fee = calcLateFee(policy, baseTotal, days);
  return { ...bill, days_overdue: days, computed_late_fee: fee, computed_total: baseTotal + fee };
}

module.exports = {
  getPolicy,
  updatePolicy,
  getOverdueBills,
  runCollectionForDormitory,
  runAllDormitories,
  computeLive,
  calcLateFee,
  DEFAULT_POLICY
};
