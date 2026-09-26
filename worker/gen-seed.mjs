/**
 * สร้าง worker/seed.sql จากทะเบียนตั้งต้นใน src/lib/roster.ts
 *
 *   node worker/gen-seed.mjs
 *
 * ทำไมต้องสร้างอัตโนมัติแทนที่จะเขียน SQL ด้วยมือ:
 * ทะเบียนมีเกือบสี่ร้อยคน และกติกา "ใครเข้าระบบได้บ้าง / ใครเป็น QC / ใครอยู่สายไหน"
 * ต้องตรงกันเป๊ะระหว่างสำเนาในเครื่อง (roster.ts) กับฐานข้อมูลบนเซิร์ฟเวอร์
 * ถ้าเขียนสองที่แยกกัน วันหนึ่งจะเพี้ยนกันแน่นอนโดยไม่มีใครรู้ตัว
 *
 * ไฟล์นี้จึงอ่าน roster.ts เป็นแหล่งความจริงเพียงแหล่งเดียว แล้วแปลงเป็น SQL
 * เมื่อมีคนเข้า–ออก ให้แก้ roster.ts แล้วรันคำสั่งนี้ใหม่
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rosterPath = resolve(here, '../src/lib/roster.ts');
const outPath = resolve(here, 'seed.sql');
const src = readFileSync(rosterPath, 'utf8');

// รายชื่อพนักงานจริงอยู่ใน roster.data.ts ที่ไม่ขึ้น git
// clone มาใหม่ยังไม่มีไฟล์นั้น ใช้ไฟล์ตัวอย่าง (ข้อมูลสมมติ) แทน พร้อมเตือน
const realData = resolve(here, '../src/lib/roster.data.ts');
const dataPath = existsSync(realData) ? realData : resolve(here, '../src/lib/roster.data.example.ts');
const dataSrc = readFileSync(dataPath, 'utf8');
if (dataPath !== realData) console.warn('⚠️ ไม่พบ src/lib/roster.data.ts — สร้าง seed.sql จากข้อมูลตัวอย่าง');

/** ดึงเนื้อในของ array literal ออกมาแล้วแปลงเป็นค่า JS จริง */
function extractArray(name, typeSig, text = src) {
  // รับทั้ง LF และ CRLF — clone บน Windows ได้ไฟล์ CRLF (core.autocrlf)
  const re = new RegExp(`const ${name}: ${typeSig} = \\[\\r?\\n([\\s\\S]*?)\\r?\\n\\];`);
  const m = re.exec(text);
  if (!m) throw new Error(`หา ${name} ใน roster.ts ไม่เจอ`);
  // ค่าเป็น array literal ล้วน ไม่มีการเรียกฟังก์ชัน จึงประเมินได้อย่างปลอดภัย
  return eval(`[${m[1]}]`);
}

const PEOPLE = extractArray('PEOPLE', 'PersonRow\\[\\]', dataSrc);
const ADMINS = extractArray('ADMINS', '\\[code: string, name: string\\]\\[\\]', dataSrc);
const STATIONS = extractArray('STATIONS', '\\[suffix: string, th: string, en: string\\]\\[\\]');
const SUPPORT_AREAS = extractArray('SUPPORT_AREAS', 'AreaRow\\[\\]');

/* ── กติกาเดียวกับ roster.ts (ดูคำอธิบายเหตุผลที่นั่น) ─────────────────── */

const VSM_LINES = ['VSM1', 'VSM2', 'VSM3', 'VSM4'];
const LEAD_POSITIONS = ['ผู้จัดการ', 'ผู้ดูแลแผนก', 'หัวหน้าทีม', 'ผู้ดูแลระบบ'];
const QC_DEPARTMENTS = ['Quality Control'];
const OVERSIGHT_DEPARTMENTS = ['Quality Assurance', 'Lean', 'Process Engineer', 'Engineer', 'EHS'];

const vsmOfDepartment = (dept) => {
  const key = String(dept).trim().toUpperCase().replace(/\s+/g, '');
  return VSM_LINES.includes(key) ? key : null;
};

const roleOfDepartment = (dept) => {
  if (QC_DEPARTMENTS.includes(dept)) return 'qc';
  if (vsmOfDepartment(dept)) return 'vsm';
  return 'viewer';
};

const employeeId = (code) => 'emp_' + String(code).replace(/[^A-Za-z0-9]/g, '_');

/* ── ตัวช่วยเขียน SQL ──────────────────────────────────────────────────── */

/** หุ้มสตริงแบบ SQL — escape เครื่องหมาย ' ด้วยการเขียนซ้ำสองตัว */
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);

const lines = [];
const say = (s = '') => lines.push(s);

say('-- ============================================================================');
say('--  QC Audit Line — ข้อมูลตั้งต้น (ทะเบียนผู้ใช้ · จุดตรวจ · ประเภทข้อบกพร่อง)');
say('--');
say('--  ⚠️ ไฟล์นี้ถูกสร้างอัตโนมัติ — ห้ามแก้ด้วยมือ');
say('--     แก้ที่ src/lib/roster.ts แล้วรัน `node worker/gen-seed.mjs` ใหม่');
say('--');
say('--  รันด้วย: wrangler d1 execute qc-audit-line --file=./seed.sql --remote');
say('--  รันซ้ำได้ปลอดภัย (ใช้ INSERT OR IGNORE) — ข้อมูลที่ผู้ดูแลแก้ในแอปจะไม่ถูกทับ');
say('-- ============================================================================');
say();

/* ── พนักงาน ──────────────────────────────────────────────────────────── */
say('-- ── ทะเบียนพนักงาน ───────────────────────────────────────────────────────');
say('--  role       qc = ผู้ตรวจ · vsm = ผู้แก้ไข · viewer = ติดตามผล (จากแผนกใน PSIF)');
say('--  can_login  QC ทุกคน + ระดับหัวหน้าของสาย VSM และแผนกที่ต้องติดตามผล');
say('--             คนอื่นอยู่ในทะเบียนแต่ยังเข้าระบบไม่ได้ จนกว่าผู้ดูแลจะเปิดสิทธิ์ให้');
say();

const now = new Date().toISOString();
let qcCount = 0;
let vsmCount = 0;
let loginCount = 0;

for (const [code, name, dept, position, active] of PEOPLE) {
  const role = roleOfDepartment(dept);
  const line = vsmOfDepartment(dept);
  const canLogin =
    role === 'qc' ||
    (role === 'vsm' && LEAD_POSITIONS.includes(position)) ||
    (OVERSIGHT_DEPARTMENTS.includes(dept) && LEAD_POSITIONS.includes(position)) ||
    position === 'ผู้ดูแลระบบ';
  const granted = active === 1 && canLogin;

  if (role === 'qc') qcCount++;
  if (role === 'vsm') vsmCount++;
  if (granted) loginCount++;

  say(
    `INSERT OR IGNORE INTO employees (id, emp_code, full_name, full_name_en, department, position, avatar_url, role, vsm_line, is_active, dashboard_enabled, can_login, created_at) VALUES (` +
      [
        q(employeeId(code)),
        q(code),
        q(name),
        'NULL',
        q(dept),
        q(position),
        'NULL',
        q(role),
        // บทบาทที่ไม่ใช่ VSM ต้องไม่มีสายค้างไว้ ไม่งั้นตัวกรองงานเข้าจะเพี้ยน
        role === 'vsm' ? q(line) : 'NULL',
        active === 1 ? 1 : 0,
        1,
        granted ? 1 : 0,
        q(now),
      ].join(', ') +
      ');',
  );
}

say();
say(`-- รวม ${PEOPLE.length} คน · QC ${qcCount} คน · VSM ${vsmCount} คน · เปิดสิทธิ์เข้าระบบ ${loginCount} คน`);
say();

/* ── ผู้ดูแลระบบ ──────────────────────────────────────────────────────── */
say('-- ── ผู้ดูแลระบบ (เข้าที่ /admin ด้วยรหัสพนักงานของตัวเอง) ─────────────────');
for (const [code, name] of ADMINS) {
  const id = 'su_' + String(code).replace(/[^A-Za-z0-9]/g, '_');
  say(`INSERT OR IGNORE INTO superusers (id, admin_code, full_name) VALUES (${q(id)}, ${q(code)}, ${q(name)});`);
}
say();

/* ── จุดตรวจ ──────────────────────────────────────────────────────────── */
say('-- ── จุดตรวจ: สายการผลิต VSM1–VSM4 พร้อมสถานีย่อย ───────────────────────');
say('--  vsm_line ของจุดตรวจคือค่าที่ระบบใช้เติมสายผู้รับผิดชอบให้อัตโนมัติ');
say('--  ต้องใส่แถวแม่ก่อนแถวลูกเสมอ เพราะ parent_id เป็น FOREIGN KEY');
say();

for (const line of VSM_LINES) {
  const root = `ar_${line.toLowerCase()}`;
  say(
    `INSERT OR IGNORE INTO areas (id, area_name, area_name_en, parent_id, vsm_line, is_active) VALUES (` +
      `${q(root)}, ${q(`สายการผลิต ${line}`)}, ${q(`Line ${line}`)}, NULL, ${q(line)}, 1);`,
  );
  for (const [suffix, th, en] of STATIONS) {
    say(
      `INSERT OR IGNORE INTO areas (id, area_name, area_name_en, parent_id, vsm_line, is_active) VALUES (` +
        `${q(`${root}_${suffix}`)}, ${q(th)}, ${q(en)}, ${q(root)}, ${q(line)}, 1);`,
    );
  }
}

say();
say('-- พื้นที่นอกสายการผลิต — พบปัญหาที่นี่ได้ แต่ QC ต้องเลือกสายผู้รับผิดชอบเอง');
for (const [id, th, en, parent, vsm] of SUPPORT_AREAS) {
  say(
    `INSERT OR IGNORE INTO areas (id, area_name, area_name_en, parent_id, vsm_line, is_active) VALUES (` +
      `${q(id)}, ${q(th)}, ${q(en)}, ${parent === null ? 'NULL' : q(parent)}, ${vsm === null ? 'NULL' : q(vsm)}, 1);`,
  );
}
say();

/* ── ประเภทข้อบกพร่อง ─────────────────────────────────────────────────── */
say('-- ── ประเภทข้อบกพร่องตั้งต้น (ผู้ดูแลระบบเพิ่ม/ปิดได้จากหน้าตั้งค่า) ───────');
say('--  ต้องตรงกับ CATEGORIES ใน src/lib/seed.ts เพื่อให้ id เดียวกันทั้งสองฝั่ง');
say();

const CATEGORIES = [
  ['cat_01', '1-มิติ/ขนาดไม่ได้ตามแบบ', '1-Dimension out of spec'],
  ['cat_02', '2-รอยเชื่อมบกพร่อง', '2-Welding defect'],
  ['cat_03', '3-ผิวงาน/รอยขีดข่วน', '3-Surface / Scratch'],
  ['cat_04', '4-ประกอบผิด/ชิ้นส่วนขาด', '4-Wrong or missing part'],
  ['cat_05', '5-การปนเปื้อน/สิ่งแปลกปลอม', '5-Contamination / FOD'],
  ['cat_06', '6-ฉลาก/การชี้บ่งไม่ถูกต้อง', '6-Labelling / Identification'],
  ['cat_07', '7-ไม่ทำตามมาตรฐานงาน', '7-Standard work not followed'],
  ['cat_08', '8-เครื่องมือวัด/เครื่องจักรผิดปกติ', '8-Gauge / Machine abnormality'],
  ['cat_09', '9-บรรจุภัณฑ์เสียหาย', '9-Packaging damage'],
  ['cat_10', '10-เอกสารไม่ครบ', '10-Incomplete document'],
];

for (const [id, th, en] of CATEGORIES) {
  say(
    `INSERT OR IGNORE INTO defect_categories (id, category_name, category_name_en, is_active) VALUES (` +
      `${q(id)}, ${q(th)}, ${q(en)}, 1);`,
  );
}
say();

/* ── ตั้งค่าระบบ ──────────────────────────────────────────────────────── */
say('-- ── ตั้งค่าระบบ (ตารางแถวเดียว) ─────────────────────────────────────────');
say('--  ยิ่งรุนแรงยิ่งต้องเสร็จเร็ว — critical ต้องแก้ให้จบภายในวันเดียว');
say(
  `INSERT OR IGNORE INTO app_settings (id, due_days_critical, due_days_major, due_days_minor, target_ontime_pct, company_name, plant_name) VALUES (` +
    `1, 1, 3, 7, 90, ${q('TENNECO')}, ${q('TENNECO')});`,
);
say();

writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(
  `เขียน ${outPath} แล้ว — พนักงาน ${PEOPLE.length} คน (QC ${qcCount} · VSM ${vsmCount} · เข้าระบบได้ ${loginCount}) · ` +
    `จุดตรวจ ${VSM_LINES.length * (1 + STATIONS.length) + SUPPORT_AREAS.length} จุด · ประเภท ${CATEGORIES.length} รายการ`,
);
