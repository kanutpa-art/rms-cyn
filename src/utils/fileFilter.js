/**
 * File upload security helpers for multer.
 *
 * imageFileFilter — rejects non-image MIME types at intake
 * validateImageMagic — post-upload middleware: reads saved file magic bytes
 *                      and deletes + rejects if not a real image
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Allowed MIME types
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]);

/**
 * Multer fileFilter — first gate: MIME type whitelist + UUID rename via cb.
 * Use as: multer({ storage, limits, fileFilter: imageFileFilter })
 */
function imageFileFilter(req, file, cb) {
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return cb(Object.assign(new Error('Only image files (JPEG/PNG/GIF/WEBP) are allowed.'), { code: 'INVALID_FILE_TYPE' }), false);
  }
  cb(null, true);
}

/**
 * makeImageStorage — diskStorage with UUID filenames (prevents path traversal).
 * @param {string} folder  subfolder under /uploads
 */
function makeImageStorage(folder) {
  return require('multer').diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads', folder);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // UUID filename — no path traversal possible, no original name leakage
      const ext = file.mimetype === 'image/png' ? '.png'
        : file.mimetype === 'image/gif' ? '.gif'
        : file.mimetype === 'image/webp' ? '.webp'
        : '.jpg';
      cb(null, uuidv4() + ext);
    },
  });
}

/**
 * Magic byte signatures for allowed image types.
 */
function isValidImageMagic(buf) {
  if (buf.length < 4) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG:  89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // GIF:  47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WEBP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  return false;
}

/**
 * Post-upload Express middleware — validates magic bytes of every uploaded file.
 * Deletes the file and returns 400 if magic bytes don't match an allowed image type.
 * Place after multer: router.post('/upload', upload.single('file'), validateImageMagic, handler)
 */
function validateImageMagic(req, res, next) {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    if (Array.isArray(req.files)) files.push(...req.files);
    else Object.values(req.files).forEach(arr => files.push(...arr));
  }
  if (!files.length) return next();

  for (const f of files) {
    try {
      const fd = fs.openSync(f.path, 'r');
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      if (!isValidImageMagic(buf)) {
        // Delete the uploaded file
        try { fs.unlinkSync(f.path); } catch (_) {}
        return res.status(400).json({ error: 'Uploaded file is not a valid image.' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Could not validate uploaded file.' });
    }
  }
  next();
}

module.exports = { imageFileFilter, makeImageStorage, validateImageMagic };
