-- ============================================================================
--  ปรับโครงฐานข้อมูลที่ขึ้นระบบไปแล้ว — ขั้นตอน 5 ขั้น · หัวหน้าสาย VSM · แจ้งเตือนแบบเด้ง
--
--  รันครั้งเดียวต่อฐานข้อมูลหนึ่งชุด หลัง migrate-001 เสมอ:
--    cd worker
--    npm run db:migrate:002         (บนของจริง)
--    npm run db:migrate:002:local   (บนเครื่องตัวเอง)
--
--  schema.sql มีของชุดนี้อยู่แล้ว ไฟล์นี้จำเป็นเฉพาะฐานที่สร้างไว้ก่อนหน้า
--  รันซ้ำจะได้ error "duplicate column name: started_at" ซึ่งแปลว่าปรับไปแล้ว
-- ============================================================================

-- "VSM รับทราบ" กับ "กำลังแก้ไข" ใช้สถานะ in_progress เดียวกัน แยกด้วยคอลัมน์นี้
ALTER TABLE qc_issues ADD COLUMN started_at TEXT;

CREATE TABLE IF NOT EXISTS line_heads (
  vsm_line     TEXT NOT NULL CHECK (vsm_line IN ('VSM1', 'VSM2', 'VSM3', 'VSM4')),
  employee_id  TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (vsm_line, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_line_heads_emp ON line_heads (employee_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_emp ON push_subscriptions (employee_id);
