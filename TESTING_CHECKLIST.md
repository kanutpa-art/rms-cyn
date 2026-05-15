# PRODUCTION READINESS TESTING & VALIDATION CHECKLIST
## RMS Platform - Pre-Deployment Quality Assurance

**Date:** May 13, 2026  
**Purpose:** Comprehensive checklist for validating platform readiness before production deployment  
**Use By:** QA Engineers, DevOps, SREs, Product Team  

---

## 🎯 PHASE 1: SECURITY TESTING

### Authentication & Authorization

- [ ] **Admin Login Validation**
  - [ ] Valid credentials → Login succeeds
  - [ ] Invalid password → Login fails with rate limiting
  - [ ] Account locked after 5 failed attempts
  - [ ] Lockout duration: 15 minutes
  - [ ] Test case:
    ```bash
    POST /api/auth/login
    { "email": "admin@rms.local", "password": "wrong" }
    # Attempt 5 times, verify lockout
    ```

- [ ] **Session Management**
  - [ ] Session created after login
  - [ ] Session stored in Redis (encrypted)
  - [ ] Session expires after 30 minutes inactivity
  - [ ] Session destroyed on logout
  - [ ] Test case:
    ```bash
    # Login
    curl -c cookies.txt -X POST http://api.rms.local/api/auth/login
    # Wait 31 minutes, verify expired
    curl -b cookies.txt http://api.rms.local/api/admin/dashboard
    # Expected: 401 Unauthorized
    ```

- [ ] **HTTPS Enforcement**
  - [ ] HTTP requests redirect to HTTPS
  - [ ] HSTS header present (max-age=31536000)
  - [ ] Certificates valid (not expired)
  - [ ] TLS 1.2+ only
  - [ ] Test case:
    ```bash
    curl -I http://api.rms.local/api/admin
    # Expected: 301 with Location: https://...
    curl -I https://api.rms.local/api/admin
    # Expected: Strict-Transport-Security header
    ```

- [ ] **CSRF Protection**
  - [ ] GET /admin/dashboard returns CSRF token
  - [ ] POST /api/admin/bill without token → 403 Forbidden
  - [ ] POST /api/admin/bill with valid token → Succeeds
  - [ ] Test case:
    ```javascript
    const token = await fetch('/admin/dashboard').then(r => r.json()).csrfToken;
    await fetch('/api/admin/bill', {
      method: 'POST',
      headers: { 'X-CSRF-Token': token },
      body: billData
    }); // Should succeed
    ```

- [ ] **Multi-Tenant Isolation**
  - [ ] Admin from Dorm A cannot access Dorm B data via API
  - [ ] Query parameter manipulation (dorm_id=999) rejected
  - [ ] Database-level validation confirms isolation
  - [ ] Test case:
    ```bash
    # Login as admin from Dormitory 1
    curl -b cookies.txt "http://api.rms.local/api/admin/dashboard?dorm_id=2"
    # Expected: 403 Forbidden (Access denied)
    ```

---

### Input Validation

- [ ] **SQL Injection Prevention**
  - [ ] Parameterized queries used throughout codebase
  - [ ] No string concatenation in SQL
  - [ ] Malicious input rejected:
    ```bash
    POST /api/admin/billing
    { "room_id": "1; DROP TABLE bills; --" }
    # Expected: 400 Bad Request (Invalid room_id)
    ```

- [ ] **XSS Prevention**
  - [ ] Special characters escaped in output
  - [ ] No JavaScript execution in tenant input
  - [ ] Test case:
    ```bash
    POST /api/tenant/profile
    { "notes": "<script>alert('xss')</script>" }
    # When displayed, script should be escaped:
    # &lt;script&gt;alert('xss')&lt;/script&gt;
    ```

- [ ] **File Upload Validation**
  - [ ] Only allowed MIME types accepted (JPEG, PNG, PDF)
  - [ ] File size limit enforced (5MB max)
  - [ ] Executable files rejected (.exe, .sh, .php)
  - [ ] Filename sanitized
  - [ ] Test case:
    ```bash
    # Upload .exe file
    curl -F "slip=@malware.exe" http://api.rms.local/api/tenant/payment
    # Expected: 400 Bad Request (Invalid file type)
    ```

- [ ] **API Input Validation**
  - [ ] Amount field: Only positive numbers, max 999,999
  - [ ] Email field: Valid email format
  - [ ] Phone field: Valid format for region
  - [ ] Date field: Valid date range
  - [ ] Test case:
    ```bash
    POST /api/admin/tenant/add
    { "email": "invalid-email", "amount": -100 }
    # Expected: 400 Bad Request with field errors
    ```

---

### Rate Limiting

- [ ] **Login Rate Limiting**
  - [ ] 5 attempts per 15 minutes per IP
  - [ ] 6th attempt blocked with 429 Too Many Requests
  - [ ] Test case:
    ```bash
    # Make 6 login attempts rapidly
    for i in {1..6}; do
      curl -X POST http://api.rms.local/api/auth/login \
        -d '{"email":"admin@rms.local","password":"wrong"}'
    done
    # Expected: 6th request returns 429
    ```

- [ ] **API Rate Limiting**
  - [ ] 100 requests per minute per user
  - [ ] 101st request returns 429
  - [ ] Test case:
    ```bash
    for i in {1..101}; do
      curl -b cookies.txt http://api.rms.local/api/admin/dashboard &
    done
    wait
    # Expected: Some requests return 429
    ```

- [ ] **File Upload Rate Limiting**
  - [ ] 10 uploads per minute per user
  - [ ] 11th upload rejected
  - [ ] Test case:
    ```bash
    for i in {1..11}; do
      curl -b cookies.txt -F "slip=@receipt.jpg" \
        http://api.rms.local/api/tenant/payment &
    done
    wait
    # Expected: 11th upload returns 429
    ```

---

### Security Headers

- [ ] **Required Headers Present**
  ```bash
  curl -I https://api.rms.local/api/admin/dashboard
  
  Expected headers:
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: DENY
  - X-XSS-Protection: 1; mode=block
  - Strict-Transport-Security: max-age=31536000
  - Content-Security-Policy: ...
  - Referrer-Policy: strict-origin-when-cross-origin
  ```

---

## 🎯 PHASE 2: DATA INTEGRITY TESTING

### Payment Processing

- [ ] **Duplicate Payment Prevention**
  - [ ] First payment submission succeeds
  - [ ] Duplicate submission rejected with 409 Conflict
  - [ ] Bill marked as paid once
  - [ ] Test case:
    ```bash
    # Submit payment slip for Bill 123
    curl -b cookies.txt -F "slip=@receipt.jpg" \
      -H "Idempotency-Key: uuid-1" \
      http://api.rms.local/api/tenant/payment
    # Response: {"payment_id": 501, "status": "pending"}
    
    # Submit same slip again
    curl -b cookies.txt -F "slip=@receipt.jpg" \
      -H "Idempotency-Key: uuid-1" \
      http://api.rms.local/api/tenant/payment
    # Expected: {"payment_id": 501, "status": "pending"} (same response)
    
    # Submit with different idempotency key
    curl -b cookies.txt -F "slip=@receipt.jpg" \
      -H "Idempotency-Key: uuid-2" \
      http://api.rms.local/api/tenant/payment
    # Expected: 409 Conflict - "Payment already processing for this bill"
    ```

- [ ] **Concurrent Payment Handling**
  - [ ] Two simultaneous payments for same bill → Only one succeeds
  - [ ] Second payment rejected
  - [ ] Test case:
    ```javascript
    // Simulate concurrent payments
    const payment1 = fetch('/api/tenant/payment', {
      method: 'POST',
      body: formData,
      headers: { 'Idempotency-Key': 'uuid-1' }
    });
    
    const payment2 = fetch('/api/tenant/payment', {
      method: 'POST',
      body: formData,
      headers: { 'Idempotency-Key': 'uuid-2' }
    });
    
    const [res1, res2] = await Promise.all([payment1, payment2]);
    // Expected: One 200, one 409
    ```

- [ ] **Payment Status Atomicity**
  - [ ] Payment approved → Immediately reflected in bill status
  - [ ] No race condition between payment insert and bill update
  - [ ] Test case:
    ```bash
    # Get bill before payment
    GET /api/admin/bill/123
    # Response: {"status": "overdue", "amount_due": 5000}
    
    # Approve payment
    POST /api/admin/payment/501/approve
    
    # Get bill immediately after
    GET /api/admin/bill/123
    # Response: {"status": "paid", "amount_due": 0}
    ```

---

### Billing Calculation

- [ ] **Meter Reading Validation**
  - [ ] Negative readings rejected
  - [ ] Readings going backwards rejected
  - [ ] Excessive jumps (>20%) flagged for manual review
  - [ ] Test case:
    ```bash
    POST /api/admin/meter/update
    { "room_id": 1, "current": -50 }
    # Expected: 400 Bad Request (Invalid meter reading)
    
    POST /api/admin/meter/update
    { "room_id": 1, "previous": 100, "current": 50 }
    # Expected: 400 Bad Request (Meter cannot decrease)
    
    POST /api/admin/meter/update
    { "room_id": 1, "previous": 100, "current": 250 } # 150% jump
    # Expected: 400 Bad Request (Meter jump too large)
    ```

- [ ] **Bill Amount Validation**
  - [ ] Bill amount always ≥ 0
  - [ ] No negative bills created
  - [ ] Test case:
    ```bash
    POST /api/admin/bill/generate
    { "room_id": 1, "rent": 5000, "utilities": [{"unit": -50, "rate": 5}] }
    # Expected: 400 Bad Request (Invalid utility calculation)
    ```

- [ ] **Late Fee Calculation**
  - [ ] Late fee added correctly based on policy
  - [ ] Late fee doesn't compound infinitely
  - [ ] Maximum late fee enforced
  - [ ] Test case:
    ```bash
    # Create bill due 30 days ago
    POST /api/admin/bill/generate
    { "room_id": 1, "due_date": "2026-04-13" }
    
    # Generate collection reminders
    POST /api/admin/collection/run
    
    # Verify late fee added (once)
    GET /api/admin/bill/123
    # Response: { "late_fee": 500, "total": 5500 }
    # Run collection again
    POST /api/admin/collection/run
    
    # Verify late fee NOT compounded
    GET /api/admin/bill/123
    # Response: { "late_fee": 500, "total": 5500 } (unchanged)
    ```

---

### Cascading Operations

- [ ] **Room Deletion Cascade**
  - [ ] Delete room → Tenants dissociated
  - [ ] Delete room → Bills marked as archived (not deleted)
  - [ ] Delete room → Payments preserved
  - [ ] Test case:
    ```bash
    DELETE /api/admin/room/42
    # Check database
    SELECT * FROM rooms WHERE id = 42;
    # Expected: Empty result
    SELECT * FROM tenants WHERE room_id = 42;
    # Expected: Empty result (or room_id = NULL)
    SELECT * FROM bills WHERE room_id = 42;
    # Expected: Bills still exist (preserved for audit)
    ```

- [ ] **Tenant Deletion Cascade**
  - [ ] Delete tenant → Payments preserved
  - [ ] Delete tenant → Bills marked as archived
  - [ ] No orphaned records
  - [ ] Test case:
    ```bash
    DELETE /api/admin/tenant/99
    # Check database
    SELECT * FROM tenants WHERE id = 99;
    # Expected: Empty result
    SELECT * FROM payments WHERE tenant_id = 99;
    # Expected: All payments preserved (status unchanged)
    ```

---

## 🎯 PHASE 3: OPERATIONAL TESTING

### Database Operations

- [ ] **Database Connectivity**
  - [ ] Server starts → Database automatically connected
  - [ ] Connection pool working (max 10 connections)
  - [ ] Idle connections closed after 30 minutes
  - [ ] Test case:
    ```bash
    npm start
    # Wait for "Database connected" log
    # Monitor: ps aux | grep sqlite3
    # Should show active connection
    ```

- [ ] **Database Recovery**
  - [ ] Service recovers automatically if connection drops
  - [ ] Reconnect happens within 5 seconds
  - [ ] No data loss on recovery
  - [ ] Test case:
    ```bash
    # Kill database connection
    fuser -k 8888/tcp # (if applicable)
    # OR corrupt database temporarily
    
    # Service should:
    # 1. Detect connection lost
    # 2. Log error
    # 3. Attempt reconnect
    # 4. Succeed within 5 seconds
    
    # Verify in logs:
    grep "Database reconnected" /var/log/rms/app.log
    ```

- [ ] **Database Integrity**
  - [ ] PRAGMA integrity_check passes
  - [ ] Foreign keys enforced
  - [ ] No orphaned records
  - [ ] Test case:
    ```bash
    sqlite3 /app/rms/data/rms.db "PRAGMA integrity_check;"
    # Expected: ok
    ```

---

### Session Management

- [ ] **Session Persistence**
  - [ ] Session stored in Redis
  - [ ] Session survives server restart (if database intact)
  - [ ] Session data encrypted at rest
  - [ ] Test case:
    ```bash
    # Login
    curl -c cookies.txt -X POST http://api.rms.local/api/auth/login \
      -d '{"email":"admin@rms.local","password":"correct"}'
    
    # Access dashboard (should work)
    curl -b cookies.txt http://api.rms.local/api/admin/dashboard
    # Expected: 200 OK
    
    # Restart server
    systemctl restart rms-platform
    
    # Access dashboard again (session should persist)
    curl -b cookies.txt http://api.rms.local/api/admin/dashboard
    # Expected: 200 OK (session preserved)
    ```

- [ ] **Session Expiration**
  - [ ] Session expires after 30 minutes
  - [ ] Expired session returns 401
  - [ ] Test case:
    ```bash
    # Login
    curl -c cookies.txt -X POST http://api.rms.local/api/auth/login
    
    # Wait 31 minutes
    sleep 1860
    
    # Try to access
    curl -b cookies.txt http://api.rms.local/api/admin/dashboard
    # Expected: 401 Unauthorized
    ```

---

### File Upload

- [ ] **Upload Functionality**
  - [ ] Valid file uploads succeed
  - [ ] File stored in /uploads/slips/
  - [ ] Filename sanitized (no path traversal)
  - [ ] Test case:
    ```bash
    curl -b cookies.txt \
      -F "slip=@payment_receipt.jpg" \
      http://api.rms.local/api/tenant/payment
    # Response: {"payment_id": 501, "filename": "1715000000_payment_receipt.jpg"}
    
    # Verify file exists
    ls -la /app/rms/uploads/slips/
    # Should show: 1715000000_payment_receipt.jpg
    ```

- [ ] **Upload Security**
  - [ ] Malicious files rejected
  - [ ] Path traversal prevented (../../../etc/passwd rejected)
  - [ ] Test case:
    ```bash
    # Try to upload .exe
    curl -b cookies.txt \
      -F "slip=@malware.exe" \
      http://api.rms.local/api/tenant/payment
    # Expected: 400 Bad Request
    
    # Try path traversal
    curl -b cookies.txt \
      -F "slip=@../../../etc/passwd" \
      http://api.rms.local/api/tenant/payment
    # Expected: 400 Bad Request
    ```

---

### Logging & Audit

- [ ] **Audit Logging**
  - [ ] All admin actions logged
  - [ ] Logs include: admin_id, action, timestamp, details
  - [ ] Logs not modifiable by admins
  - [ ] Test case:
    ```bash
    # Admin creates bill
    POST /api/admin/bill/generate
    { "room_id": 1, "amount": 5000 }
    
    # Check audit logs
    sqlite3 /app/rms/data/rms.db
    SELECT * FROM audit_logs WHERE admin_id = 1 ORDER BY timestamp DESC LIMIT 1;
    # Expected: Row with action='CREATE', resource_type='bill', changes included
    ```

- [ ] **Error Logging**
  - [ ] All errors logged to /var/log/rms/error.log
  - [ ] Stack traces preserved for debugging
  - [ ] No sensitive data in logs
  - [ ] Test case:
    ```bash
    # Trigger error
    curl http://api.rms.local/api/admin/nonexistent
    
    # Check logs
    tail /var/log/rms/error.log
    # Should show: 404 Not Found error, no passwords/tokens
    ```

---

## 🎯 PHASE 4: PERFORMANCE TESTING

### Response Time

- [ ] **Dashboard Load**
  - [ ] GET /api/admin/dashboard < 2 seconds (p95)
  - [ ] Test case:
    ```bash
    ab -n 100 -c 10 http://api.rms.local/api/admin/dashboard
    # Analyze: Time per request, p95 should be <2s
    ```

- [ ] **Billing Generation**
  - [ ] POST /api/admin/bill/generate < 5 seconds (for 100 rooms)
  - [ ] Test case:
    ```bash
    time curl -b cookies.txt -X POST http://api.rms.local/api/admin/bill/generate \
      -d '{"dormitory_id": 1, "month": 5, "year": 2026}'
    # Expected: ~3-4 seconds
    ```

- [ ] **Payment Processing**
  - [ ] POST /api/tenant/payment < 3 seconds
  - [ ] Test case:
    ```bash
    time curl -b cookies.txt -F "slip=@receipt.jpg" \
      http://api.rms.local/api/tenant/payment
    # Expected: ~2 seconds
    ```

---

### Resource Usage

- [ ] **Memory Usage**
  - [ ] Baseline: < 200 MB
  - [ ] Under load: < 500 MB
  - [ ] No memory leaks after 24 hours
  - [ ] Test case:
    ```bash
    # Monitor memory
    watch -n 1 "ps aux | grep 'node server.js'"
    
    # Run load test
    ab -n 10000 -c 50 http://api.rms.local/api/admin/dashboard
    
    # Monitor again
    watch -n 1 "ps aux | grep 'node server.js'"
    # Expected: RSS returns to baseline
    ```

- [ ] **CPU Usage**
  - [ ] Baseline: < 5% idle
  - [ ] Under load: < 80%
  - [ ] No sustained high CPU
  - [ ] Test case:
    ```bash
    # Monitor CPU
    top -b -n 1 | grep node
    
    # Run load test
    ab -n 10000 -c 50 http://api.rms.local/api/admin/dashboard
    
    # CPU should spike then return to baseline
    ```

- [ ] **Disk Usage**
  - [ ] Database: < 100 MB (for test data)
  - [ ] Upload directory: Monitor growth
  - [ ] Test case:
    ```bash
    du -sh /app/rms/data/
    du -sh /app/rms/uploads/
    ```

---

### Concurrent Users

- [ ] **100 Concurrent Users**
  - [ ] No 5xx errors
  - [ ] p95 latency < 5 seconds
  - [ ] Test case:
    ```bash
    ab -n 1000 -c 100 http://api.rms.local/api/admin/dashboard
    # Expected: ~5% error rate maximum
    ```

- [ ] **Billing Generation at Scale**
  - [ ] Generate bills for 1000 rooms
  - [ ] Completes within 30 seconds
  - [ ] No memory exhaustion
  - [ ] Test case:
    ```bash
    time curl -b cookies.txt -X POST http://api.rms.local/api/admin/bill/generate \
      -d '{"dormitory_id": 1, "rooms": 1000}'
    # Expected: 20-30 seconds
    ```

---

## 🎯 PHASE 5: INTEGRATION TESTING

### LINE Integration

- [ ] **Webhook Handling**
  - [ ] Valid webhook accepted
  - [ ] Invalid signature rejected
  - [ ] Duplicate webhook handled (idempotency)
  - [ ] Test case:
    ```bash
    # Send valid webhook (with correct signature)
    curl -X POST http://api.rms.local/api/webhook/1 \
      -H "X-Line-Signature: [valid_signature]" \
      -d '{"events":[{"type":"message","message":{"text":"test"}}]}'
    # Expected: 200 OK
    
    # Send invalid signature
    curl -X POST http://api.rms.local/api/webhook/1 \
      -H "X-Line-Signature: invalid_signature" \
      -d '{"events":[{"type":"message","message":{"text":"test"}}]}'
    # Expected: 403 Forbidden
    ```

- [ ] **LINE Message Sending**
  - [ ] Tenant receives payment reminder
  - [ ] Message format correct
  - [ ] No errors in logs
  - [ ] Test case:
    ```bash
    # Trigger collection
    POST /api/admin/collection/run
    
    # Verify tenant receives LINE message
    # (Manual verification via LINE app)
    
    # Check logs for success
    grep "LINE message sent" /var/log/rms/app.log
    ```

---

### Notifications

- [ ] **Email Notifications** (if enabled)
  - [ ] Admin receives bill notifications
  - [ ] Tenant receives payment reminders
  - [ ] Test case:
    ```bash
    # Create bill
    POST /api/admin/bill/generate
    
    # Check email inbox
    # Should receive notification within 5 minutes
    ```

---

## 🎯 PHASE 6: DISASTER RECOVERY

### Backup & Restore

- [ ] **Backup Creation**
  - [ ] Daily backup script runs
  - [ ] Backup uploaded to S3
  - [ ] Backup size reasonable
  - [ ] Test case:
    ```bash
    # Manually run backup
    bash /app/backup.sh
    
    # Verify S3 upload
    aws s3 ls s3://rms-backups/daily/
    # Should show recent backup
    ```

- [ ] **Restore from Backup**
  - [ ] Backup can be restored
  - [ ] Data integrity preserved
  - [ ] System runs after restore
  - [ ] Test case:
    ```bash
    # Backup current database
    cp /app/rms/data/rms.db /app/rms/data/rms.db.latest
    
    # Restore from S3 backup
    aws s3 cp s3://rms-backups/daily/latest.db /app/rms/data/rms.db
    
    # Verify data integrity
    sqlite3 /app/rms/data/rms.db "PRAGMA integrity_check;"
    
    # Restart server
    systemctl restart rms-platform
    
    # Verify data accessible
    curl -b cookies.txt http://api.rms.local/api/admin/dashboard
    # Expected: 200 OK
    ```

---

### Failover

- [ ] **Server Crash Recovery**
  - [ ] systemd auto-restarts service
  - [ ] Service recovers within 10 seconds
  - [ ] No data loss
  - [ ] Test case:
    ```bash
    # Kill server process
    pkill -f "node server.js"
    
    # Verify systemd restarts
    systemctl status rms-platform
    # Expected: active (running)
    
    # Verify service is accessible
    curl http://api.rms.local/api/health
    # Expected: 200 OK
    ```

---

## 🎯 PHASE 7: USER ACCEPTANCE TESTING (UAT)

### Happy Path Flows

- [ ] **Admin Dashboard**
  - [ ] Login succeeds
  - [ ] Dashboard displays correctly
  - [ ] All metrics visible
  - [ ] Test case: Manual walkthrough

- [ ] **Billing Process**
  - [ ] Admin creates bill
  - [ ] Bill calculated correctly
  - [ ] Tenant receives notification
  - [ ] Test case: Manual walkthrough

- [ ] **Payment Processing**
  - [ ] Tenant uploads slip
  - [ ] Admin approves payment
  - [ ] Bill marked as paid
  - [ ] Test case: Manual walkthrough

- [ ] **Collection Workflow**
  - [ ] Overdue bill identified
  - [ ] Reminder sent to tenant
  - [ ] Escalation to collection if needed
  - [ ] Test case: Manual walkthrough

---

## ✅ FINAL SIGN-OFF

### QA Validation:
- [ ] All tests passed
- [ ] No critical/high issues open
- [ ] Performance baselines met
- [ ] Security controls verified
- [ ] Disaster recovery tested

### DevOps Validation:
- [ ] Monitoring alerts configured
- [ ] Backup process verified
- [ ] Recovery procedures tested
- [ ] Scaling parameters set

### Product Validation:
- [ ] All features working as specified
- [ ] User experience acceptable
- [ ] Performance acceptable to users
- [ ] Ready for customer use

### Security Validation:
- [ ] Penetration test complete
- [ ] All findings remediated
- [ ] Security headers present
- [ ] Authentication working

**Sign-Off Date:** __________

**QA Lead:** ________________  
**DevOps Lead:** ________________  
**Product Manager:** ________________  
**Security Officer:** ________________  

---

**DEPLOYMENT AUTHORIZED:**  
- [ ] YES - All checks passed, ready for production
- [ ] NO - Issues found, remediation needed before deployment

