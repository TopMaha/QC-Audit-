/**
 * ตัวช่วยเรื่อง HTTP: รูปแบบคำตอบ + การตรวจสอบ input
 *
 * ทุก endpoint ตอบเป็น JSON รูปแบบเดียวกันเสมอ
 *   สำเร็จ  { ok: true,  data }
 *   ล้มเหลว { ok: false, error }
 */

/** คำตอบเมื่อสำเร็จ */
export function ok(c, data, status = 200) {
  return c.json({ ok: true, data }, status);
}

/** คำตอบเมื่อล้มเหลว — error เป็นข้อความภาษาไทยที่เอาไปแสดงบนหน้าจอได้เลย */
export function fail(c, error, status = 400) {
  return c.json({ ok: false, error }, status);
}

/**
 * ข้อผิดพลาดจากการตรวจ input — โยนออกมาแล้วให้ตัวจับกลางแปลงเป็น 400
 * เก็บชื่อ field ไว้ด้วย เพื่อให้ผู้เรียกรู้ว่าผิดตรงไหน
 */
export class BadInput extends Error {
  constructor(field, message) {
    super(`ข้อมูลไม่ถูกต้องที่ฟิลด์ "${field}" — ${message}`);
    this.field = field;
  }
}

/** อ่าน JSON body แบบไม่ให้ throw ดิบ ๆ ออกไป */
export async function readJson(c) {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadInput('body', 'ต้องเป็นอ็อบเจกต์ JSON');
    }
    return body;
  } catch (e) {
    if (e instanceof BadInput) throw e;
    throw new BadInput('body', 'อ่าน JSON ไม่ได้');
  }
}

/* ── ตัวตรวจค่าแต่ละชนิด ────────────────────────────────────────────────
   ทุกตัวคืนค่าที่ผ่านการทำความสะอาดแล้ว หรือโยน BadInput พร้อมชื่อฟิลด์ */

export function str(obj, field, { required = true, max = 5000, fallback = '' } = {}) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadInput(field, 'ต้องระบุค่า');
    return fallback;
  }
  if (typeof v !== 'string') throw new BadInput(field, 'ต้องเป็นข้อความ');
  const trimmed = v.trim();
  if (required && trimmed === '') throw new BadInput(field, 'ต้องระบุค่า');
  if (trimmed.length > max) throw new BadInput(field, `ยาวเกิน ${max} ตัวอักษร`);
  return trimmed;
}

/** วันที่รูปแบบ YYYY-MM-DD และต้องเป็นวันที่ที่มีอยู่จริงบนปฏิทิน */
export function isoDate(obj, field, { required = true, fallback = null } = {}) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadInput(field, 'ต้องระบุวันที่');
    return fallback;
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new BadInput(field, 'ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  }
  // กัน 2026-02-31 ที่ผ่าน regex แต่ไม่มีอยู่จริง
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new BadInput(field, 'ไม่ใช่วันที่ที่มีอยู่จริง');
  }
  return v;
}

/** เวลารูปแบบ HH:mm แบบ 24 ชั่วโมง */
export function hhmm(obj, field, { required = true, fallback = '' } = {}) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadInput(field, 'ต้องระบุเวลา');
    return fallback;
  }
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    throw new BadInput(field, 'ต้องอยู่ในรูปแบบ HH:mm (00:00–23:59)');
  }
  return v;
}

export function bool(obj, field, { fallback = false } = {}) {
  const v = obj[field];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new BadInput(field, 'ต้องเป็น true หรือ false');
  return v;
}

export function int(obj, field, { required = true, min = null, max = null, fallback = 0 } = {}) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadInput(field, 'ต้องระบุตัวเลข');
    return fallback;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) throw new BadInput(field, 'ต้องเป็นจำนวนเต็ม');
  if (min !== null && n < min) throw new BadInput(field, `ต้องไม่น้อยกว่า ${min}`);
  if (max !== null && n > max) throw new BadInput(field, `ต้องไม่เกิน ${max}`);
  return n;
}

/** อาร์เรย์ของข้อความ เช่น category_ids, photo_urls — ตัดค่าซ้ำและค่าว่างออก */
export function strArray(obj, field, { required = false, maxItems = 50, maxLen = 300 } = {}) {
  const v = obj[field];
  if (v === undefined || v === null) {
    if (required) throw new BadInput(field, 'ต้องระบุอย่างน้อย 1 รายการ');
    return [];
  }
  if (!Array.isArray(v)) throw new BadInput(field, 'ต้องเป็นอาร์เรย์');
  const out = [];
  for (const raw of v) {
    if (typeof raw !== 'string') throw new BadInput(field, 'สมาชิกทุกตัวต้องเป็นข้อความ');
    const s = raw.trim();
    if (s === '') continue;
    if (s.length > maxLen) throw new BadInput(field, `สมาชิกยาวเกิน ${maxLen} ตัวอักษร`);
    if (!out.includes(s)) out.push(s);
  }
  if (required && out.length === 0) throw new BadInput(field, 'ต้องระบุอย่างน้อย 1 รายการ');
  if (out.length > maxItems) throw new BadInput(field, `เกิน ${maxItems} รายการ`);
  return out;
}

/** ค่าที่ต้องอยู่ในชุดที่กำหนดเท่านั้น เช่น status, severity */
export function oneOf(obj, field, allowed, { required = true, fallback = null } = {}) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadInput(field, `ต้องเป็นค่าใดค่าหนึ่งใน ${allowed.join(', ')}`);
    return fallback;
  }
  if (!allowed.includes(v)) throw new BadInput(field, `ต้องเป็นค่าใดค่าหนึ่งใน ${allowed.join(', ')}`);
  return v;
}

/* ── ค่าคงที่ของโดเมน — ต้องตรงกับ src/lib/types.ts และ CHECK ใน schema.sql ── */

export const VSM_LINES = ['VSM1', 'VSM2', 'VSM3', 'VSM4'];
export const SEVERITIES = ['critical', 'major', 'minor'];
export const ISSUE_STATUSES = ['open', 'in_progress', 'fixed', 'rejected', 'verified', 'cancelled'];
export const ACTIVE_STATUSES = ['open', 'in_progress', 'fixed', 'rejected'];
export const ROLES = ['qc', 'vsm', 'viewer'];
/** กะการทำงาน — ต้องตรงกับ SHIFTS ใน src/lib/types.ts และ CHECK ใน schema.sql */
export const SHIFTS = ['A', 'B', 'C'];

/** สายการผลิต — จำกัดที่ VSM1–VSM4 เท่านั้นตามข้อตกลงของระบบ */
export function vsmLine(obj, field, { required = true, fallback = null } = {}) {
  const v = obj[field];
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadInput(field, `ต้องเป็น ${VSM_LINES.join(', ')}`);
    return fallback;
  }
  if (!VSM_LINES.includes(v)) throw new BadInput(field, `ต้องเป็น ${VSM_LINES.join(', ')} เท่านั้น`);
  return v;
}

/* ── ตัวช่วยอ่าน query string ─────────────────────────────────────────── */

export function qDate(c, name) {
  const v = c.req.query(name);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadInput(name, 'ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  return v;
}

export function qInt(c, name, fallback, { min = 0, max = 1000 } = {}) {
  const v = c.req.query(name);
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadInput(name, `ต้องเป็นจำนวนเต็มระหว่าง ${min} ถึง ${max}`);
  }
  return n;
}

/* ── ตัวช่วยทั่วไป ────────────────────────────────────────────────────── */

/** สร้าง id รูปแบบเดียวกับที่ frontend ใช้ (uid() ใน src/lib/utils.ts) */
export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${rand}${time}`;
}

/**
 * ทำรหัสพนักงานให้อยู่ในรูปมาตรฐานก่อนเทียบ — ตรงกับ normalizeCode() ของ frontend
 *
 * รหัสจริงมีขีดกลางและตัวพิมพ์ใหญ่ (เช่น A-123 · ABC123) แต่คนพิมพ์บนมือถือมักได้ 'a123'
 * ถ้าเทียบตรง ๆ จะเข้าระบบไม่ได้ทั้งที่รหัสถูก · ตรวจแล้วว่ารหัสทั้งชุดไม่ชนกัน
 */
export function normalizeCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * นิพจน์ SQL ที่ให้ผลเดียวกับ normalizeCode() — ใช้เทียบรหัสฝั่งฐานข้อมูล
 * ตารางมีไม่กี่ร้อยแถว การสแกนเต็มตารางจึงไม่ใช่ปัญหา
 */
export const normalizedSql = (col) => `UPPER(REPLACE(REPLACE(${col}, '-', ''), ' ', ''))`;

/** เวลาปัจจุบันแบบ ISO 8601 UTC — ตรงกับ nowStamp() ของ frontend */
export function nowStamp() {
  return new Date().toISOString();
}

/** วันที่วันนี้ตามเวลาไทย (Asia/Bangkok = UTC+7 ไม่มี DST) */
export function todayBangkok() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** บวกวันแบบไม่แตะโซนเวลา — ใช้คำนวณกำหนดแก้ไข */
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** จำนวนวันระหว่างสองวัน (b - a) */
export function diffDays(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
