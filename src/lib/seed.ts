import type { Db, DefectCategory } from './types';
import type * as Roster from './roster';

/**
 * ข้อมูลตั้งต้นตอนเปิดแอปครั้งแรก — ทะเบียนผู้ใช้/จุดตรวจ/ประเภทข้อบกพร่องเท่านั้น
 *
 * ไม่มีรอบตรวจ ไม่มีปัญหา ไม่มีประวัติใด ๆ ทั้งสิ้น ระบบเริ่มจากศูนย์จริง
 *
 * ⚠️ ทะเบียนพนักงาน (src/lib/roster.ts) ใช้เฉพาะโหมดในเครื่องที่ไม่มีเซิร์ฟเวอร์
 * ต่อระบบจริงแล้วทะเบียนมาจากเซิร์ฟเวอร์หลังเข้าสู่ระบบเท่านั้น และห้ามอยู่ในไฟล์เว็บ
 * เพราะมีรหัสพนักงานทุกคนและรายชื่อผู้ดูแลระบบ ใครเปิดเว็บก็อ่านได้
 * main.tsx จึงโหลด roster แบบ dynamic import ในเงื่อนไขที่ build ของจริงตัดทิ้งไปทั้งก้อน
 */
let roster: typeof Roster | null = null;

/** โหมดในเครื่องเท่านั้น — main.tsx เรียกก่อนแอปเริ่มอ่านข้อมูล */
export function registerLocalRoster(r: typeof Roster) {
  roster = r;
}

/**
 * ประเภทข้อบกพร่องตั้งต้น — เลขนำหน้าไว้ให้เรียงและเรียกชื่อกันในที่ประชุมได้ง่าย
 * ผู้ดูแลระบบเพิ่ม/ปิดได้จากหน้าตั้งค่า โดยไม่ต้องแก้โค้ด
 */
const CATEGORIES: DefectCategory[] = [
  { id: 'cat_01', category_name: '1-มิติ/ขนาดไม่ได้ตามแบบ', category_name_en: '1-Dimension out of spec', is_active: true },
  { id: 'cat_02', category_name: '2-รอยเชื่อมบกพร่อง', category_name_en: '2-Welding defect', is_active: true },
  { id: 'cat_03', category_name: '3-ผิวงาน/รอยขีดข่วน', category_name_en: '3-Surface / Scratch', is_active: true },
  { id: 'cat_04', category_name: '4-ประกอบผิด/ชิ้นส่วนขาด', category_name_en: '4-Wrong or missing part', is_active: true },
  { id: 'cat_05', category_name: '5-การปนเปื้อน/สิ่งแปลกปลอม', category_name_en: '5-Contamination / FOD', is_active: true },
  { id: 'cat_06', category_name: '6-ฉลาก/การชี้บ่งไม่ถูกต้อง', category_name_en: '6-Labelling / Identification', is_active: true },
  { id: 'cat_07', category_name: '7-ไม่ทำตามมาตรฐานงาน', category_name_en: '7-Standard work not followed', is_active: true },
  { id: 'cat_08', category_name: '8-เครื่องมือวัด/เครื่องจักรผิดปกติ', category_name_en: '8-Gauge / Machine abnormality', is_active: true },
  { id: 'cat_09', category_name: '9-บรรจุภัณฑ์เสียหาย', category_name_en: '9-Packaging damage', is_active: true },
  { id: 'cat_10', category_name: '10-เอกสารไม่ครบ', category_name_en: '10-Incomplete document', is_active: true },
];

export function buildSeedDb(): Db {
  return {
    _version: 1,
    employees: roster?.buildEmployees(new Date().toISOString()) ?? [],
    superusers: roster?.buildSuperusers() ?? [],
    areas: roster?.buildAreas() ?? [],
    defect_categories: CATEGORIES,
    qc_rounds: [],
    qc_issues: [],
    issue_fixes: [],
    line_heads: [],
    change_history: [],
    login_history: [],
    app_settings: {
      // ยิ่งรุนแรงยิ่งต้องเสร็จเร็ว — critical ต้องแก้ภายในวันเดียว
      due_days_critical: 1,
      due_days_major: 3,
      due_days_minor: 7,
      target_ontime_pct: 90,
      company_name: 'TENNECO',
      plant_name: 'TENNECO',
    },
  };
}
