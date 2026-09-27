import type { ISODate } from './time';

/* ══════════════════════════════════════════════════════════════════════════
   สายการผลิตที่ต้องรับผิดชอบแก้ไข — มีแค่ VSM1–VSM4 เท่านั้นตามที่ตกลงไว้
   ค่าคงที่ชุดนี้ถูกใช้ทั้งฝั่งหน้าจอและฝั่ง Worker (CHECK constraint ใน schema.sql)
   ถ้าจะเพิ่มสาย ต้องแก้ทั้งสองที่พร้อมกัน
   ══════════════════════════════════════════════════════════════════════════ */
export const VSM_LINES = ['VSM1', 'VSM2', 'VSM3', 'VSM4'] as const;
export type VsmLine = (typeof VSM_LINES)[number];

export function isVsmLine(v: unknown): v is VsmLine {
  return typeof v === 'string' && (VSM_LINES as readonly string[]).includes(v);
}

/**
 * บทบาทในระบบ — กำหนดว่าเห็นและทำอะไรได้
 *   qc     ผู้ตรวจ: เดินตรวจ บันทึกปัญหา และตรวจรับงานแก้ไข
 *   vsm    ผู้แก้ไข: เห็นเฉพาะปัญหาของสายตัวเอง แก้แล้วถ่ายรูปส่งกลับ
 *   viewer ดูอย่างเดียว: ผู้บริหาร/แผนกอื่นที่ต้องติดตามผล แต่ไม่ได้ลงมือ
 */
export type Role = 'qc' | 'vsm' | 'viewer';

/**
 * ทะเบียนพนักงาน — ไม่ใช่ทุกคนที่ล็อกอินได้ (ดู can_login)
 * คนที่ล็อกอินไม่ได้ยังต้องอยู่ในทะเบียน เพราะถูกอ้างถึงเป็นผู้เกี่ยวข้องได้
 */
export interface Employee {
  id: string;
  emp_code: string;
  full_name: string;
  full_name_en?: string;
  department: string;
  position?: string;
  avatar_url?: string | null;
  role: Role;
  /** สายที่รับผิดชอบ — จำเป็นเมื่อ role = 'vsm' เพราะใช้กรองงานเข้าให้ถูกคน */
  vsm_line: VsmLine | null;
  /** ยังเป็นพนักงานอยู่ไหม — ลาออกแล้วปิด */
  is_active: boolean;
  /** เห็นภาพรวมทั้งโรงงาน หรือเห็นแค่ของตัวเอง/สายตัวเอง */
  dashboard_enabled: boolean;
  /** ได้รับสิทธิ์เข้าใช้แอปหรือไม่ — ผู้ดูแลระบบกำหนดเป็นรายคน */
  can_login: boolean;
  created_at: string;
}

export interface Superuser {
  id: string;
  admin_code: string;
  full_name: string;
}

/** จุดตรวจ/สถานีในไลน์ผลิต — เป็นโครงสร้างต้นไม้ (สาย › ไลน์ย่อย › สถานี) */
export interface Area {
  id: string;
  area_name: string;
  area_name_en?: string;
  parent_id: string | null;
  /** สายที่พื้นที่นี้สังกัด — ใช้เติม VSM ผู้รับผิดชอบให้อัตโนมัติตอนบันทึกปัญหา */
  vsm_line: VsmLine | null;
  is_active: boolean;
}

/** ประเภทข้อบกพร่อง เช่น มิติไม่ได้ · รอยเชื่อม · ปนเปื้อน */
export interface DefectCategory {
  id: string;
  category_name: string;
  category_name_en?: string;
  is_active: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
   รอบตรวจ (QC เดินตรวจไลน์)
   ══════════════════════════════════════════════════════════════════════════ */

/** ผลของรอบตรวจ — ผ่าน (ไม่พบปัญหา) หรือพบข้อบกพร่อง */
export type RoundResult = 'pass' | 'ng';

/**
 * กะการทำงาน — โรงงานเดินสามกะ ค่าชุดนี้ต้องตรงกับ CHECK ใน schema.sql
 * ใช้แยกตัวเลขว่ากะไหนพบของเสียมากกว่ากัน ซึ่งดูจากเวลาที่บันทึกอย่างเดียวไม่ได้
 * เพราะรอบตรวจข้ามเที่ยงคืนและมีการบันทึกย้อนหลัง
 */
export const SHIFTS = ['A', 'B', 'C'] as const;
export type Shift = (typeof SHIFTS)[number];

/**
 * บริบทการผลิตที่ผูกกับรอบตรวจและใบแจ้ง — ไม่บังคับกรอกทั้งหมด
 *
 * เก็บซ้ำทั้งสองตารางโดยตั้งใจ (เหมือน area_id/vsm_line/qty_checked ที่ทำอยู่แล้ว)
 * เพราะใบแจ้งนอกรอบไม่มีรอบตรวจให้สืบทอดค่า และรอบที่ผ่านก็ต้องรู้บริบทเช่นกัน
 * ไม่งั้นจะเทียบอัตราการพบข้อบกพร่องรายกะ/รายเครื่องไม่ได้เลย
 */
export interface ProductionContext {
  /** กะที่เดินงานอยู่ — เติมให้อัตโนมัติจากเวลา แก้เองได้ */
  shift: Shift | null;
  /** รหัสเครื่องจักร/สถานีที่ใช้ผลิต เช่น WLD-03 */
  machine_no: string;
  /** รุ่นสินค้าที่กำลังผลิตในรอบนี้ */
  model_no: string;
  /** ผู้ปฏิบัติงานประจำเครื่อง — อ้างถึงทะเบียนพนักงาน */
  operator_id: string | null;
}

export interface QcRound extends ProductionContext {
  id: string;
  round_no: string;
  qc_id: string;
  round_date: ISODate;
  round_time: string; // HH:mm
  area_id: string;
  vsm_line: VsmLine;
  /** จำนวนชิ้นงานที่สุ่มตรวจในรอบนี้ */
  qty_checked: number;
  result: RoundResult;
  note: string;
  created_at: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   ปัญหาที่พบ + การแก้ไข
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * สถานะของปัญหา — ไหลทางเดียวยกเว้นตอนถูกตีกลับ
 *
 *   open        QC เพิ่งบันทึก ยังไม่มีใครรับทราบ
 *   in_progress VSM กดรับทราบแล้ว (started_at ว่าง) หรือเริ่มลงมือแก้แล้ว (started_at มีค่า)
 *   fixed       VSM ส่งรูปหลังแก้ไข + คำอธิบายแล้ว รอ QC ตรวจรับ
 *   rejected    QC ตรวจแล้วไม่ผ่าน ตีกลับให้แก้ใหม่ (VSM ทำงานต่อได้)
 *   verified    QC ตรวจรับผ่าน ปิดงาน
 *   cancelled   ยกเลิก (บันทึกผิด/ซ้ำ) เก็บไว้เป็นหลักฐาน ไม่ลบทิ้ง
 *
 * ค่าชุดนี้ต้องตรงกับ CHECK ใน schema.sql — "รับทราบ" จึงไม่ได้เป็นสถานะแยก
 * (เพิ่มค่าใน CHECK ของ SQLite ต้องสร้างตารางใหม่ทั้งตาราง) ดู stageOf() ใน calc.ts
 */
export type IssueStatus = 'open' | 'in_progress' | 'fixed' | 'rejected' | 'verified' | 'cancelled';

/**
 * สถานะที่ผู้ใช้เห็น — เหมือน IssueStatus แต่แยก in_progress ออกเป็นสองขั้น
 *   acked        VSM รับทราบแล้ว ยังไม่เริ่มลงมือ
 *   in_progress  กำลังแก้ไข
 */
export type DisplayStatus = IssueStatus | 'acked';

/**
 * ขั้นตอนการดำเนินการ 5 ขั้นที่โรงงานกำหนด — ใช้วาดแถบขั้นตอนและจัดกลุ่มในรายงาน
 *   1 found   QC ตรวจสอบพบปัญหา
 *   2 acked   VSM รับทราบ
 *   3 fixing  กำลังแก้ไข (รวมถึงใบที่ถูกตีกลับให้แก้ใหม่)
 *   4 fixed   แก้ไขเสร็จแล้ว — ส่งรูปหลังแก้ไข + คำอธิบาย รอ QC ตรวจรับ
 *   5 closed  QC ตรวจรับ ปิดงาน
 */
export const STAGES = ['found', 'acked', 'fixing', 'fixed', 'closed'] as const;
export type Stage = (typeof STAGES)[number];

/** หัวหน้าสาย VSM — คนที่ใบแจ้งของสายนั้นเด้งไปหา (สายหนึ่งมีได้หลายคน) */
export interface LineHead {
  vsm_line: VsmLine;
  employee_id: string;
}

/** สถานะที่ยังต้องมีคนทำอะไรต่อ — ใช้ทั้งหน้าจอและรายงาน */
export const ACTIVE_STATUSES: IssueStatus[] = ['open', 'in_progress', 'fixed', 'rejected'];
/** สถานะที่ VSM ต้องลงมือ */
export const VSM_ACTION_STATUSES: IssueStatus[] = ['open', 'in_progress', 'rejected'];

/** ความรุนแรง — กำหนดกรอบเวลาที่ต้องแก้ไขให้เสร็จ */
export type Severity = 'critical' | 'major' | 'minor';
export const SEVERITIES: Severity[] = ['critical', 'major', 'minor'];

export interface QcIssue extends ProductionContext {
  id: string;
  /** เลขที่ใบแจ้ง เช่น QC-260829-001 — เซิร์ฟเวอร์เป็นผู้ออกเลขจริง */
  issue_no: string;
  /** รอบตรวจที่พบ — null ได้เมื่อเป็นการแจ้งนอกรอบ */
  round_id: string | null;
  /** QC ผู้ตรวจพบ */
  qc_id: string;
  found_date: ISODate;
  found_time: string;
  area_id: string;
  /** สายที่ต้องแก้ไข — ต้องเป็น VSM1–VSM4 เท่านั้น */
  vsm_line: VsmLine;
  /** ประเภทข้อบกพร่อง (สูงสุด 3) */
  category_ids: string[];
  severity: Severity;
  part_no: string;
  lot_no: string;
  qty_checked: number;
  qty_defect: number;
  description: string;
  /** รูปหลักฐานฝั่ง QC */
  photo_urls: string[];
  /**
   * บันทึกเสียงบรรยายข้อบกพร่อง (ไม่บังคับ) — เก็บคีย์เดียว ไม่ใช่อาร์เรย์
   * หน้างานมือไม่ว่างและถุงมือเปื้อน การพูดจึงเร็วกว่าการพิมพ์
   * ใช้คลังไฟล์เดียวกับรูป (ดู src/lib/photos.ts) ตัวซิงก์จึงอัปโหลดให้เองโดยไม่ต้องแก้
   */
  voice_url: string | null;
  /** กำหนดแก้ไขให้เสร็จ */
  due_date: ISODate;
  status: IssueStatus;
  /** เวลาที่ VSM กดรับทราบ (ใช้วัดเวลาตอบสนอง) */
  acked_at: string | null;
  /** เวลาที่ VSM กดเริ่มแก้ไข — แยกขั้น "รับทราบ" ออกจาก "กำลังแก้ไข" */
  started_at: string | null;
  /** เวลาที่ QC ตรวจรับผ่าน (ใช้วัดเวลาปิดงาน) */
  closed_at: string | null;
  created_at: string;
}

/** ผลการตรวจรับงานแก้ไข */
export type VerifyResult = 'pending' | 'pass' | 'fail';

/**
 * งานแก้ไขที่ VSM ส่งกลับมา — หนึ่งปัญหามีได้หลายครั้ง (ถูกตีกลับแล้วแก้ใหม่)
 * เก็บแยกเป็นตารางเพราะต้องเห็นประวัติทุกครั้งที่แก้ ไม่ใช่เห็นแค่ครั้งล่าสุด
 */
export interface IssueFix {
  id: string;
  issue_id: string;
  /** คนของ VSM ที่ลงมือแก้ */
  responder_id: string;
  /** ครั้งที่เท่าไร นับจาก 1 */
  attempt: number;
  root_cause: string;
  action_taken: string;
  /** รูปยืนยันหลังแก้ไข — บังคับอย่างน้อย 1 รูป */
  photo_urls: string[];
  fixed_at: string;
  verify_result: VerifyResult;
  verify_note: string;
  verified_by: string | null;
  verified_at: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   ระบบ
   ══════════════════════════════════════════════════════════════════════════ */

export type ChangeAction = 'create' | 'update' | 'delete';

export interface ChangeHistory {
  id: string;
  table_name: string;
  record_id: string;
  action_type: ChangeAction;
  field?: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
}

export interface LoginHistory {
  id: string;
  actor_id: string;
  actor_name: string;
  role: 'employee' | 'admin';
  at: string;
  result: 'success' | 'failed';
}

export interface AppSettings {
  /** กรอบเวลาแก้ไขมาตรฐาน (วัน) แยกตามความรุนแรง */
  due_days_critical: number;
  due_days_major: number;
  due_days_minor: number;
  /** เป้าหมายอัตราการปิดงานตรงกำหนด (%) — ใช้ตัดสินสีบนแดชบอร์ด */
  target_ontime_pct: number;
  company_name: string;
  plant_name: string;
}

export interface Db {
  employees: Employee[];
  superusers: Superuser[];
  areas: Area[];
  defect_categories: DefectCategory[];
  qc_rounds: QcRound[];
  qc_issues: QcIssue[];
  issue_fixes: IssueFix[];
  /** อาจไม่มีในสำเนาที่เก็บไว้ก่อนมีฟีเจอร์หัวหน้าสาย — อ่านผ่าน ?? [] เสมอ */
  line_heads: LineHead[];
  change_history: ChangeHistory[];
  login_history: LoginHistory[];
  app_settings: AppSettings;
  _version: number;
}
