# Uptime Monitoring Setup — RMS

## UptimeRobot Configuration

### Monitor 1: Backend Health (Direct)
```
Type:           HTTPS
URL:            https://rms-cyn.onrender.com/health
Friendly Name:  RMS Backend Health
Interval:       5 minutes (free tier minimum)
Timeout:        30 seconds
Keyword:        "status":"ok"
Keyword Type:   exists
HTTP Method:    GET
```
**Why direct origin:** detects Render outages even when Vercel proxy is healthy.

### Monitor 2: Vercel Proxy Health
```
Type:           HTTPS
URL:            https://cyn-jewelry.com/RMS/api/health
Friendly Name:  RMS via Vercel Proxy
Interval:       5 minutes
Timeout:        30 seconds
Keyword:        "status":"ok"
Keyword Type:   exists
```
**Why proxy:** detects rewrite/DNS issues.

### Monitor 3: Critical User Flow (Login Page Renders)
```
Type:           HTTPS
URL:            https://cyn-jewelry.com/RMS/admin
Friendly Name:  RMS Admin Login Page
Interval:       15 minutes
Timeout:        30 seconds
Keyword:        "RMS Admin"
Keyword Type:   exists
```

## Alert Channels

Add these in UptimeRobot → My Settings → Alert Contacts:

1. **Email:** owner@cyn-jewelry.com (immediate)
2. **LINE Notify token:** for instant mobile alerts
   - Generate at https://notify-bot.line.me/my/
   - Add as "Webhook" contact with POST body: `{"message":"*Alert!* #monitorFriendlyName is #alertTypeFriendlyName"}`
3. **SMS:** owner phone (only for P1 monitor)

## Expected Response

```json
GET https://rms-cyn.onrender.com/api/health
HTTP 200 OK
Cache-Control: no-store, must-revalidate
Content-Type: application/json

{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 1234,
  "boot_at": "2026-05-15T12:00:00.000Z",
  "env": "production",
  "node": "v22.11.0",
  "db": {
    "status": "connected",
    "latency_ms": 2,
    "dormitories": 1
  },
  "sessions": {
    "active": 3
  },
  "memory_mb": {
    "rss": 95,
    "heap_used": 42,
    "heap_total": 60
  },
  "timestamp": "2026-05-15T12:30:00.000Z"
}
```

## Alert Thresholds (Future — paid UptimeRobot Pro)

- `db.latency_ms > 500` → SLOW
- `memory_mb.rss > 450` → MEMORY PRESSURE (Render free = 512MB ceiling)
- `uptime < 60` → RECENTLY RESTARTED (5+ restarts in 1h = INSTABILITY)

## Render-side Monitoring

Render automatically tracks:
- Deploy events
- Service crashes
- Custom metrics (paid plan)

Enable: Render Dashboard → Service → Notifications → Email on deploy/crash
