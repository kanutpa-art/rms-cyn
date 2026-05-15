# FAILURE RECOVERY & INCIDENT RESPONSE PROCEDURES
## RMS Platform - Operational Resilience Handbook

**Date:** May 13, 2026  
**Document Type:** Incident Response & Recovery Procedures  
**Audience:** DevOps, On-Call Engineers, SREs  

---

## 🚨 INCIDENT RESPONSE FRAMEWORK

### Incident Classification:

```
SEV-1 (Critical) - Complete service outage
  - All users affected
  - Revenue impacting
  - Response: Immediate (within 1 min)
  - Examples: Database down, all Redis down, server crash

SEV-2 (High) - Partial service degradation
  - Some users affected
  - Performance impact
  - Response: 5 minutes
  - Examples: High CPU, memory leak, network latency

SEV-3 (Medium) - Feature specific issue
  - Limited users affected
  - Functionality impaired
  - Response: 15 minutes
  - Examples: Chatbot timeout, webhook delay

SEV-4 (Low) - Minor/non-impacting issue
  - Individual user affected
  - Workaround available
  - Response: Within business hours
  - Examples: UI glitch, slow query
```

---

## 📋 RECOVERY PROCEDURES BY SCENARIO

### SCENARIO 1: DATABASE DISCONNECTION (SEV-1)

**Detection:** Queries fail with "database is closed" error

**Immediate Actions (0-2 min):**
```bash
# 1. Check if database file exists and is readable
ls -lh data/rms.db
file data/rms.db

# 2. Check permissions
stat data/rms.db
chmod 644 data/rms.db

# 3. Check disk space
df -h

# 4. Verify database integrity
sqlite3 data/rms.db "PRAGMA integrity_check;"

# 5. Restart Node process (auto-reconnect)
systemctl restart rms-platform
# OR kill process if running in foreground
pkill -f "node server.js"
npm start
```

**If Database Corrupted (5-10 min):**
```bash
# 1. Backup corrupted database
cp data/rms.db data/rms.db.backup.$(date +%s)

# 2. Restore from last backup
# Restore from S3 daily backup
aws s3 cp s3://rms-backups/daily/latest.db data/rms.db

# 3. Verify restored data integrity
sqlite3 data/rms.db "SELECT COUNT(*) FROM dormitories;"

# 4. Restart application
npm start

# 5. Verify connectivity
curl http://localhost:3000/health
```

**Communication:**
```
- Alert Slack: "@on-call Database disconnected - INVESTIGATING"
- Status page: "Database connectivity issue - investigating"
- After 5 min: "Issue identified - performing recovery"
- After recovery: "Service restored - investigating root cause"
```

**Post-Incident (After recovery):**
```
- [ ] Document failure duration
- [ ] Identify root cause
- [ ] Update monitoring alerts
- [ ] Schedule postmortem (within 24 hours)
- [ ] Implement preventive controls
```

---

### SCENARIO 2: REDIS FAILURE (SEV-2)

**Detection:** Session creation fails with ECONNREFUSED

**Immediate Actions (0-5 min):**
```bash
# 1. Check Redis status
redis-cli ping
# If timeout: Redis is down

# 2. Check logs
journalctl -u redis-server -n 50

# 3. Attempt restart
systemctl restart redis-server

# 4. Verify reconnection
redis-cli ping
# Expected: PONG

# 5. Monitor session creation
# Try to login as admin
```

**If Redis Won't Restart (5-10 min):**
```bash
# 1. Check disk space (Redis persistence)
df -h
# If <5% free, may fail to load

# 2. Clear Redis dump file if corrupted
rm /var/lib/redis/dump.rdb
systemctl restart redis-server

# 3. If still fails, check memory
free -h

# 4. Restart with limited memory
redis-server --maxmemory 1gb

# 5. OR fallback to session file storage
# Update .env: REDIS_FALLBACK=true
systemctl restart rms-platform
```

**User Impact During Outage:**
- ⚠️ Existing users remain logged in (session in memory)
- ❌ New users cannot log in
- ⚠️ After restart, all sessions lost (users need to re-login)

**Communication:**
```
- Alert: "Session service degraded - users may need to re-login"
- Recommendation: "Avoid login during Redis recovery"
```

---

### SCENARIO 3: HIGH CPU USAGE (SEV-2)

**Detection:** CPU usage >80% for 5+ minutes

**Immediate Actions (0-5 min):**
```bash
# 1. Identify CPU-intensive process
top -o %CPU
# Look for Node process

# 2. Check which endpoint is slow
# Review application logs
grep "slow query" /var/log/rms/app.log

# 3. Check database query performance
# If "bulk billing generation":
# - Reduce batch size
# - Distribute over time

# 4. Temporary: Reduce billing batch
# Update config
echo "BILLING_BATCH_SIZE=10" >> .env
systemctl restart rms-platform

# 5. Monitor recovery
watch -n 1 "ps aux | grep node"
```

**Long-term Solution (5-30 min):**
```bash
# 1. Scale up instance
# - Increase vCPU (if possible)
# - Add load balancer and multiple instances

# 2. Optimize code
# - Move CPU-intensive tasks to background jobs
# - Cache expensive computations
# - Add database indexes

# 3. Implement throttling
# - Limit concurrent billing operations
# - Stagger batch jobs
```

---

### SCENARIO 4: STORAGE FULL (SEV-1)

**Detection:** File upload fails with "No space left on device"

**Immediate Actions (0-10 min):**
```bash
# 1. Check disk usage
df -h /

# 2. Find largest files
du -sh /* | sort -hr | head -10

# 3. Clean upload directory
du -sh uploads/*
# Remove old slip uploads (>6 months)
find uploads/slips -mtime +180 -delete

# 4. Clean logs if excessive
du -sh /var/log/*
journalctl --vacuum=50M

# 5. Verify free space
df -h /
# Need >5% free for database operations

# 6. Restart application to resume uploads
systemctl restart rms-platform
```

**Permanent Solution:**
```bash
# 1. Move uploads to cloud storage (S3)
# 2. Implement storage quota per user
# 3. Auto-cleanup old files monthly
# 4. Monitor disk usage alerts

# .env
UPLOAD_MAX_SIZE=5MB
STORAGE_QUOTA_PER_USER=100MB
AUTO_CLEANUP_AFTER_DAYS=180
CLEANUP_SCHEDULE="0 3 * * *" # Daily at 3 AM
```

---

### SCENARIO 5: MEMORY LEAK (SEV-2)

**Detection:** RSS memory growing (1GB+ after 48 hours)

**Immediate Actions (0-15 min):**
```bash
# 1. Monitor memory
ps aux | grep "node server.js" | grep -v grep
# Check RSS column (real memory usage)

# 2. If consistently growing:
# Restart Node process (temporary fix)
systemctl restart rms-platform

# 3. Schedule restart maintenance window
# Daily at 3 AM when traffic is low
echo "0 3 * * * systemctl restart rms-platform" | crontab -

# 4. Identify leak source
# Use heap dump tools
node --inspect server.js
# Then use Chrome DevTools to analyze heap
```

**Permanent Solution (1-2 hours):**
```javascript
// Add memory monitoring
const memoryMonitor = setInterval(() => {
  const used = process.memoryUsage();
  console.log(`Memory: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
  
  // Alert if >1.5GB
  if (used.heapUsed > 1.5 * 1024 * 1024 * 1024) {
    console.error('HIGH MEMORY - triggering graceful restart');
    triggerGracefulRestart();
  }
}, 60000); // Check every minute

// Force garbage collection
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 5 * 60 * 1000); // Every 5 minutes
}

// Restart every 24 hours proactively
setInterval(() => {
  console.log('Scheduled restart - 24 hour uptime limit');
  gracefulShutdown();
}, 24 * 60 * 60 * 1000);
```

---

### SCENARIO 6: PAYMENT DUPLICATION (SEV-1)

**Detection:** Admin reports tenant charged twice for same bill

**Immediate Actions (0-15 min):**
```bash
# 1. Verify in database
sqlite3 data/rms.db
SELECT * FROM payments WHERE bill_id = 123;
# If multiple payments same amount/date: CONFIRMED DUPLICATE

# 2. Identify root cause
# - Check webhook logs for duplicate calls
# - Check timestamps (both within seconds?)
# - Check idempotency key (if implemented)

# 3. Immediate action: Reject second payment
UPDATE payments SET status = 'rejected', reject_reason = 'Duplicate of payment #X' 
WHERE id = SECOND_PAYMENT_ID;

# 4. Notify admin
curl -X POST https://slack.com/webhook \
  -d '{"text":"Payment duplicate detected and rejected - Bill #123, Tenant ABC"}'

# 5. Mark bill correctly
UPDATE bills SET status = 'paid' WHERE id = 123;
```

**Long-term Fix:**
```javascript
// Implement idempotency key requirement
router.post('/api/payment', (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  
  if (!idempotencyKey) {
    return res.status(400).json({ 
      error: 'idempotency-key header required' 
    });
  }

  // Check if payment already processed
  const existing = db.prepare(`
    SELECT * FROM payments WHERE idempotency_key = ?
  `).get(idempotencyKey);

  if (existing) {
    // Return cached response
    return res.status(200).json({ 
      message: 'Payment already processed',
      payment_id: existing.id 
    });
  }

  // Process new payment
  const payment = processPayment(req.body);
  
  // Store idempotency key
  db.prepare(`
    INSERT INTO payment_idempotency (idempotency_key, payment_id)
    VALUES (?, ?)
  `).run(idempotencyKey, payment.id);

  res.json(payment);
});
```

**Customer Communication:**
```
Subject: Your recent payment - Duplicate transaction reversed

Dear [Tenant Name],

We detected a duplicate payment for Bill #123. 
- First payment: APPROVED (5,000 THB) ✓
- Second payment: REJECTED (duplicate)

Your account shows correct payment of 5,000 THB.

If you see duplicate charges in your bank account, 
it's a temporary hold that will be released within 2-3 business days.

Thank you for your understanding.
- RMS Admin
```

---

### SCENARIO 7: API TIMEOUT (SEV-2)

**Detection:** Client-side error "Request timeout after 8 seconds"

**Immediate Actions (0-5 min):**
```bash
# 1. Check server response time
curl -w "@curl-format.txt" -o /dev/null -s \
  http://localhost:3000/api/admin/dashboard
# Look for "time_total"

# 2. Check database query time
EXPLAIN QUERY PLAN SELECT ... [slow query];

# 3. Identify slow endpoint
grep "time_total > 8000" /var/log/rms/app.log

# 4. Temporarily increase timeout (client-side)
# In config: API_TIMEOUT=15000

# 5. Restart to apply
systemctl restart rms-platform
```

**Long-term Solution:**
```javascript
// 1. Add query timeout
db.prepare('SELECT * FROM bills').all(); // Potential slowness

// Better:
const timeout = 5000;
const statement = db.prepare(`
  SELECT * FROM bills WHERE dormitory_id = ? 
  ORDER BY created_at DESC LIMIT 100
`);
// Execute with implicit timeout via query structure

// 2. Add caching
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5 min

app.get('/api/admin/dashboard', (req, res) => {
  const cacheKey = `dashboard_${req.dormitoryId}`;
  const cached = cache.get(cacheKey);
  
  if (cached) return res.json(cached);
  
  const data = generateDashboard(req.dormitoryId);
  cache.set(cacheKey, data);
  
  res.json(data);
});

// 3. Add database indexes
CREATE INDEX idx_bills_dormitory ON bills(dormitory_id, created_at DESC);
CREATE INDEX idx_rooms_dormitory ON rooms(dormitory_id);
```

---

### SCENARIO 8: SERVER CRASH (SEV-1)

**Detection:** SSH connection OK, but http://localhost:3000 unreachable

**Immediate Actions (0-5 min):**
```bash
# 1. Check if process is running
ps aux | grep "node server.js"
# If not listed: Process crashed

# 2. Check logs for crash
tail -100 /var/log/rms/error.log
grep "FATAL\|Error\|CRASH" /var/log/rms/error.log

# 3. Restart immediately
systemctl restart rms-platform

# OR if systemd not configured:
cd /app/rms
npm start &
disown

# 4. Verify recovery
curl http://localhost:3000/health
# Should return 200 with {"status":"UP"}

# 5. Check application logs
tail -20 /var/log/rms/app.log
```

**Permanent Solution:**
```bash
# 1. Setup systemd service
cat > /etc/systemd/system/rms-platform.service << EOF
[Unit]
Description=RMS Platform
After=network.target

[Service]
Type=simple
User=rms
WorkingDirectory=/app/rms
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable rms-platform
systemctl start rms-platform

# 2. Setup process monitoring
# Use PM2
npm install -g pm2
pm2 start server.js --name rms-platform
pm2 startup
pm2 save

# 3. Setup alerts
# If process restarts >3 times in 5 min: ALERT
```

---

### SCENARIO 9: DEPLOYMENT FAILURE (SEV-1)

**Detection:** After deployment, API returns 500 errors or won't start

**Immediate Actions (0-5 min):**
```bash
# 1. Check deployment logs
tail -100 /var/log/rms/deploy.log
docker logs rms-platform

# 2. Identify issue
# Common causes:
# - Database schema mismatch
# - Missing environment variable
# - Dependency conflict
# - Code syntax error

# 3. Immediate rollback to previous version
git log --oneline -5
git revert HEAD
npm install
npm start

# OR
docker image ls
docker run -d rms-platform:v1.2.3

# 4. Verify recovery
curl http://localhost:3000/health
```

**Prevention:**
```bash
# 1. Test before deploy
npm run test:integration
npm run test:e2e

# 2. Blue-green deployment
# Deploy to v2.0 instance while v1.9 still running
# Test v2.0 completely
# Switch traffic to v2.0
# Keep v1.9 as rollback

# 3. Automated rollback on health check failure
if ! curl -f http://localhost:3000/health; then
  echo "Health check failed - rolling back"
  git revert HEAD
  npm start
  systemctl restart rms-platform
fi

# 4. Canary deployment
# Deploy to 1 instance
# Send 5% traffic
# Monitor for 10 minutes
# If error rate < 1%, deploy to remaining instances
```

---

## 📊 RECOVERY TIME OBJECTIVES (RTO) & RECOVERY POINT OBJECTIVES (RPO)

### Current System (Before Fixes):

| Scenario | RTO | RPO | Impact |
|----------|-----|-----|--------|
| Database Disconnection | 30 min | 24 hours | CRITICAL |
| Redis Failure | 10 min | Sessions lost | HIGH |
| Server Crash | 10 min | 1 minute | HIGH |
| Storage Full | 30 min | No loss | MEDIUM |
| Payment Duplication | 1 hour | Manual correction | CRITICAL |
| API Timeout | N/A (timeout) | N/A | MEDIUM |
| Deployment Failure | 20 min | Point of deployment | HIGH |

### Target System (After Fixes):

| Scenario | RTO | RPO | Impact |
|----------|-----|-----|--------|
| Database Disconnection | 5 min | 1 hour | LOW |
| Redis Failure | 2 min | Minimal | LOW |
| Server Crash | 2 min | <1 min | LOW |
| Storage Full | 10 min | No loss | LOW |
| Payment Duplication | 1 min | Prevented | NONE |
| API Timeout | <1 sec | None | NONE |
| Deployment Failure | 2 min | Previous version | LOW |

---

## 🔔 ALERTING TRIGGERS & ESCALATION

### Alert Definitions:

```
ALERT: Database Connection Failed
  Severity: SEV-1
  Condition: Query error "database is closed" X5 in 1 minute
  Action: PagerDuty (immediate)
  On-Call: DBA + SRE
  
ALERT: Redis Connection Failed
  Severity: SEV-2
  Condition: ECONNREFUSED X5 in 1 minute
  Action: PagerDuty + Slack
  On-Call: SRE

ALERT: High CPU (>80% for 5 min)
  Severity: SEV-2
  Condition: CPU average >80% over 5 minutes
  Action: Slack notification
  Manual check if>90%

ALERT: Memory Leak (grows >50MB/min)
  Severity: SEV-2
  Condition: Heap memory increase >50MB/minute sustained
  Action: Slack + schedule restart
  On-Call: SRE

ALERT: Disk Full (<5% free)
  Severity: SEV-1
  Condition: Disk usage >95%
  Action: PagerDuty
  On-Call: DevOps + SRE

ALERT: Payment Processing Slow (>5 sec)
  Severity: SEV-3
  Condition: Payment endpoint p95 > 5 seconds
  Action: Slack notification
  Manual review of slow queries

ALERT: Deployment Failed
  Severity: SEV-1
  Condition: Deployment process exits with error
  Action: PagerDuty + automatic rollback
  On-Call: DevOps
```

---

## 📞 ESCALATION PROCEDURE

```
0 minutes: Alert triggered
  - Automated alert to Slack
  - On-call engineer paged

5 minutes: No response
  - Escalate to backup on-call
  - Create incident in incident tracking

15 minutes: Issue not resolved
  - Page team lead
  - Create bridge call: incidents.slack.com

30 minutes: Critical issue still ongoing
  - Notify customer success team to prepare communication
  - Document incident timeline

60 minutes: Extended outage
  - Executive notification
  - Status page update
  - Customer communication

2 hours: Ongoing critical outage
  - Post-incident review call
  - Begin restoration from backups if needed
```

---

## ✅ INCIDENT CHECKLIST

### During Incident:

- [ ] Identify SEV level
- [ ] Page on-call engineer
- [ ] Create Slack thread for coordination
- [ ] Document timeline of events
- [ ] Begin recovery procedure
- [ ] Update status page every 15 min
- [ ] Communicate with customers if >15 min

### After Recovery:

- [ ] Confirm service fully restored
- [ ] Run health checks
- [ ] Verify data integrity
- [ ] Close incident ticket
- [ ] Schedule postmortem (within 24 hours)
- [ ] Assign action items for prevention

### Postmortem (Within 24 hours):

- [ ] Timeline: What happened and when
- [ ] Impact: How many users, how long, revenue loss
- [ ] Root cause: Why did it happen
- [ ] Recovery: What we did to fix
- [ ] Prevention: How to prevent next time
- [ ] Lessons learned: What we'll do differently

---

## 📈 MONITORING DASHBOARD SETUP

### Required Metrics:

```
1. Availability
   - % uptime
   - Alert if <99.5%

2. Latency
   - p50, p95, p99 response times
   - Alert if p95 > 5 seconds

3. Error Rate
   - % of requests returning 5xx
   - Alert if >1%

4. Database Health
   - Connection count
   - Query latency
   - Replication lag (if applicable)
   - Alert if any connection failed

5. Cache Performance
   - Hit rate
   - Eviction rate
   - Alert if hit rate < 60%

6. System Resources
   - CPU usage
   - Memory usage
   - Disk space
   - Network I/O
   - Alert thresholds: CPU >80%, Memory >85%, Disk >90%

7. Business Metrics
   - Payments processed per hour
   - Billing cycles completed
   - Failed transactions
   - Alert if abnormal pattern
```

---

**This handbook should be posted in:**
- War room (printed)
- Wiki (digital)
- Slack channel #incidents
- On-call Runbook

**Review & Update:** Quarterly (after each major incident)

