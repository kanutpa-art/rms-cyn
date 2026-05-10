const db = require('../db/database');

const INCOME_CATEGORIES = ['rent','water','electric','deposit','late_fee','other_income'];
const EXPENSE_CATEGORIES = ['water_supply','electric_supply','maintenance','salary','tax','insurance','marketing','utilities','cleaning','other_expense'];

function listTransactions(dormitoryId, { from, to, type, category } = {}) {
  let q = `SELECT * FROM financial_transactions WHERE dormitory_id=?`;
  const p = [dormitoryId];
  if (from) { q += ' AND transaction_date >= ?'; p.push(from); }
  if (to)   { q += ' AND transaction_date <= ?'; p.push(to); }
  if (type) { q += ' AND type=?'; p.push(type); }
  if (category) { q += ' AND category=?'; p.push(category); }
  q += ' ORDER BY transaction_date DESC, id DESC LIMIT 500';
  return db.prepare(q).all(...p);
}

function createTransaction(dormitoryId, data, adminId) {
  const r = db.prepare(`INSERT INTO financial_transactions
    (dormitory_id, type, category, description, amount, transaction_date,
     reference_type, reference_id, bank_account, bank_ref, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    dormitoryId, data.type, data.category || '', data.description || '',
    parseFloat(data.amount), data.transaction_date,
    data.reference_type || 'manual', data.reference_id || null,
    data.bank_account || '', data.bank_ref || '', adminId || null
  );
  return db.prepare('SELECT * FROM financial_transactions WHERE id=?').get(r.lastInsertRowid);
}

function updateTransaction(id, dormitoryId, data) {
  const allowed = ['type','category','description','amount','transaction_date','bank_account','bank_ref'];
  const set = [], vals = [];
  for (const k of allowed) if (data[k] !== undefined) { set.push(`${k}=?`); vals.push(data[k]); }
  if (!set.length) return;
  vals.push(id, dormitoryId);
  db.prepare(`UPDATE financial_transactions SET ${set.join(',')} WHERE id=? AND dormitory_id=?`).run(...vals);
  return db.prepare('SELECT * FROM financial_transactions WHERE id=?').get(id);
}

function deleteTransaction(id, dormitoryId) {
  return db.prepare('DELETE FROM financial_transactions WHERE id=? AND dormitory_id=?').run(id, dormitoryId);
}

// Auto-record income from approved payments (call when payment approved)
function recordPaymentIncome(payment, bill) {
  const exists = db.prepare(`SELECT id FROM financial_transactions WHERE reference_type='payment' AND reference_id=?`).get(payment.id);
  if (exists) return;
  db.prepare(`INSERT INTO financial_transactions
    (dormitory_id, type, category, description, amount, transaction_date, reference_type, reference_id)
    SELECT r.dormitory_id, 'income', 'rent', 'ค่าเช่า ห้อง '||COALESCE(r.room_code,r.room_number)||' บิล '||?, ?, date('now'), 'payment', ?
    FROM rooms r WHERE r.id=?`).run(bill.billing_month, payment.amount, payment.id, bill.room_id);
}

// ============================================================
// Summary / Analytics
// ============================================================
function monthlySummary(dormitoryId, year) {
  const rows = db.prepare(`
    SELECT strftime('%m', transaction_date) as month, type,
      SUM(amount) as total, COUNT(*) as cnt
    FROM financial_transactions
    WHERE dormitory_id=? AND strftime('%Y', transaction_date)=?
    GROUP BY month, type
    ORDER BY month
  `).all(dormitoryId, String(year));

  const out = {};
  for (let m = 1; m <= 12; m++) {
    const k = String(m).padStart(2, '0');
    out[k] = { income: 0, expense: 0, net: 0 };
  }
  for (const r of rows) {
    out[r.month][r.type] = r.total;
  }
  for (const k of Object.keys(out)) out[k].net = out[k].income - out[k].expense;
  return out;
}

function categoryBreakdown(dormitoryId, { from, to, type }) {
  let q = `SELECT category, SUM(amount) as total, COUNT(*) as cnt
    FROM financial_transactions WHERE dormitory_id=?`;
  const p = [dormitoryId];
  if (from) { q += ' AND transaction_date >= ?'; p.push(from); }
  if (to)   { q += ' AND transaction_date <= ?'; p.push(to); }
  if (type) { q += ' AND type=?'; p.push(type); }
  q += ' GROUP BY category ORDER BY total DESC';
  return db.prepare(q).all(...p);
}

// ============================================================
// Analytics for dashboard
// ============================================================
function analytics(dormitoryId, year) {
  const summary = monthlySummary(dormitoryId, year);

  const occupancy = db.prepare(`
    SELECT COUNT(r.id) as total, SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) as occupied
    FROM rooms r LEFT JOIN tenants t ON r.id=t.room_id
    WHERE r.dormitory_id=?
  `).get(dormitoryId);

  const overdueRate = db.prepare(`
    SELECT COUNT(b.id) as total,
      SUM(CASE WHEN b.status IN ('overdue') THEN 1 ELSE 0 END) as overdue
    FROM bills b JOIN rooms r ON b.room_id=r.id
    WHERE r.dormitory_id=? AND strftime('%Y', b.billing_month)=?
  `).get(dormitoryId, String(year));

  const topExpenseCats = categoryBreakdown(dormitoryId, { from: `${year}-01-01`, to: `${year}-12-31`, type: 'expense' });

  const ytdIncome = Object.values(summary).reduce((s, v) => s + v.income, 0);
  const ytdExpense = Object.values(summary).reduce((s, v) => s + v.expense, 0);

  return {
    year,
    monthly: summary,
    ytd_income: ytdIncome,
    ytd_expense: ytdExpense,
    ytd_net: ytdIncome - ytdExpense,
    occupancy_rate: occupancy.total ? (occupancy.occupied / occupancy.total) : 0,
    occupied: occupancy.occupied,
    total_rooms: occupancy.total,
    overdue_rate: overdueRate.total ? (overdueRate.overdue / overdueRate.total) : 0,
    top_expense_categories: topExpenseCats.slice(0, 5)
  };
}

// ============================================================
// Tax report (Thailand: ภงด.94 / income tax)
// ============================================================
function taxReport(dormitoryId, year) {
  const txs = db.prepare(`
    SELECT type, category, SUM(amount) as total
    FROM financial_transactions
    WHERE dormitory_id=? AND strftime('%Y', transaction_date)=?
    GROUP BY type, category
  `).all(dormitoryId, String(year));

  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.total, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.total, 0);

  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormitoryId);

  // ภาษีโรงเรือน: 12.5% ของรายได้ค่าเช่ารวม
  const rentalIncome = txs.filter(t => t.type === 'income' && t.category === 'rent').reduce((s, t) => s + t.total, 0);
  const buildingTax = rentalIncome * 0.125;

  // ภงด.94 (ครึ่งปี/ปี): ใช้ขั้นบันได สมมติ flat 5% สำหรับ preview
  const netIncome = income - expense;
  const estimatedIncomeTax = netIncome > 0 ? netIncome * 0.05 : 0;

  return {
    dormitory: dorm.name,
    year,
    total_income: income,
    total_expense: expense,
    net_income: netIncome,
    rental_income: rentalIncome,
    estimated_building_tax: buildingTax,
    estimated_income_tax: estimatedIncomeTax,
    total_estimated_tax: buildingTax + estimatedIncomeTax,
    breakdown_by_category: txs
  };
}

// ============================================================
// Bank reconciliation
// ============================================================
function listBankStatements(dormitoryId, { from, to, matched } = {}) {
  let q = `SELECT bs.*, p.id as p_id, b.billing_month, r.room_code, r.room_number
    FROM bank_statements bs
    LEFT JOIN payments p ON bs.matched_payment_id=p.id
    LEFT JOIN bills b ON p.bill_id=b.id
    LEFT JOIN rooms r ON b.room_id=r.id
    WHERE bs.dormitory_id=?`;
  const p = [dormitoryId];
  if (from) { q += ' AND bs.statement_date >= ?'; p.push(from); }
  if (to)   { q += ' AND bs.statement_date <= ?'; p.push(to); }
  if (matched === 'yes') q += ' AND bs.matched_payment_id IS NOT NULL';
  if (matched === 'no')  q += ' AND bs.matched_payment_id IS NULL';
  q += ' ORDER BY bs.statement_date DESC LIMIT 500';
  return db.prepare(q).all(...p);
}

function importBankStatement(dormitoryId, rows) {
  let imported = 0;
  for (const r of rows) {
    db.prepare(`INSERT INTO bank_statements
      (dormitory_id, statement_date, description, amount, balance, reference)
      VALUES (?,?,?,?,?,?)`).run(
      dormitoryId, r.date, r.description || '', parseFloat(r.amount),
      r.balance ? parseFloat(r.balance) : null, r.reference || ''
    );
    imported++;
  }
  return { imported };
}

function matchBankStatement(statementId, paymentId) {
  db.prepare(`UPDATE bank_statements SET matched_payment_id=?, matched_at=datetime('now') WHERE id=?`)
    .run(paymentId, statementId);
}

// Auto-match: find payments with matching amount on close dates
function autoMatchBankStatements(dormitoryId) {
  const unmatched = db.prepare(`SELECT * FROM bank_statements WHERE dormitory_id=? AND matched_payment_id IS NULL AND amount > 0`).all(dormitoryId);
  let matched = 0;
  for (const s of unmatched) {
    const candidate = db.prepare(`
      SELECT p.id FROM payments p
      JOIN bills b ON p.bill_id=b.id
      JOIN rooms r ON b.room_id=r.id
      WHERE r.dormitory_id=? AND p.status='approved'
        AND ABS(p.amount - ?) < 1
        AND ABS(julianday(p.paid_at) - julianday(?)) <= 3
        AND p.id NOT IN (SELECT matched_payment_id FROM bank_statements WHERE matched_payment_id IS NOT NULL)
      LIMIT 1
    `).get(dormitoryId, s.amount, s.statement_date);
    if (candidate) { matchBankStatement(s.id, candidate.id); matched++; }
  }
  return { checked: unmatched.length, matched };
}

// ============================================================
// Owner Statement (monthly profit report)
// ============================================================
function ownerStatement(dormitoryId, year, month) {
  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;
  const start = `${yyyymm}-01`;
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

  const dorm = db.prepare('SELECT * FROM dormitories WHERE id=?').get(dormitoryId);
  const rentalRevenue = db.prepare(`
    SELECT COALESCE(SUM(b.total_amount),0) as total
    FROM bills b JOIN rooms r ON b.room_id=r.id
    WHERE r.dormitory_id=? AND b.billing_month=? AND b.status='paid'
  `).get(dormitoryId, yyyymm).total;

  const incomeTxs = db.prepare(`
    SELECT category, SUM(amount) as total
    FROM financial_transactions
    WHERE dormitory_id=? AND type='income' AND transaction_date >= ? AND transaction_date < ?
    GROUP BY category
  `).all(dormitoryId, start, next);

  const expenseTxs = db.prepare(`
    SELECT category, SUM(amount) as total
    FROM financial_transactions
    WHERE dormitory_id=? AND type='expense' AND transaction_date >= ? AND transaction_date < ?
    GROUP BY category
  `).all(dormitoryId, start, next);

  const totalIncome = incomeTxs.reduce((s, t) => s + t.total, 0);
  const totalExpense = expenseTxs.reduce((s, t) => s + t.total, 0);

  const occupancy = db.prepare(`
    SELECT COUNT(r.id) as total, SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) as occupied
    FROM rooms r LEFT JOIN tenants t ON r.id=t.room_id WHERE r.dormitory_id=?
  `).get(dormitoryId);

  return {
    dormitory: dorm.name,
    period: yyyymm,
    rental_revenue_paid: rentalRevenue,
    total_income: totalIncome,
    total_expense: totalExpense,
    net_profit: totalIncome - totalExpense,
    income_breakdown: incomeTxs,
    expense_breakdown: expenseTxs,
    occupancy_rate: occupancy.total ? occupancy.occupied / occupancy.total : 0,
    occupied: occupancy.occupied,
    total_rooms: occupancy.total
  };
}

module.exports = {
  INCOME_CATEGORIES, EXPENSE_CATEGORIES,
  listTransactions, createTransaction, updateTransaction, deleteTransaction,
  recordPaymentIncome, monthlySummary, categoryBreakdown, analytics,
  taxReport, listBankStatements, importBankStatement, matchBankStatement, autoMatchBankStatements,
  ownerStatement
};
