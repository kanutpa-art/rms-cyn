# วิธี Deploy RMS ขึ้น cyn-jewelry.com/RMS

## ข้อกำหนด Server
- **Node.js 22+** (ต้องการ `node:sqlite` built-in — สำคัญมาก)
- **npm**
- **pm2** (`npm install -g pm2`)
- **nginx** พร้อม SSL บน cyn-jewelry.com

ตรวจ Node version: `node --version`  
ถ้าต่ำกว่า v22 ให้อัพเดทก่อน:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## ขั้นตอน Deploy

### 1. SSH เข้า Server
```bash
ssh user@cyn-jewelry.com
# หรือ
ssh -i ~/.ssh/your-key.pem user@<server-ip>
```

### 2. Clone/Upload โค้ด RMS
```bash
# วิธีที่ 1: git clone (ถ้ามี repo)
cd /var/www
git clone https://github.com/youruser/rms.git RMS
cd RMS

# วิธีที่ 2: upload ด้วย scp (จาก Windows)
# รันบน Windows ไม่ใช่ server:
# scp -r C:\Users\User\Documents\RMS user@cyn-jewelry.com:/var/www/RMS
```

### 3. ติดตั้ง Dependencies
```bash
cd /var/www/RMS
npm install --production
```

### 4. สร้างไฟล์ .env
```bash
cat > .env << 'EOF'
PORT=3001
BASE_PATH=/RMS
SESSION_SECRET=change-this-to-a-random-string-min-32-chars
NODE_ENV=production
EOF
```
> **สำคัญ**: เปลี่ยน `SESSION_SECRET` เป็น random string อื่น

### 5. สร้าง folder ที่จำเป็น
```bash
mkdir -p data uploads/slips uploads/maintenance uploads/move_out uploads/renewal data/sessions
chmod 755 uploads data
```

### 6. Start ด้วย pm2
```bash
pm2 start server.js --name "rms" --env production
pm2 save
pm2 startup   # ให้ RMS start อัตโนมัติเมื่อ server reboot
# copy คำสั่งที่ pm2 แสดงแล้วรัน (มักเป็น: sudo env PATH=... pm2 startup systemd ...)
```

ตรวจสอบว่า start สำเร็จ:
```bash
pm2 logs rms --lines 20
pm2 status
```
ควรเห็น: `🏠 RMS Server running on http://localhost:3001`

### 7. แก้ไข nginx Config
```bash
# หา config file ของ cyn-jewelry.com
sudo nano /etc/nginx/sites-available/cyn-jewelry.com
# หรือ
sudo nano /etc/nginx/conf.d/cyn-jewelry.com.conf
```

เพิ่มบรรทัดนี้ใน `server { ... }` block (ก่อน `}` ปิด):
```nginx
location = /RMS {
    return 301 /RMS/;
}
location /RMS/ {
    proxy_pass         http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_redirect     /  /RMS/;
    client_max_body_size 20M;
}
```

### 8. Test และ Reload nginx
```bash
sudo nginx -t          # ตรวจว่า config ถูกต้อง
sudo nginx -s reload   # reload โดยไม่ restart
```

---

## ทดสอบ

เปิดเบราเซอร์:
- `https://cyn-jewelry.com/RMS` → ต้อง redirect ไป `/RMS/admin`
- `https://cyn-jewelry.com/RMS/admin` → Admin Panel ✓
- `https://cyn-jewelry.com/RMS/operator` → Operator Portal ✓
- `https://cyn-jewelry.com/tenant/{share_token}` → Tenant Share Page ✓

---

## URL ที่ใช้งาน (หลัง Deploy)

| หน้า | URL |
|------|-----|
| Admin Panel | `https://cyn-jewelry.com/RMS/admin` |
| Operator Portal | `https://cyn-jewelry.com/RMS/operator` |
| Tenant Share Link | `https://cyn-jewelry.com/tenant/{token}` |

---

## Commands ที่มีประโยชน์

```bash
pm2 logs rms          # ดู log แบบ realtime
pm2 restart rms       # restart หลังแก้โค้ด
pm2 stop rms          # หยุด
git pull && pm2 restart rms   # update + restart
```

---

## โอนย้าย Database จาก Local

ถ้าต้องการเอาข้อมูลปัจจุบันขึ้น server:
```bash
# บน Windows (PowerShell):
scp C:\Users\User\Documents\RMS\data\rms.db user@cyn-jewelry.com:/var/www/RMS/data/rms.db
```

---

## Troubleshooting

**502 Bad Gateway** → RMS ยังไม่ start หรือ port ผิด  
→ `pm2 status` และ `pm2 logs rms`

**404 บน /RMS** → nginx config ยังไม่ได้ reload  
→ `sudo nginx -s reload`

**หน้า load แต่ API ไม่ทำงาน** → fetch interceptor ไม่ทำงาน  
→ เปิด DevTools > Network ดูว่า request ขึ้นต้นด้วย `/RMS/api/...` หรือเปล่า

**node:sqlite error** → Node.js เวอร์ชันต่ำกว่า 22  
→ `node --version` ต้องเป็น v22 ขึ้นไป
