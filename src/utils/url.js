/**
 * URL builder helper for generating public URLs (invite links, share URLs, etc.)
 *
 * Priority:
 *  1. process.env.BASE_URL (explicit override, e.g. "https://cyn-jewelry.com/RMS")
 *  2. From request: x-forwarded-proto/host (when behind proxy like Vercel/nginx)
 *     + process.env.BASE_PATH (e.g. "/RMS")
 *  3. Local dev fallback: http://localhost:PORT
 */
function buildPublicUrl(req, pathSuffix = '') {
  // 1. explicit env override (production deployments should set this)
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '') + pathSuffix;
  }
  // 2. derive from request headers (works behind reverse proxy)
  if (req && typeof req.get === 'function') {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host  = req.get('x-forwarded-host')  || req.get('host');
    const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
    if (host) return `${proto}://${host}${basePath}${pathSuffix}`;
  }
  // 3. local dev fallback
  const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 3000}${basePath}${pathSuffix}`;
}

/**
 * Server-side fallback for code paths that have no `req` (cron jobs, LINE bots, etc.)
 * Returns full base URL without trailing slash, e.g. "https://cyn-jewelry.com/RMS"
 */
function getBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 3000}${basePath}`;
}

module.exports = { buildPublicUrl, getBaseUrl };
