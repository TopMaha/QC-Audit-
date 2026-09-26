-- ============================================================================
--  ปรับโครงฐานข้อมูลที่ขึ้นระบบไปแล้ว — เพิ่มบริบทการผลิตและบันทึกเสียง
--
--  รันครั้งเดียวต่อฐานข้อมูลหนึ่งชุด:
--    cd worker
--    npm run db:migrate         (บนของจริง)
--    npm run db:migrate:local   (บนเครื่องตัวเอง)
--
--  schema.sql มีคอลัมน์ชุดนี้อยู่แล้ว ไฟล์นี้จึงจำเป็นเฉพาะฐานที่สร้างไว้ก่อนหน้า
--  (CREATE TABLE IF NOT EXISTS ไม่เพิ่มคอลัมน์ให้ตารางที่มีอยู่แล้ว)
--
--  รันซ้ำจะได้ error "duplicate column name" ซึ่งแปลว่าฐานนี้ปรับไปแล้ว
--  ไม่ใช่ความเสียหาย — ข้ามไปได้เลย
-- ============================================================================

-- ── บริบทการผลิตของรอบตรวจ ───────────────────────────────────────────────
ALTER TABLE qc_rounds ADD COLUMN shift       TEXT CHECK (shift IS NULL OR shift IN ('A', 'B', 'C'));
ALTER TABLE qc_rounds ADD COLUMN machine_no  TEXT NOT NULL DEFAULT '';
ALTER TABLE qc_rounds ADD COLUMN model_no    TEXT NOT NULL DEFAULT '';
ALTER TABLE qc_rounds ADD COLUMN operator_id TEXT REFERENCES employees (id) ON DELETE SET NULL;

-- ── บริบทการผลิต + บันทึกเสียงของใบแจ้ง ──────────────────────────────────
ALTER TABLE qc_issues ADD COLUMN shift       TEXT CHECK (shift IS NULL OR shift IN ('A', 'B', 'C'));
ALTER TABLE qc_issues ADD COLUMN machine_no  TEXT NOT NULL DEFAULT '';
ALTER TABLE qc_issues ADD COLUMN model_no    TEXT NOT NULL DEFAULT '';
ALTER TABLE qc_issues ADD COLUMN operator_id TEXT REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE qc_issues ADD COLUMN voice_key   TEXT;
