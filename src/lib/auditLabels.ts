import type { Lang } from './time';

/**
 * ชื่อที่อ่านออกของตารางและคอลัมน์ที่โผล่ในประวัติการแก้ไข
 *
 * ประวัติถูกบันทึกด้วยชื่อคอลัมน์ดิบ (qc_issues.due_date) เพราะฝั่ง Worker
 * ไม่ควรผูกกับภาษาที่หน้าจอใช้ การแปลจึงเกิดตอนแสดงผลที่นี่ที่เดียว
 * ทั้งหน้ารายละเอียดใบแจ้งและหน้าบันทึกระบบของผู้ดูแลใช้ตารางแปลชุดเดียวกัน
 * ไม่งั้นคำเดียวกันจะถูกเรียกคนละอย่างในสองหน้า
 */

const FIELD_LABELS: Record<string, { th: string; en: string }> = {
  description: { th: 'รายละเอียดปัญหา', en: 'Description' },
  severity: { th: 'ความรุนแรง', en: 'Severity' },
  status: { th: 'สถานะ', en: 'Status' },
  category_ids: { th: 'ประเภทข้อบกพร่อง', en: 'Categories' },
  vsm_line: { th: 'สายที่รับผิดชอบ', en: 'Responsible line' },
  due_date: { th: 'กำหนดแก้ไข', en: 'Due date' },
  area_id: { th: 'จุดตรวจ', en: 'Check point' },
  part_no: { th: 'รหัสชิ้นงาน', en: 'Part number' },
  lot_no: { th: 'เลขที่ล็อต', en: 'Lot number' },
  qty_checked: { th: 'จำนวนที่สุ่มตรวจ', en: 'Inspected qty' },
  qty_defect: { th: 'จำนวนที่บกพร่อง', en: 'Defective qty' },
  photo_urls: { th: 'รูปหลักฐาน', en: 'Photos' },
  voice_url: { th: 'บันทึกเสียง', en: 'Voice note' },
  shift: { th: 'กะ', en: 'Shift' },
  machine_no: { th: 'เครื่องจักร', en: 'Machine' },
  model_no: { th: 'รุ่นสินค้า', en: 'Model' },
  operator_id: { th: 'ผู้ปฏิบัติงาน', en: 'Operator' },
  note: { th: 'หมายเหตุ', en: 'Note' },
  result: { th: 'ผลรอบตรวจ', en: 'Round result' },
  acked_at: { th: 'เวลารับเรื่อง', en: 'Acknowledged at' },
  closed_at: { th: 'เวลาปิดงาน', en: 'Closed at' },
  attempt: { th: 'ครั้งที่แก้ไข', en: 'Attempt' },
  verify_result: { th: 'ผลการตรวจรับ', en: 'Verification' },
  verify_note: { th: 'เหตุผลการตรวจรับ', en: 'Verification note' },
  root_cause: { th: 'สาเหตุราก', en: 'Root cause' },
  action_taken: { th: 'สิ่งที่แก้ไข', en: 'Action taken' },
  // ทะเบียนผู้ใช้ / จุดตรวจ / ประเภท
  full_name: { th: 'ชื่อ-สกุล', en: 'Full name' },
  full_name_en: { th: 'ชื่อ (อังกฤษ)', en: 'Name (EN)' },
  emp_code: { th: 'รหัสพนักงาน', en: 'Employee code' },
  department: { th: 'แผนก', en: 'Department' },
  position: { th: 'ตำแหน่ง', en: 'Position' },
  role: { th: 'บทบาท', en: 'Role' },
  is_active: { th: 'สถานะพนักงาน', en: 'Active' },
  can_login: { th: 'สิทธิ์เข้าใช้แอป', en: 'App access' },
  dashboard_enabled: { th: 'สิทธิ์ดูแดชบอร์ด', en: 'Dashboard access' },
  avatar_url: { th: 'รูปโปรไฟล์', en: 'Avatar' },
  area_name: { th: 'ชื่อจุดตรวจ', en: 'Check point name' },
  area_name_en: { th: 'ชื่อจุดตรวจ (อังกฤษ)', en: 'Check point name (EN)' },
  parent_id: { th: 'อยู่ภายใต้', en: 'Parent area' },
  category_name: { th: 'ชื่อประเภท', en: 'Category name' },
  category_name_en: { th: 'ชื่อประเภท (อังกฤษ)', en: 'Category name (EN)' },
};

const TABLE_LABELS: Record<string, { th: string; en: string }> = {
  qc_issues: { th: 'ใบแจ้ง', en: 'Issues' },
  qc_rounds: { th: 'รอบตรวจ', en: 'Rounds' },
  issue_fixes: { th: 'งานแก้ไข', en: 'Corrections' },
  employees: { th: 'ทะเบียนผู้ใช้', en: 'Employees' },
  areas: { th: 'จุดตรวจ', en: 'Check points' },
  defect_categories: { th: 'ประเภทข้อบกพร่อง', en: 'Defect categories' },
  app_settings: { th: 'ตั้งค่าระบบ', en: 'Settings' },
};

/** ตารางที่ใช้เป็นตัวกรองในหน้าบันทึกระบบ — เรียงตามที่ผู้ดูแลมองหาบ่อยสุด */
export const AUDIT_TABLES = ['qc_issues', 'qc_rounds', 'issue_fixes', 'employees', 'areas', 'defect_categories'];

/** ชื่อคอลัมน์ที่อ่านออก — คืนชื่อดิบเมื่อยังไม่มีคำแปล ดีกว่าคืนค่าว่าง */
export function fieldLabel(key: string | undefined, lang: Lang): string {
  if (!key) return '';
  return FIELD_LABELS[key]?.[lang] ?? key;
}

export function tableLabel(table: string, lang: Lang): string {
  return TABLE_LABELS[table]?.[lang] ?? table;
}
