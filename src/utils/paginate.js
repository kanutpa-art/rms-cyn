/**
 * Pagination helper — ป้องกัน SELECT * ไม่มี LIMIT (CHAOS-008, memory leak)
 * Usage:
 *   const { limit, offset, page } = paginate(req.query);
 *   const rows = db.prepare('SELECT ... LIMIT ? OFFSET ?').all(...args, limit, offset);
 *   res.json({ data: rows, page, limit });
 */
function paginate(query, defaultLimit = 50, maxLimit = 200) {
  const page   = Math.max(1, parseInt(query?.page)  || 1);
  const limit  = Math.min(maxLimit, Math.max(1, parseInt(query?.limit) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

module.exports = { paginate };
