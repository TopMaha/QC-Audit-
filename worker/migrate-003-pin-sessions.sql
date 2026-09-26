-- ============================================================================
--  ปรับโครงฐานข้อมูลที่ขึ้นระบบไปแล้ว — PIN รายคน + เซสชันที่เซิร์ฟเวอร์ออกให้
--
--  รันครั้งเดียวต่อฐานข้อมูลหนึ่งชุด หลัง migrate-002 เสมอ:
--    cd worker
--    npm run db:migrate:003         (บนของจริง)
--    npm run db:migrate:003:local   (บนเครื่องตัวเอง)
--
--  ทุกคำสั่งเป็น IF NOT EXISTS รันซ้ำได้ไม่เสียหาย
--  schema.sql มีของชุดนี้อยู่แล้ว ไฟล์นี้จำเป็นเฉพาะฐานที่สร้างไว้ก่อนหน้า
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_pins (
  employee_id   TEXT PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
  pin_hash      TEXT NOT NULL,
  pin_salt      TEXT NOT NULL,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('employee', 'admin')),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_emp ON sessions (employee_id);
