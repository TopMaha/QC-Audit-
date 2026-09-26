-- ============================================================================
--  QC Audit Line — โครงฐานข้อมูล Cloudflare D1 (SQLite)
--  รันด้วย: wrangler d1 execute qc-audit-line --file=./schema.sql --remote
--
--  หลักการออกแบบ
--  1. ตารางและชื่อคอลัมน์สะท้อน src/lib/types.ts ของ frontend แบบ 1:1
--     เพื่อให้ Worker แปลงเป็น JSON ส่งกลับได้โดยหน้าจอไม่ต้องแก้อะไรเลย
--  2. ฟิลด์ที่เป็นอาร์เรย์ใน TypeScript (category_ids / photo_urls)
--     แตกเป็นตารางลูกแทนการเก็บ JSON เพราะระบบมีการค้นแบบย้อนกลับจริง เช่น
--     "ประเภทข้อบกพร่องนี้พบที่สายไหนบ้าง" ในหน้าแดชบอร์ด
--     ถ้าเก็บเป็น JSON จะต้องสแกนทุกแถว ทำ index ไม่ได้
--  3. วันที่ทั้งหมดเก็บเป็น TEXT · boolean เก็บเป็น INTEGER 0/1 พร้อม CHECK
--  4. ตารางที่เป็นหลักฐาน (ใบแจ้ง/งานแก้ไข) ใช้ RESTRICT ไม่ให้ถูกลบตามใคร
--     ส่วนตารางลูกที่ไม่มีความหมายเมื่อแม่หาย ใช้ CASCADE
--  5. สายการผลิตจำกัดไว้ที่ VSM1–VSM4 ด้วย CHECK constraint ทุกที่ที่ปรากฏ
--     ค่าชุดนี้ต้องตรงกับ VSM_LINES ใน src/lib/types.ts
--
--  หมายเหตุ: D1 บังคับ FOREIGN KEY ให้อยู่แล้ว ไม่ต้องสั่ง PRAGMA เอง
-- ============================================================================


-- ── ผู้ใช้ ────────────────────────────────────────────────────────────────
-- ทะเบียนพนักงานทั้งโรงงาน ไม่ใช่ทุกคนที่ล็อกอินได้ (ดู can_login)
--
-- ธงและฟิลด์เหล่านี้ตอบคนละคำถาม อย่ายุบรวมกัน
--   is_active         ยังเป็นพนักงานอยู่ไหม (ลาออกแล้วปิด)
--   can_login         ได้รับสิทธิ์ใช้แอปนี้หรือไม่ — ผู้ดูแลระบบกำหนดรายคน
--   dashboard_enabled เห็นภาพรวมทั้งโรงงานได้หรือเห็นแค่ของตัวเอง
--   role              qc = ผู้ตรวจ · vsm = ผู้แก้ไข · viewer = ดูอย่างเดียว
--   vsm_line          สายที่รับผิดชอบ จำเป็นเมื่อ role = 'vsm'
--
-- can_login ตั้งต้นเป็น 0 โดยตั้งใจ: คนใหม่ที่เพิ่มเข้ามาต้องถูกเปิดสิทธิ์
-- ก่อนเสมอ เพราะรหัสเข้าระบบคือรหัสพนักงานซึ่งคนอื่นเดาได้ไม่ยาก
CREATE TABLE IF NOT EXISTS employees (
  id                TEXT PRIMARY KEY,
  emp_code          TEXT NOT NULL UNIQUE,
  full_name         TEXT NOT NULL,
  full_name_en      TEXT,
  department        TEXT NOT NULL DEFAULT '',
  position          TEXT,
  avatar_url        TEXT,
  role              TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('qc', 'vsm', 'viewer')),
  vsm_line          TEXT CHECK (vsm_line IS NULL OR vsm_line IN ('VSM1', 'VSM2', 'VSM3', 'VSM4')),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  dashboard_enabled INTEGER NOT NULL DEFAULT 1 CHECK (dashboard_enabled IN (0, 1)),
  can_login         INTEGER NOT NULL DEFAULT 0 CHECK (can_login IN (0, 1)),
  created_at        TEXT NOT NULL
);

-- กล่องงานเข้าของ VSM กรองด้วยสาย + บทบาท
CREATE INDEX IF NOT EXISTS idx_employees_line ON employees (vsm_line) WHERE vsm_line IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees (role);

-- ── PIN รายคน + เซสชัน ──────────────────────────────────────────────────
-- รหัสพนักงานเดาได้และถูกพูดถึงกันทั่วโรงงาน จึงใช้เป็น "ชื่อผู้ใช้" เท่านั้น
-- การยืนยันตัวตนจริงคือ PIN 6 หลักที่แต่ละคนตั้งเองตอนเข้าครั้งแรก
--
-- แยกตารางจาก employees โดยตั้งใจ เพราะ GET /api/employees ส่งทะเบียนให้ทุกเครื่อง
-- ถ้าเก็บรวมกันแล้ววันหนึ่งมีคนเผลอ SELECT * ส่งออกไป ค่าแฮชของ PIN จะหลุดทั้งโรงงาน
--
-- pin_hash = HMAC-SHA256(PIN_PEPPER, employee_id:salt:pin) — PIN_PEPPER เป็น secret ของ Worker
-- PIN มีแค่ล้านแบบ แฮชช้าแค่ไหนก็ไล่เดาได้ถ้าได้ฐานข้อมูลไป จึงพึ่ง pepper ที่อยู่นอกฐานข้อมูล
-- และล็อกบัญชีเมื่อกรอกผิดติดกันแทน (failed_count / locked_until)
CREATE TABLE IF NOT EXISTS employee_pins (
  employee_id   TEXT PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
  pin_hash      TEXT NOT NULL,
  pin_salt      TEXT NOT NULL,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  updated_at    TEXT NOT NULL
);

-- เซสชันที่ Worker ออกให้หลังเข้าระบบสำเร็จ — ทุกคำขอต้องแนบโทเคนนี้มา
-- เก็บแค่แฮชของโทเคน ฐานข้อมูลหลุดก็เอาไปสวมรอยไม่ได้
--   kind = employee  ทำงานในนามพนักงานคนนั้น (สิทธิ์ตามบทบาท)
--   kind = admin     เข้าผ่าน /admin — ทำแทนได้ทุกอย่าง แต่ต้องเป็นคนในตาราง superusers
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('employee', 'admin')),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_emp ON sessions (employee_id);

-- ผู้ดูแลระบบ แยกจาก employees เพราะเข้าคนละทาง (/admin) และไม่ได้ตรวจหรือแก้งาน
CREATE TABLE IF NOT EXISTS superusers (
  id          TEXT PRIMARY KEY,
  admin_code  TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL
);


-- ── จุดตรวจ (โครงสร้างต้นไม้) ─────────────────────────────────────────────
-- parent_id ชี้ไปยังพื้นที่แม่ · ระดับบนสุดมีค่าเป็น NULL
-- CASCADE เพราะถ้าลบ "สายการผลิต VSM2" ทิ้ง สถานีข้างใต้ก็ไม่มีความหมายแล้ว
--
-- vsm_line คือหัวใจของการส่งงาน: เลือกจุดตรวจแล้วระบบเติมสายผู้รับผิดชอบให้เอง
-- พื้นที่นอกสาย (คลัง/จุดรับเข้า) เป็น NULL ได้ — QC ต้องเลือกสายเอง
CREATE TABLE IF NOT EXISTS areas (
  id            TEXT PRIMARY KEY,
  area_name     TEXT NOT NULL,
  area_name_en  TEXT,
  parent_id     TEXT REFERENCES areas (id) ON DELETE CASCADE,
  vsm_line      TEXT CHECK (vsm_line IS NULL OR vsm_line IN ('VSM1', 'VSM2', 'VSM3', 'VSM4')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_areas_parent ON areas (parent_id);
CREATE INDEX IF NOT EXISTS idx_areas_active ON areas (is_active);


-- ── ประเภทข้อบกพร่อง ─────────────────────────────────────────────────────
-- เป็นแท็กติดบนใบแจ้ง ไม่ใช่ชุดคำถาม (ระบบนี้ไม่มีเช็คลิสต์รายข้อ)
CREATE TABLE IF NOT EXISTS defect_categories (
  id                 TEXT PRIMARY KEY,
  category_name      TEXT NOT NULL,
  category_name_en   TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);


-- ── รอบตรวจ ──────────────────────────────────────────────────────────────
-- QC เดินตรวจหนึ่งรอบ = หนึ่งแถว บันทึกทั้งรอบที่ผ่านและรอบที่พบข้อบกพร่อง
-- ต้องเก็บรอบที่ผ่านด้วย ไม่งั้นจะคำนวณอัตราการพบข้อบกพร่องไม่ได้เลย
-- (ถ้าเก็บแต่รอบที่เจอ ตัวเลขจะเป็น 100% ตลอดกาล)
--
-- qc_id ใช้ RESTRICT เพราะรอบตรวจเป็นหลักฐาน ต้องรู้เสมอว่าใครเป็นคนตรวจ
-- บริบทการผลิต (shift/machine_no/model_no/operator_id) เก็บซ้ำทั้งที่นี่และใน qc_issues
-- โดยตั้งใจ เหมือน area_id/vsm_line/qty_checked ที่ทำอยู่แล้ว เพราะใบแจ้งนอกรอบ
-- ไม่มีรอบตรวจให้สืบทอดค่า และรอบที่ผ่าน (ไม่มีใบแจ้ง) ก็ต้องรู้บริบทเช่นกัน
-- ไม่งั้นจะคิดอัตราการพบข้อบกพร่องรายกะ/รายเครื่องไม่ได้เลย
--
-- operator_id ใช้ SET NULL ไม่ใช่ RESTRICT เพราะผู้ปฏิบัติงานเป็นข้อมูลประกอบ
-- ไม่ใช่ผู้รับผิดชอบตามกติกา (ต่างจาก qc_id ซึ่งเป็นหลักฐานว่าใครตรวจ)
CREATE TABLE IF NOT EXISTS qc_rounds (
  id           TEXT PRIMARY KEY,
  round_no     TEXT NOT NULL,
  qc_id        TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  round_date   TEXT NOT NULL,
  round_time   TEXT NOT NULL,
  area_id      TEXT NOT NULL REFERENCES areas (id) ON DELETE RESTRICT,
  vsm_line     TEXT NOT NULL CHECK (vsm_line IN ('VSM1', 'VSM2', 'VSM3', 'VSM4')),
  qty_checked  INTEGER NOT NULL DEFAULT 0,
  result       TEXT NOT NULL CHECK (result IN ('pass', 'ng')),
  note         TEXT NOT NULL DEFAULT '',
  shift        TEXT CHECK (shift IS NULL OR shift IN ('A', 'B', 'C')),
  machine_no   TEXT NOT NULL DEFAULT '',
  model_no     TEXT NOT NULL DEFAULT '',
  operator_id  TEXT REFERENCES employees (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rounds_date      ON qc_rounds (round_date);
CREATE INDEX IF NOT EXISTS idx_rounds_qc_date   ON qc_rounds (qc_id, round_date);
CREATE INDEX IF NOT EXISTS idx_rounds_line_date ON qc_rounds (vsm_line, round_date);
CREATE INDEX IF NOT EXISTS idx_rounds_area      ON qc_rounds (area_id);


-- ── ใบแจ้งข้อบกพร่อง (หลักฐาน) ───────────────────────────────────────────
-- round_id เป็น NULL ได้ = แจ้งนอกรอบ (มีคนมาบอกว่าเจอของเสีย)
-- ใช้ SET NULL ไม่ใช่ CASCADE เพราะถ้าลบรอบตรวจทิ้ง ใบแจ้งต้องไม่หายตาม
--
-- acked_at / closed_at เก็บไว้วัดเวลาตอบสนองและเวลาปิดงาน
-- ไม่คำนวณจาก issue_fixes ตอนอ่าน เพราะรายงานย้อนหลังต้องได้ค่าเดิมเสมอ
-- แม้ภายหลังจะมีการแก้ไขรอบใหม่ต่อท้าย
CREATE TABLE IF NOT EXISTS qc_issues (
  id            TEXT PRIMARY KEY,
  issue_no      TEXT NOT NULL,
  round_id      TEXT REFERENCES qc_rounds (id) ON DELETE SET NULL,
  qc_id         TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  found_date    TEXT NOT NULL,
  found_time    TEXT NOT NULL,
  area_id       TEXT NOT NULL REFERENCES areas (id) ON DELETE RESTRICT,
  vsm_line      TEXT NOT NULL CHECK (vsm_line IN ('VSM1', 'VSM2', 'VSM3', 'VSM4')),
  severity      TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor')),
  part_no       TEXT NOT NULL DEFAULT '',
  lot_no        TEXT NOT NULL DEFAULT '',
  qty_checked   INTEGER NOT NULL DEFAULT 0,
  qty_defect    INTEGER NOT NULL DEFAULT 0,
  description   TEXT NOT NULL DEFAULT '',
  due_date      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'fixed', 'rejected', 'verified', 'cancelled')),
  shift         TEXT CHECK (shift IS NULL OR shift IN ('A', 'B', 'C')),
  machine_no    TEXT NOT NULL DEFAULT '',
  model_no      TEXT NOT NULL DEFAULT '',
  operator_id   TEXT REFERENCES employees (id) ON DELETE SET NULL,
  -- บันทึกเสียงบรรยายข้อบกพร่อง (ไม่บังคับ) — คีย์ของอ็อบเจกต์ใน R2 เหมือนรูป
  -- เก็บเป็นคอลัมน์เดียวไม่ใช่ตารางลูก เพราะหนึ่งใบมีได้เสียงเดียว
  -- ต่างจากรูปที่ต้องถ่ายหลายมุม
  voice_key     TEXT,
  -- ขั้นตอนที่ผู้ใช้เห็น 5 ขั้น: QC พบปัญหา › VSM รับทราบ › กำลังแก้ไข › แก้ไขเสร็จแล้ว › QC ตรวจรับ
  -- "รับทราบ" กับ "กำลังแก้ไข" ใช้สถานะ in_progress เดียวกัน แยกด้วย started_at
  -- (เพิ่มค่าใหม่ใน CHECK ของ status ต้องสร้างตารางใหม่ทั้งตาราง ซึ่งเสี่ยงกับข้อมูลลูกที่ CASCADE)
  acked_at      TEXT,
  started_at    TEXT,
  closed_at     TEXT,
  created_at    TEXT NOT NULL
);

-- แดชบอร์ด/รายงานกรองตามช่วงวันที่เป็นหลัก
CREATE INDEX IF NOT EXISTS idx_issues_found       ON qc_issues (found_date);
-- กล่องงานเข้าของ VSM: สายของฉัน + สถานะที่ยังต้องทำ
CREATE INDEX IF NOT EXISTS idx_issues_line_status ON qc_issues (vsm_line, status);
-- QC ตามงานที่ตัวเองแจ้ง
CREATE INDEX IF NOT EXISTS idx_issues_qc_found    ON qc_issues (qc_id, found_date);
CREATE INDEX IF NOT EXISTS idx_issues_area        ON qc_issues (area_id);
CREATE INDEX IF NOT EXISTS idx_issues_round       ON qc_issues (round_id);
-- หน้ารายการเรียงตามความเร่งด่วน โดยเริ่มจากของที่เลยกำหนด
-- partial index เก็บเฉพาะใบที่ยังไม่ปิด ซึ่งเป็นส่วนน้อยของทั้งตาราง
CREATE INDEX IF NOT EXISTS idx_issues_due_active  ON qc_issues (due_date)
  WHERE status IN ('open', 'in_progress', 'fixed', 'rejected');


-- ประเภทข้อบกพร่องของใบแจ้ง (สูงสุด 3 — จำกัดที่ชั้น Worker)
-- sort_order เก็บลำดับเดิม เพื่อให้ category_ids[0] ที่หน้าจอใช้ยังคงลำดับเดียวกัน
CREATE TABLE IF NOT EXISTS issue_categories (
  issue_id     TEXT NOT NULL REFERENCES qc_issues (id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES defect_categories (id) ON DELETE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, category_id)
);

-- ใช้บ่อยมาก: แดชบอร์ดถามว่า "ประเภทนี้พบกี่ใบในช่วงนี้"
CREATE INDEX IF NOT EXISTS idx_issue_categories_cat ON issue_categories (category_id);


-- รูปหลักฐานฝั่ง QC — photo_key คือคีย์ของอ็อบเจกต์ใน R2 (binding PHOTOS)
CREATE TABLE IF NOT EXISTS issue_photos (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES qc_issues (id) ON DELETE CASCADE,
  photo_key   TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_issue_photos_issue ON issue_photos (issue_id, sort_order);


-- ── งานแก้ไขจากฝั่ง VSM ──────────────────────────────────────────────────
-- หนึ่งใบแจ้งมีได้หลายครั้ง (ถูกตีกลับแล้วแก้ใหม่) จึงเก็บเป็นตารางแยก
-- ไม่ใช่คอลัมน์บนใบแจ้ง — ต้องเห็นประวัติทุกครั้งที่แก้ ไม่ใช่เห็นแค่ครั้งล่าสุด
--
-- (issue_id, attempt) เป็น UNIQUE เพื่อกันการส่งซ้ำจากคิวออฟไลน์
-- ที่อาจสร้างครั้งที่ 2 ซ้อนกันสองแถวเมื่อเน็ตกะพริบระหว่างส่ง
CREATE TABLE IF NOT EXISTS issue_fixes (
  id             TEXT PRIMARY KEY,
  issue_id       TEXT NOT NULL REFERENCES qc_issues (id) ON DELETE CASCADE,
  responder_id   TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  attempt        INTEGER NOT NULL,
  root_cause     TEXT NOT NULL DEFAULT '',
  action_taken   TEXT NOT NULL DEFAULT '',
  fixed_at       TEXT NOT NULL,
  verify_result  TEXT NOT NULL DEFAULT 'pending' CHECK (verify_result IN ('pending', 'pass', 'fail')),
  verify_note    TEXT NOT NULL DEFAULT '',
  verified_by    TEXT REFERENCES employees (id) ON DELETE SET NULL,
  verified_at    TEXT,
  UNIQUE (issue_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_fixes_issue  ON issue_fixes (issue_id, attempt);
-- หา "งานที่รอตรวจรับ" ของ QC — partial index เก็บเฉพาะที่ยังค้าง
CREATE INDEX IF NOT EXISTS idx_fixes_pending ON issue_fixes (issue_id) WHERE verify_result = 'pending';


-- รูปยืนยันหลังแก้ไข — บังคับอย่างน้อย 1 รูปที่ชั้น Worker
-- นี่คือหลักฐานที่ QC ใช้ตรวจรับ ถ้าไม่มีรูปก็ไม่มีอะไรให้ตรวจ
CREATE TABLE IF NOT EXISTS fix_photos (
  id          TEXT PRIMARY KEY,
  fix_id      TEXT NOT NULL REFERENCES issue_fixes (id) ON DELETE CASCADE,
  photo_key   TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fix_photos_fix ON fix_photos (fix_id, sort_order);


-- ── หัวหน้าสาย VSM ──────────────────────────────────────────────────────
-- คนที่ใบแจ้งของสายนั้น "เด้ง" ไปหาเมื่อ QC เปิดใบใหม่ และมีสิทธิ์รับทราบ/แก้ไข
-- ใบของสายนั้นแม้บทบาทหรือแผนกของตัวเองจะไม่ใช่ VSM สายเดียวกัน (เช่น ผู้จัดการฝ่ายผลิต)
-- สายหนึ่งมีได้หลายคน (หัวหน้ากะเช้า/กะดึก) ผู้ดูแลระบบกำหนดจากหน้าตั้งค่า
CREATE TABLE IF NOT EXISTS line_heads (
  vsm_line     TEXT NOT NULL CHECK (vsm_line IN ('VSM1', 'VSM2', 'VSM3', 'VSM4')),
  employee_id  TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (vsm_line, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_line_heads_emp ON line_heads (employee_id);


-- ── การแจ้งเตือนแบบเด้ง (Web Push) ──────────────────────────────────────
-- หนึ่งแถวต่อหนึ่งเครื่องที่กดเปิดการแจ้งเตือน — คนเดียวมีได้หลายเครื่อง
-- endpoint คือที่อยู่ของบริการ push ของเบราว์เซอร์ (FCM/Mozilla/Apple) ซึ่งไม่ซ้ำกันอยู่แล้ว
-- ถูกลบทิ้งเองเมื่อบริการ push ตอบว่าหมดอายุ (404/410)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_emp ON push_subscriptions (employee_id);


-- ── ร่องรอยการแก้ไข ──────────────────────────────────────────────────────
-- record_id ชี้ข้ามตารางได้ (polymorphic) จึงตั้ง FOREIGN KEY ไม่ได้โดยธรรมชาติ
-- และไม่ควรตั้งด้วย เพราะประวัติต้องอยู่ต่อแม้แถวต้นทางถูกลบไปแล้ว
CREATE TABLE IF NOT EXISTS change_history (
  id           TEXT PRIMARY KEY,
  table_name   TEXT NOT NULL,
  record_id    TEXT NOT NULL,
  action_type  TEXT NOT NULL CHECK (action_type IN ('create', 'update', 'delete')),
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  changed_by   TEXT NOT NULL,
  changed_at   TEXT NOT NULL
);

-- หน้ารายละเอียดใบแจ้งเปิดดูประวัติของใบเดียว
CREATE INDEX IF NOT EXISTS idx_changes_record ON change_history (record_id);
-- หน้าตั้งค่าแสดงประวัติล่าสุดเรียงตามเวลา
CREATE INDEX IF NOT EXISTS idx_changes_at     ON change_history (changed_at DESC);


-- ── ประวัติการเข้าสู่ระบบ ────────────────────────────────────────────────
-- actor_id เก็บ '-' ได้เมื่อล็อกอินไม่สำเร็จ (ไม่รู้ว่าเป็นใคร) จึงไม่ตั้ง FK
CREATE TABLE IF NOT EXISTS login_history (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('employee', 'admin')),
  at          TEXT NOT NULL,
  result      TEXT NOT NULL CHECK (result IN ('success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_login_at ON login_history (at DESC);


-- ── ตั้งค่าระบบ ──────────────────────────────────────────────────────────
-- ตารางแถวเดียว บังคับด้วย CHECK (id = 1) กันไม่ให้เผลอมีหลายชุด
CREATE TABLE IF NOT EXISTS app_settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  due_days_critical  INTEGER NOT NULL DEFAULT 1,
  due_days_major     INTEGER NOT NULL DEFAULT 3,
  due_days_minor     INTEGER NOT NULL DEFAULT 7,
  target_ontime_pct  INTEGER NOT NULL DEFAULT 90,
  company_name       TEXT NOT NULL DEFAULT '',
  plant_name         TEXT NOT NULL DEFAULT ''
);
