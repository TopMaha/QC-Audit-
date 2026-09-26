/**
 * แปลงแถวจาก D1 ให้เป็นรูปร่างเดียวกับ src/lib/types.ts ของ frontend
 *
 * ที่ต้องแปลงมี 2 เรื่อง
 *   1. boolean — SQLite เก็บเป็น 0/1 แต่ frontend คาดหวัง true/false
 *   2. อาร์เรย์ — เก็บแยกในตารางลูก ต้องประกอบกลับเป็นอาร์เรย์
 *
 * ⚠️ กติกาสำคัญ: group_concat ต้องมี ORDER BY sort_order เสมอ
 * ไม่งั้นลำดับประเภทข้อบกพร่องจะสลับ แล้วรูปแรกที่หน้าจอโชว์เป็นภาพปกจะเพี้ยน
 */

/**
 * ตัวคั่นที่ใช้ใน group_concat — ใช้ 0x01 แทนจุลภาค
 * เพราะข้อความที่ผู้ใช้กรอกมีจุลภาคปนได้ ถ้าใช้ ',' จะแยกผิด
 */
const SEP = '\u0001';

/** แยกผลของ group_concat กลับเป็นอาร์เรย์ (คืนอาร์เรย์ว่างเมื่อไม่มีสมาชิก) */
function splitList(v) {
  if (v === null || v === undefined || v === '') return [];
  return String(v).split(SEP).filter((s) => s !== '');
}

export const toBool = (v) => v === 1 || v === true;

export function mapEmployee(r) {
  return {
    id: r.id,
    emp_code: r.emp_code,
    full_name: r.full_name,
    full_name_en: r.full_name_en ?? undefined,
    department: r.department,
    position: r.position ?? undefined,
    avatar_url: r.avatar_url ?? null,
    role: r.role,
    vsm_line: r.vsm_line ?? null,
    is_active: toBool(r.is_active),
    dashboard_enabled: toBool(r.dashboard_enabled),
    can_login: toBool(r.can_login),
    // ตั้ง PIN แล้วหรือยัง — มีเฉพาะในรายการทะเบียน (ค่าแฮชของ PIN ไม่เคยออกจาก Worker)
    ...(r.has_pin === undefined ? {} : { has_pin: toBool(r.has_pin) }),
    created_at: r.created_at,
  };
}

export function mapArea(r) {
  return {
    id: r.id,
    area_name: r.area_name,
    area_name_en: r.area_name_en ?? undefined,
    parent_id: r.parent_id ?? null,
    vsm_line: r.vsm_line ?? null,
    is_active: toBool(r.is_active),
  };
}

export function mapCategory(r) {
  return {
    id: r.id,
    category_name: r.category_name,
    category_name_en: r.category_name_en ?? undefined,
    is_active: toBool(r.is_active),
  };
}

/** บริบทการผลิตที่ติดมากับทั้งรอบตรวจและใบแจ้ง — ดู ProductionContext ใน types.ts */
function mapContext(r) {
  return {
    shift: r.shift ?? null,
    machine_no: r.machine_no ?? '',
    model_no: r.model_no ?? '',
    operator_id: r.operator_id ?? null,
  };
}

export function mapRound(r) {
  return {
    id: r.id,
    round_no: r.round_no,
    qc_id: r.qc_id,
    round_date: r.round_date,
    round_time: r.round_time,
    area_id: r.area_id,
    vsm_line: r.vsm_line,
    qty_checked: r.qty_checked,
    result: r.result,
    note: r.note ?? '',
    ...mapContext(r),
    created_at: r.created_at,
  };
}

export function mapIssue(r) {
  return {
    id: r.id,
    issue_no: r.issue_no,
    round_id: r.round_id ?? null,
    qc_id: r.qc_id,
    found_date: r.found_date,
    found_time: r.found_time,
    area_id: r.area_id,
    vsm_line: r.vsm_line,
    category_ids: splitList(r.category_ids),
    severity: r.severity,
    part_no: r.part_no ?? '',
    lot_no: r.lot_no ?? '',
    qty_checked: r.qty_checked,
    qty_defect: r.qty_defect,
    description: r.description ?? '',
    photo_urls: splitList(r.photo_urls),
    voice_url: r.voice_key ?? null,
    ...mapContext(r),
    due_date: r.due_date,
    status: r.status,
    acked_at: r.acked_at ?? null,
    started_at: r.started_at ?? null,
    closed_at: r.closed_at ?? null,
    created_at: r.created_at,
  };
}

export function mapFix(r) {
  return {
    id: r.id,
    issue_id: r.issue_id,
    responder_id: r.responder_id,
    attempt: r.attempt,
    root_cause: r.root_cause ?? '',
    action_taken: r.action_taken ?? '',
    photo_urls: splitList(r.photo_urls),
    fixed_at: r.fixed_at,
    verify_result: r.verify_result,
    verify_note: r.verify_note ?? '',
    verified_by: r.verified_by ?? null,
    verified_at: r.verified_at ?? null,
  };
}

export function mapChange(r) {
  return {
    id: r.id,
    table_name: r.table_name,
    record_id: r.record_id,
    action_type: r.action_type,
    field: r.field ?? undefined,
    old_value: r.old_value ?? null,
    new_value: r.new_value ?? null,
    changed_by: r.changed_by,
    changed_at: r.changed_at,
  };
}

export function mapLogin(r) {
  return {
    id: r.id,
    actor_id: r.actor_id,
    actor_name: r.actor_name,
    role: r.role,
    at: r.at,
    result: r.result,
  };
}

export function mapSettings(r) {
  return {
    due_days_critical: r.due_days_critical,
    due_days_major: r.due_days_major,
    due_days_minor: r.due_days_minor,
    target_ontime_pct: r.target_ontime_pct,
    company_name: r.company_name,
    plant_name: r.plant_name,
  };
}

/* ── ชิ้นส่วน SQL ที่ใช้ซ้ำ ────────────────────────────────────────────── */

/** ใบแจ้ง + ประเภทข้อบกพร่อง + รูป ที่ประกอบกลับแล้ว (เรียงตาม sort_order) */
export const ISSUE_SELECT = `
  SELECT i.*,
         (SELECT group_concat(ic.category_id, char(1) ORDER BY ic.sort_order)
            FROM issue_categories ic WHERE ic.issue_id = i.id) AS category_ids,
         (SELECT group_concat(ip.photo_key, char(1) ORDER BY ip.sort_order)
            FROM issue_photos ip WHERE ip.issue_id = i.id) AS photo_urls
    FROM qc_issues i`;

/** งานแก้ไข + รูปยืนยัน */
export const FIX_SELECT = `
  SELECT f.*,
         (SELECT group_concat(fp.photo_key, char(1) ORDER BY fp.sort_order)
            FROM fix_photos fp WHERE fp.fix_id = f.id) AS photo_urls
    FROM issue_fixes f`;
