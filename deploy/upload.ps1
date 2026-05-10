# ============================================================
# upload.ps1 — อัพโหลด RMS ขึ้น server ด้วย SCP
# แก้ค่า $SERVER, $USER, $KEY_PATH ก่อนรัน
# ============================================================

$SERVER    = "cyn-jewelry.com"         # หรือ IP address
$USER      = "ubuntu"                  # ชื่อ user บน server (ubuntu / root / etc.)
$KEY_PATH  = "$HOME\.ssh\id_rsa"       # path ของ SSH private key
$REMOTE    = "/var/www/RMS"            # ที่ตั้งไฟล์บน server
$LOCAL     = $PSScriptRoot + "\.."    # root ของ project (deploy/../)

Write-Host "📦 อัพโหลด RMS ไปที่ ${USER}@${SERVER}:${REMOTE}" -ForegroundColor Cyan

# สร้าง folder บน server
ssh -i $KEY_PATH "${USER}@${SERVER}" "mkdir -p ${REMOTE}/data ${REMOTE}/uploads/slips ${REMOTE}/uploads/maintenance ${REMOTE}/uploads/move_out ${REMOTE}/uploads/renewal ${REMOTE}/data/sessions"

# อัพโหลดโค้ด (ไม่รวม node_modules, data, uploads, .env)
$excludes = @("node_modules", "data", "uploads", ".env", "deploy\upload.ps1")

# ใช้ rsync ถ้ามี (เร็วกว่า scp)
$rsync = Get-Command rsync -ErrorAction SilentlyContinue
if ($rsync) {
    $excludeArgs = $excludes | ForEach-Object { "--exclude=$_" }
    rsync -avz -e "ssh -i $KEY_PATH" $excludeArgs "${LOCAL}/" "${USER}@${SERVER}:${REMOTE}/"
} else {
    # fallback: scp ทั้ง folder (รวม node_modules ด้วย — ช้ากว่า)
    Write-Host "⚠️  ไม่พบ rsync — ใช้ scp แทน (ช้ากว่า)" -ForegroundColor Yellow
    scp -i $KEY_PATH -r "${LOCAL}\src"     "${USER}@${SERVER}:${REMOTE}/"
    scp -i $KEY_PATH -r "${LOCAL}\public"  "${USER}@${SERVER}:${REMOTE}/"
    scp -i $KEY_PATH    "${LOCAL}\server.js"   "${USER}@${SERVER}:${REMOTE}/"
    scp -i $KEY_PATH    "${LOCAL}\package.json" "${USER}@${SERVER}:${REMOTE}/"
    scp -i $KEY_PATH    "${LOCAL}\package-lock.json" "${USER}@${SERVER}:${REMOTE}/" 2>$null
}

Write-Host ""
Write-Host "✅ อัพโหลดเสร็จ" -ForegroundColor Green
Write-Host ""
Write-Host "ขั้นตอนต่อไปบน server:" -ForegroundColor Yellow
Write-Host "  ssh -i $KEY_PATH ${USER}@${SERVER}"
Write-Host "  cd ${REMOTE}"
Write-Host "  npm install --production"
Write-Host "  # สร้าง .env (ถ้ายังไม่มี):"
Write-Host "  echo 'PORT=3001' > .env"
Write-Host "  echo 'BASE_PATH=/RMS' >> .env"
Write-Host "  echo 'SESSION_SECRET=<random-string>' >> .env"
Write-Host "  pm2 restart rms || pm2 start server.js --name rms"
Write-Host "  pm2 save"
