# RMS — LINE-First Dormitory Management System

ระบบจัดการหอพักผ่าน LINE เป็นหลัก รองรับหลายหอพัก, LINE Login, Invite Link, AI Chatbot

---

## Stack

| ส่วน | เทคโนโลยี | ฟรีหรือไม่ |
|---|---|---|
| Backend | Node.js + Express | ✅ |
| Database | SQLite (file-based) | ✅ |
| LINE Messaging | LINE Messaging API | ✅ 500 push/เดือน |
| LINE Login | LINE Login + LIFF | ✅ |
| AI Chatbot | Google Gemini 1.5 Flash | ✅ 15 req/นาที |
| Hosting | Railway / Render | ✅ free tier |

---

## วิธีติดตั้ง (Local)

### 1. ติดตั้ง Dependencies

```bash
cd C:\Users\User\Documents\RMS
npm install
```

### 2. ตั้งค่า Environment

```bash
copy .env.example .env
```

แก้ไข `.env`:
- `SESSION_SECRET` — เปลี่ยนเป็น random string ยาวๆ
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — กำหนด login แอดมิน
- `DORMITORY_NAME` — ชื่อหอพัก

### 3. Seed ข้อมูลเริ่มต้น

```bash
node scripts/seed.js
```

### 4. รัน Server

```bash
npm start
# หรือ
npm run dev   # auto-restart เมื่อแก้ไฟล์
```

เปิด Admin Panel: **http://localhost:3000/admin**

---

## การตั้งค่า LINE (ทีละขั้น)

### Step 1 — สร้าง LINE Messaging API Channel

1. ไปที่ [LINE Developers Console](https://developers.line.biz)
2. สร้าง Provider → สร้าง Channel ประเภท **Messaging API**
3. คัดลอก:
   - **Channel ID** → `LINE_CHANNEL_ID`
   - **Channel Secret** → `LINE_CHANNEL_SECRET`
   - **Channel Access Token** (Long-lived) → `LINE_CHANNEL_ACCESS_TOKEN`
4. ตั้ง Webhook URL: `https://your-domain.com/line/webhook/{dormitory_id}`
   - dormitory_id ดูได้จาก output ของ `node scripts/seed.js`
   - เปิด **Use webhook** = ON
   - ปิด **Auto-reply** = OFF

### Step 2 — สร้าง LINE Login Channel + LIFF

1. สร้าง Channel ประเภท **LINE Login**
2. ไป tab **LIFF** → Add → ตั้งค่า:
   - **LIFF App Name**: ชื่อหอพัก
   - **Size**: Full
   - **Endpoint URL**: `https://your-domain.com/liff/`
   - **Scope**: profile, openid
3. คัดลอก **LIFF ID** → `LIFF_ID`

### Step 3 — กรอก LINE Config ใน Admin Panel

1. เปิด Admin Panel → ตั้งค่าระบบ
2. กรอก Channel ID, Secret, Access Token, LIFF ID
3. กรอกเบอร์พร้อมเพย์ + ชื่อบัญชี

---

## Flow การใช้งาน

```
เจ้าของหอ (Admin Web)
  ├── Login → Admin Panel
  ├── เพิ่มห้องพัก
  ├── กด "สร้าง Invite Link" → ได้ URL
  └── ส่งลิงก์ให้ลูกบ้านผ่าน LINE

ลูกบ้าน (LINE)
  ├── คลิก Invite Link → เปิด LIFF
  ├── LINE Login อัตโนมัติ
  ├── ยืนยันห้อง → ผูก LINE กับห้อง
  └── ใช้งาน LIFF: ดูบิล / ส่งสลิป / แจ้งซ่อม

ระบบอัตโนมัติ
  ├── Admin ออกบิล → ส่ง LINE ให้ลูกบ้านทุกห้อง
  ├── ลูกบ้านส่งสลิปใน LINE → บันทึกเข้าระบบ
  ├── Admin กด "อนุมัติ" → ส่งใบเสร็จกลับ LINE
  └── AI ตอบคำถามอัตโนมัติ 24/7
```

---

## Hosting ฟรี (แนะนำ)

### Railway (แนะนำที่สุด)

```bash
# ติดตั้ง Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up
```

- ได้ URL `https://xxx.railway.app`
- ใส่ Environment Variables ใน Railway Dashboard
- SQLite file จะเก็บใน persistent volume

### Render

1. สร้าง account ที่ render.com
2. New → Web Service → เชื่อม GitHub repo
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. ตั้ง Environment Variables

---

## Structure

```
RMS/
├── server.js              # Entry point
├── src/
│   ├── db/database.js     # SQLite schema + connection
│   ├── routes/
│   │   ├── admin.js       # Admin API (/api/admin/*)
│   │   ├── tenant.js      # Tenant API (/api/tenant/*)
│   │   ├── line.js        # LINE Webhook + Invite join
│   │   └── auth.js        # Login/Logout/LINE verify
│   ├── services/
│   │   ├── lineService.js # LINE API calls + message templates
│   │   ├── billingService.js # คำนวณบิล
│   │   └── aiService.js   # Gemini chatbot
│   └── middleware/auth.js # Session check
├── public/
│   ├── admin/index.html   # Admin SPA
│   └── liff/
│       ├── index.html     # Tenant dashboard (LIFF)
│       └── join.html      # Invite link page
├── scripts/seed.js        # สร้างข้อมูลเริ่มต้น
├── uploads/               # รูปสลิป + แจ้งซ่อม
├── data/rms.db            # SQLite database
└── .env                   # Environment variables
```
