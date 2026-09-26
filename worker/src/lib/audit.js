/**
 * ร่องรอยการแก้ไข (change_history)
 *
 * ตรรกะตรงกับ logDiff() ใน src/lib/api.ts ของ frontend
 * เพื่อให้หน้ารายละเอียดใบแจ้งแสดงประวัติได้เหมือนกันทั้งสองฝั่ง
 */

import { nowStamp, uid } from './http.js';

/** ฟิลด์ที่ไม่ต้องบันทึกประวัติ — เปลี่ยนทุกครั้งอยู่แล้วหรือไม่มีความหมายเชิงธุรกิจ */
const IGNORED = new Set(['id', 'created_at', 'issue_no', 'round_no']);

/** แปลงค่าให้เทียบกันได้ — ค่าว่างทุกแบบถือเป็น null เหมือนกันหมด */
function normalize(v) {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return String(v);
  return String(v);
}

/** สร้างคำสั่ง INSERT หนึ่งแถวของ change_history */
export function entryStmt(db, { table, recordId, action, field = null, oldV = null, newV = null, actor }) {
  return db
    .prepare(
      `INSERT INTO change_history
         (id, table_name, record_id, action_type, field, old_value, new_value, changed_by, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(uid('ch'), table, recordId, action, field, oldV, newV, actor, nowStamp());
}

/**
 * เทียบค่าเดิมกับค่าใหม่ แล้วคืนรายการคำสั่ง INSERT เฉพาะฟิลด์ที่เปลี่ยนจริง
 * ผู้เรียกเอาไปต่อท้าย batch เดียวกับการอัปเดต เพื่อให้เขียนสำเร็จหรือล้มเหลวพร้อมกัน
 */
export function diffStmts(db, { table, recordId, before, after, actor }) {
  const stmts = [];
  for (const key of Object.keys(after)) {
    if (IGNORED.has(key)) continue;
    const a = normalize(before?.[key]);
    const b = normalize(after[key]);
    if (a === b) continue;
    stmts.push(entryStmt(db, { table, recordId, action: 'update', field: key, oldV: a, newV: b, actor }));
  }
  return stmts;
}
