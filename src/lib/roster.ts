import type { Area, Employee, Role, Superuser, VsmLine } from './types';
import { isVsmLine } from './types';
// ทะเบียนจริงอยู่ใน roster.data.ts (ไม่ขึ้น git) — vite.config.ts ชี้ @roster-data ไปที่ไฟล์ตัวอย่างเมื่อไม่มีไฟล์จริง
import { ADMINS, PEOPLE } from '@roster-data';

/**
 * ── ทะเบียนผู้ใช้ · จุดตรวจ · ผู้ดูแลระบบ (ค่าตั้งต้น) ───────────────────
 *
 * ⚠️ รายชื่อพนักงานจริงอยู่ใน roster.data.ts (สร้างจากฐานข้อมูลพนักงานของโปรเจค PSIF)
 *    ซึ่งไม่ขึ้น git เพราะมีชื่อ-รหัสทั้งโรงงานและรายชื่อผู้ดูแลระบบ
 *    repo มีแค่ roster.data.example.ts ที่เป็นข้อมูลสมมติรูปแบบเดียวกัน
 *    เมื่อมีคนเข้า–ออก ให้แก้ roster.data.ts แล้วรัน node worker/gen-seed.mjs
 *    หรือแก้รายคนผ่านหน้าตั้งค่าของแอปก็ได้ (ค่าที่แก้ในแอปจะไม่ถูกทับ)
 *
 *    ไฟล์นี้ใช้เฉพาะโหมดในเครื่อง (ไม่มีเซิร์ฟเวอร์) และเป็นแหล่งของ worker/seed.sql
 *    ต่อระบบจริงแล้วทะเบียนมาจากเซิร์ฟเวอร์หลังเข้าสู่ระบบเท่านั้น (ดู boot() ใน src/main.tsx)
 *
 * รหัสเข้าระบบ = รหัสพนักงาน (ตัวอักษร–ตัวเลข มีหรือไม่มีขีดกลางก็ได้)
 */

/**
 * จุดตรวจในไลน์ผลิต — โครงสองชั้น: สายการผลิต › สถานี
 *
 * สถานีของแต่ละสายตั้งชื่อกลาง ๆ ไว้ก่อน เพราะชื่อจริงต่างกันไปตามรุ่นที่ผลิต
 * ผู้ดูแลระบบแก้ชื่อ/เพิ่ม/ปิดสถานีได้จากหน้าตั้งค่าโดยไม่ต้องแก้โค้ด
 *
 * vsm_line ของพื้นที่คือหัวใจของการส่งงาน: เลือกจุดตรวจแล้วระบบเติมสายผู้รับผิดชอบให้เอง
 * พื้นที่ที่ไม่ได้อยู่ใต้สายใด (คลัง/จุดรับเข้า) มีค่าเป็น null — QC ต้องเลือกสายเอง
 */
type AreaRow = [id: string, nameTh: string, nameEn: string, parent: string | null, vsm: VsmLine | null];

/** สถานีมาตรฐานของทุกสาย — [ต่อท้าย id, ชื่อไทย, ชื่ออังกฤษ] */
const STATIONS: [suffix: string, th: string, en: string][] = [
  ['prep', 'เตรียมชิ้นงาน', 'Material Prep'],
  ['form', 'ขึ้นรูป/ดัดท่อ', 'Forming / Bending'],
  ['weld', 'เชื่อม', 'Welding'],
  ['asm', 'ประกอบ', 'Assembly'],
  ['final', 'ตรวจขั้นสุดท้าย', 'Final Inspection'],
  ['pack', 'บรรจุ', 'Packing'],
];

const LINE_AREAS: AreaRow[] = (['VSM1', 'VSM2', 'VSM3', 'VSM4'] as VsmLine[]).flatMap((line) => {
  const root = `ar_${line.toLowerCase()}`;
  return [
    [root, `สายการผลิต ${line}`, `Line ${line}`, null, line] as AreaRow,
    ...STATIONS.map(
      ([suffix, th, en]) => [`${root}_${suffix}`, th, en, root, line] as AreaRow,
    ),
  ];
});

/** พื้นที่นอกสายการผลิต — พบปัญหาที่นี่ได้ แต่ต้องเลือกสายผู้รับผิดชอบเอง */
const SUPPORT_AREAS: AreaRow[] = [
  ['ar_iqc', 'จุดรับเข้า / IQC', 'Incoming / IQC', null, null],
  ['ar_wh', 'คลังสินค้า', 'Warehouse', null, null],
  ['ar_store', 'สโตร์ / คลังอะไหล่', 'Store', null, null],
];

const AREAS: AreaRow[] = [...LINE_AREAS, ...SUPPORT_AREAS];


/** id ของผู้ใช้ อิงรหัสพนักงานเพื่อให้ตรงกันทั้งฝั่งเครื่องและเซิร์ฟเวอร์ */
export const employeeId = (code: string) => 'emp_' + code.replace(/[^A-Za-z0-9]/g, '_');

/**
 * ตำแหน่งที่เปิดสิทธิ์เข้าใช้แอปไว้ตั้งแต่ต้น
 *
 * รหัสเข้าระบบคือรหัสพนักงานซึ่งเดาได้ไม่ยาก ถ้าเปิดให้ทั้ง 393 คน
 * ใครก็ล็อกอินแทนกันได้ทั้งโรงงาน จึงเปิดเฉพาะคนที่ต้องใช้งานจริง คือ
 *   · ทุกคนในแผนก Quality Control  (เป็นผู้ตรวจ ต้องบันทึกปัญหาได้)
 *   · ระดับหัวหน้าขึ้นไปของสาย VSM1–VSM4 (เป็นผู้แก้ไข ต้องส่งงานกลับได้)
 *   · ผู้ดูแลระบบ/QA ที่ต้องติดตามผล
 * คนที่เหลือยังอยู่ในทะเบียน และผู้ดูแลระบบเปิดสิทธิ์เพิ่มรายคนได้
 *
 * ค่าชุดนี้ต้องตรงกับตรรกะเดียวกันใน worker/seed.sql
 */
const LEAD_POSITIONS = ['ผู้จัดการ', 'ผู้ดูแลแผนก', 'หัวหน้าทีม', 'ผู้ดูแลระบบ'];

/** แผนกที่ถือเป็นฝ่ายตรวจสอบคุณภาพ */
const QC_DEPARTMENTS = ['Quality Control'];
/** แผนกที่ติดตามผลได้แต่ไม่ได้เป็นผู้ตรวจหรือผู้แก้ */
const OVERSIGHT_DEPARTMENTS = ['Quality Assurance', 'Lean', 'Process Engineer', 'Engineer', 'EHS'];

/** แผนกในทะเบียน PSIF ใช้ชื่อ 'VSM1'…'VSM4' ตรง ๆ อยู่แล้ว จึงแปลงได้ทันที */
export function vsmOfDepartment(department: string): VsmLine | null {
  const key = department.trim().toUpperCase().replace(/\s+/g, '');
  return isVsmLine(key) ? key : null;
}

/** บทบาทตั้งต้นจากแผนก — ผู้ดูแลระบบแก้รายคนทีหลังได้ */
export function roleOfDepartment(department: string): Role {
  if (QC_DEPARTMENTS.includes(department)) return 'qc';
  if (vsmOfDepartment(department)) return 'vsm';
  return 'viewer';
}

export function buildEmployees(createdAt: string): Employee[] {
  return PEOPLE.map(([code, name, dept, position, active]) => {
    const role = roleOfDepartment(dept);
    const vsm_line = vsmOfDepartment(dept);
    // QC ทุกคนต้องบันทึกปัญหาได้ · ฝั่ง VSM เปิดให้ระดับหัวหน้าเพื่อคุมจำนวนบัญชี
    const canLogin =
      role === 'qc' ||
      (role === 'vsm' && LEAD_POSITIONS.includes(position)) ||
      (OVERSIGHT_DEPARTMENTS.includes(dept) && LEAD_POSITIONS.includes(position)) ||
      position === 'ผู้ดูแลระบบ';

    return {
      id: employeeId(code),
      emp_code: code,
      full_name: name,
      department: dept,
      position,
      avatar_url: null,
      role,
      vsm_line,
      is_active: active === 1,
      dashboard_enabled: true,
      can_login: active === 1 && canLogin,
      created_at: createdAt,
    };
  });
}

export function buildAreas(): Area[] {
  return AREAS.map(([id, nameTh, nameEn, parent, vsm]) => ({
    id,
    area_name: nameTh,
    area_name_en: nameEn,
    parent_id: parent,
    vsm_line: vsm,
    is_active: true,
  }));
}

export function buildSuperusers(): Superuser[] {
  return ADMINS.map(([code, name]) => ({
    id: 'su_' + code.replace(/[^A-Za-z0-9]/g, '_'),
    admin_code: code,
    full_name: name,
  }));
}
