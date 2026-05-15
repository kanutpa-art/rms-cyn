// ============================================================
// VALIDATORS — express-validator schemas + error handler
// ============================================================
// Usage:
//   router.post('/rooms', roomValidator, handleValidation, controller);
// ============================================================
const { body, validationResult } = require('express-validator');

// Generic error handler — collects all errors into a single { error, fields } response
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const fields = {};
  for (const e of errors.array()) {
    fields[e.path] = e.msg;
  }
  return res.status(400).json({
    error: 'กรุณาตรวจสอบข้อมูลที่กรอก',
    code: 'VALIDATION_ERROR',
    fields,
  });
}

// ============================================================
// ROOM validators (POST + PUT /api/admin/rooms)
// ============================================================
// Rules:
//   - room_number: alphanumeric Thai/English/digits, max 16 chars
//   - monthly_rent: 0–1,000,000 baht
//   - meter readings: 0–999,999
//   - notes: max 500 chars
// ============================================================
const roomValidator = [
  body('room_number')
    .isString().withMessage('เลขห้องต้องเป็นข้อความ')
    .trim()
    .notEmpty().withMessage('กรุณากรอกเลขห้อง')
    .isLength({ max: 16 }).withMessage('เลขห้องยาวเกินไป (สูงสุด 16)')
    // Thai (฀-๿) + ASCII alphanumeric + dash/space
    .matches(/^[A-Za-z0-9฀-๿\- ]+$/).withMessage('เลขห้องมีอักขระไม่ถูกต้อง'),

  body('building')
    .optional({ checkFalsy: true })
    .isString().isLength({ max: 20 }).withMessage('ชื่ออาคารยาวเกินไป')
    .matches(/^[A-Za-z0-9฀-๿\- ]+$/).withMessage('ชื่ออาคารมีอักขระไม่ถูกต้อง'),

  body('floor')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 100 }).withMessage('เลขชั้นต้องเป็นจำนวนเต็ม 1-100'),

  body('monthly_rent')
    .exists({ checkNull: true }).withMessage('กรุณากรอกค่าเช่า')
    .bail()
    .isFloat({ min: 0, max: 1_000_000 }).withMessage('ค่าเช่าต้อง 0-1,000,000 บาท'),

  body('initial_water_meter')
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 999_999 }).withMessage('มิเตอร์น้ำต้อง 0-999,999'),

  body('initial_electric_meter')
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 999_999 }).withMessage('มิเตอร์ไฟต้อง 0-999,999'),

  body('notes')
    .optional({ checkFalsy: true })
    .isString().isLength({ max: 500 }).withMessage('หมายเหตุยาวเกินไป (สูงสุด 500 ตัวอักษร)'),
];

// ============================================================
// TENANT validators (POST manual tenant)
// ============================================================
const tenantValidator = [
  body('tenant_name')
    .isString().trim().notEmpty().withMessage('กรุณากรอกชื่อผู้เช่า')
    .isLength({ max: 100 }).withMessage('ชื่อยาวเกินไป'),

  body('tenant_phone')
    .optional({ checkFalsy: true })
    .matches(/^[0-9+\- ]{6,20}$/).withMessage('เบอร์โทรไม่ถูกต้อง'),

  body('tenant_id_card')
    .optional({ checkFalsy: true })
    .matches(/^[0-9\- ]{0,20}$/).withMessage('เลขบัตรประชาชนไม่ถูกต้อง'),

  body('start_date')
    .optional({ checkFalsy: true })
    .isISO8601().withMessage('วันที่เริ่มสัญญาไม่ถูกต้อง'),

  body('duration_months')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 60 }).withMessage('ระยะสัญญาต้อง 1-60 เดือน'),
];

// ============================================================
// BILL validators
// ============================================================
const billValidator = [
  body('billing_month')
    .matches(/^\d{4}-\d{2}$/).withMessage('เดือนต้องเป็นรูปแบบ YYYY-MM'),
  body('due_date')
    .optional({ checkFalsy: true })
    .isISO8601().withMessage('วันครบกำหนดไม่ถูกต้อง'),
  body('rent_amount').optional({ checkFalsy: true }).isFloat({ min: 0, max: 1_000_000 }),
  body('water_amount').optional({ checkFalsy: true }).isFloat({ min: 0, max: 100_000 }),
  body('electric_amount').optional({ checkFalsy: true }).isFloat({ min: 0, max: 100_000 }),
];

// ============================================================
// LOGIN validator
// ============================================================
const loginValidator = [
  body('email')
    .isEmail().withMessage('Email ไม่ถูกต้อง')
    .normalizeEmail()
    .isLength({ max: 254 }),
  body('password')
    .isString().isLength({ min: 1, max: 128 }).withMessage('กรุณากรอกรหัสผ่าน'),
];

module.exports = {
  handleValidation,
  roomValidator,
  tenantValidator,
  billValidator,
  loginValidator,
};
