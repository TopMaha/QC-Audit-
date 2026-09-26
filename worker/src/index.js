/**
 * QC Audit Line — Cloudflare Worker API
 *
 * ใช้ Hono เป็น router เพราะมีหลายสิบเส้นทางพร้อม path param, preflight และ middleware
 * ถ้าเขียน routing เองจะกลายเป็น regex ยาวเหยียดที่พังง่ายเวลาเพิ่มเส้นทาง
 * Hono กินพื้นที่ราว 14 kB ไม่มี dependency ต่อ และเป็นตัวมาตรฐานของ Workers
 *
 * กติกาที่ยึดทั้งไฟล์
 *   - ตอบ JSON รูปแบบเดียวเสมอ  { ok: true, data } / { ok: false, error }
 *   - ใช้ prepared statement + bind() ทุกที่ ห้ามต่อสตริงค่าลง SQL เด็ดขาด
 *   - ตรวจ input ให้ครบก่อนแตะฐานข้อมูล ผิดตรงไหนบอกชื่อฟิลด์นั้น
 *   - การเขียนที่แตะหลายตารางใช้ batch() เพื่อให้สำเร็จหรือล้มเหลวพร้อมกัน
 *   - ตัวเลขสรุปทุกตัวคำนวณที่นี่ ไม่รับจาก client
 *   - สถานะของใบแจ้งถูกเปลี่ยนโดย endpoint เฉพาะทางเท่านั้น (ack/fix/verify/cancel)
 *     ไม่เปิดให้ PUT ตรง ๆ เพราะลำดับสถานะคือกติกาของระบบ ไม่ใช่ค่าที่ client เลือกเอง
 */

import { Hono } from 'hono';

import {
  ACTIVE_STATUSES, BadInput, ISSUE_STATUSES, ROLES, SEVERITIES, SHIFTS, VSM_LINES,
  addDays, bool, diffDays, fail, hhmm, int, isoDate, normalizeCode, normalizedSql, nowStamp, ok,
  oneOf, qDate, qInt, readJson, str, strArray, todayBangkok, uid, vsmLine,
} from './lib/http.js';
import {
  FIX_SELECT, ISSUE_SELECT,
  mapArea, mapCategory, mapChange, mapEmployee, mapFix, mapIssue, mapLogin, mapRound, mapSettings,
} from './lib/rows.js';
import { diffStmts, entryStmt } from './lib/audit.js';
import { buildCsv, buildSummary } from './lib/dashboard.js';
import { lineRecipients, notify, pushConfigured } from './lib/push.js';
import {
  LOCK_MINUTES, MAX_FAILS, SESSION_DAYS, addMinutes, hashPin, randomToken, sameHex, sha256, weakPinReason,
} from './lib/auth.js';

const app = new Hono();

/**
 * งานเบื้องหลังหลังตอบผู้ใช้ไปแล้ว (เช่น ส่งการแจ้งเตือน) — ผู้ใช้ไม่ต้องรอ
 * และถ้างานนั้นล้ม ก็ไม่กระทบสิ่งที่บันทึกไปแล้ว
 */
function later(c, promise) {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // ไม่มี execution context (เช่นตอนทดสอบ) — ปล่อยให้วิ่งไปเอง
    void promise;
  }
}

/** ข้อความสั้น ๆ สำหรับการแจ้งเตือน — ตัดบรรทัดใหม่และความยาวส่วนเกิน */
const clip = (s, n = 120) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * id ที่ client สร้างไว้ก่อน (โหมด offline) — ถ้าส่งมาให้ใช้ค่านั้น
 * เพื่อให้ id ในเครื่องกับบนเซิร์ฟเวอร์ตรงกัน เส้นทางอย่าง /issues/:id จึงไม่พัง
 * และการส่งซ้ำจากคิวจะชนคีย์ซ้ำ ซึ่งเราถือว่า "ซิงก์ไปแล้ว" ไม่ใช่ข้อผิดพลาด
 */
function clientId(b, prefix) {
  if (b.id === undefined || b.id === null || b.id === '') return uid(prefix);
  if (typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(b.id)) {
    throw new BadInput('id', 'ต้องเป็นตัวอักษร ตัวเลข ขีดกลาง หรือขีดล่าง ไม่เกิน 60 ตัว');
  }
  return b.id;
}

/** สร้างซ้ำด้วย id เดิม = คิวส่งซ้ำ ให้ถือว่าสำเร็จและคืนของเดิมกลับไป */
function isDuplicate(e) {
  return String(e?.message ?? e).includes('UNIQUE');
}

/**
 * ออกเลขที่เอกสารประจำวัน เช่น QC-260829-003
 *
 * เลขที่ออกจากที่นี่คือเลขทางการ ทับเลขชั่วคราวที่เครื่องผู้ใช้สร้างไว้ตอนออฟไลน์
 * (ดู docNo() ใน src/lib/api.ts) เพราะเครื่องแต่ละเครื่องนับของตัวเองจึงชนกันได้
 * ส่วน id ยังใช้ของ client เหมือนเดิม ลิงก์ที่แชร์กันไว้จึงไม่พัง
 */
async function nextDocNo(db, table, dateCol, date, prefix) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${dateCol} = ?`)
    .bind(date)
    .first();
  const ymd = date.slice(2).replace(/-/g, '');
  return `${prefix}-${ymd}-${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
}

/**
 * บริบทการผลิตที่ติดมากับทั้งรอบตรวจและใบแจ้ง (กะ · เครื่องจักร · รุ่นสินค้า · ผู้ปฏิบัติงาน)
 *
 * ไม่บังคับกรอกสักช่อง — ของที่ QC กรอกไม่ได้ตอนเดินตรวจต้องไม่ขวางการบันทึกงาน
 * ส่ง base มาเมื่อเป็นการแก้ไข เพื่อคงค่าเดิมของช่องที่ผู้เรียกไม่ได้ส่งมาด้วย
 */
function readContext(b, base = null) {
  const keep = (k, fn) => (k in b || !base ? fn() : base[k]);
  return {
    shift: keep('shift', () => oneOf(b, 'shift', SHIFTS, { required: false, fallback: null })),
    machine_no: keep('machine_no', () => str(b, 'machine_no', { required: false, max: 60 })),
    model_no: keep('model_no', () => str(b, 'model_no', { required: false, max: 60 })),
    operator_id: keep('operator_id', () => str(b, 'operator_id', { required: false, max: 60, fallback: null })),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   CORS — อนุญาตเฉพาะ origin ที่ระบุใน env เท่านั้น
   ALLOWED_ORIGIN ใส่ได้หลายค่าโดยคั่นด้วยจุลภาค
   ══════════════════════════════════════════════════════════════════════════ */

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const list = allowedOrigins(c.env);
  const allow = origin && list.includes(origin);

  // ตอบ preflight ให้จบตรงนี้ ไม่ต้องวิ่งต่อไปที่ route
  if (c.req.method === 'OPTIONS') {
    if (!allow) return c.body(null, 403);
    return c.body(null, 204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-Session',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  }

  await next();

  if (allow) {
    c.res.headers.set('Access-Control-Allow-Origin', origin);
    c.res.headers.set('Vary', 'Origin');
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Auth — สองชั้น
   X-Auth-Token  โทเคนร่วมของแอป — อยู่ในไฟล์เว็บ ใครเปิดเว็บก็อ่านได้ จึงกันได้แค่คนที่ยิงมาจากที่อื่น
   X-Session     โทเคนเซสชันรายคน ได้มาหลังกรอก PIN ถูก — ตัวนี้คือการยืนยันตัวตนจริง

   ทุกเส้นทางยกเว้น health และการเข้าสู่ระบบต้องมีเซสชัน ไม่มี = 401
   (เดิมเชื่อรหัสพนักงานที่เครื่องบอกมาเอง และการไม่ส่งรหัสเลยถือเป็นผู้ดูแลระบบ
    ใครได้โทเคนร่วมไปก็สวมรอยเป็นใครก็ได้ หรือได้สิทธิ์ผู้ดูแลระบบไปเลย)
   ══════════════════════════════════════════════════════════════════════════ */

/** เทียบสตริงแบบใช้เวลาคงที่ กันการเดาโทเคนจากเวลาตอบกลับ */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** เส้นทางที่เรียกได้ก่อนเข้าสู่ระบบ (ยังต้องมีโทเคนร่วม) */
const SIGN_IN_PATHS = new Set(['/api/auth/login', '/api/auth/admin']);

const sessionExpiry = (from = Date.now()) => new Date(from + SESSION_DAYS * 86_400_000).toISOString();

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next();

  const expected = c.env.AUTH_TOKEN;
  if (!expected) {
    return fail(c, 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า AUTH_TOKEN — รัน wrangler secret put AUTH_TOKEN ก่อน', 500);
  }
  if (!safeEqual(c.req.header('X-Auth-Token') ?? '', expected)) {
    return fail(c, 'ไม่ได้รับอนุญาต — โทเคนไม่ถูกต้องหรือไม่ได้ส่งมา', 401);
  }
  if (SIGN_IN_PATHS.has(c.req.path)) return next();

  const token = c.req.header('X-Session');
  if (!token) return fail(c, 'กรุณาเข้าสู่ระบบ', 401);

  const s = await c.env.DB.prepare(
    `SELECT s.token_hash, s.kind, s.last_seen_at, s.expires_at,
            e.id, e.full_name, e.role, e.vsm_line, e.is_active, e.can_login,
            EXISTS (SELECT 1 FROM superusers su
                     WHERE ${normalizedSql('su.admin_code')} = ${normalizedSql('e.emp_code')}) AS superuser
       FROM sessions s JOIN employees e ON e.id = s.employee_id
      WHERE s.token_hash = ?`,
  )
    .bind(await sha256(token))
    .first();

  const now = nowStamp();
  // ใช้ไม่ได้เมื่อหมดอายุ หรือเจ้าของถูกปิดบัญชี/ถอนสิทธิ์/ถอดจากผู้ดูแลระบบ — มีผลทันทีในคำขอถัดไป
  if (
    !s || s.expires_at < now || s.is_active !== 1 || s.can_login !== 1 ||
    (s.kind === 'admin' && s.superuser !== 1)
  ) {
    return fail(c, 'เซสชันหมดอายุหรือถูกยกเลิก — กรุณาเข้าสู่ระบบใหม่', 401);
  }

  if (s.kind === 'admin') c.set('admin', { id: s.id, name: s.full_name });
  else c.set('actor', { id: s.id, name: s.full_name, role: s.role, vsm_line: s.vsm_line, superuser: s.superuser === 1 });
  c.set('sessionHash', s.token_hash);

  // ต่ออายุเซสชันที่ยังใช้อยู่ — เขียนอย่างมากชั่วโมงละครั้ง ไม่ใช่ทุกคำขอ
  if (Date.parse(now) - Date.parse(s.last_seen_at) > 3_600_000) {
    later(
      c,
      c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`)
        .bind(now, sessionExpiry(), s.token_hash)
        .run(),
    );
  }
  return next();
});

/** ชื่อผู้ทำรายการที่ลงในประวัติการแก้ไข */
const actorName = (c) => c.get('actor')?.name ?? (c.get('admin') ? `${c.get('admin').name} (ผู้ดูแลระบบ)` : 'ผู้ดูแลระบบ');
/** พนักงานที่ทำรายการ — null เมื่อเป็นเซสชันผู้ดูแลระบบ (ทำแทนได้ทุกอย่าง) */
const actor = (c) => c.get('actor') ?? null;
/** เข้าผ่าน /admin — ทำได้ทุกอย่าง */
const isAdminCall = (c) => Boolean(c.get('admin'));

/**
 * ผู้ดูแลระบบ — เข้าจาก /admin หรือล็อกอินเป็นพนักงานที่อยู่ในทะเบียนผู้ดูแลระบบ
 * ตรงกับ superuser ใน useSession() ของหน้าจอ
 */
async function isSuperuserCall(c) {
  return isAdminCall(c) || Boolean(actor(c)?.superuser);
}

/**
 * ผู้ทำรายการลงมือกับใบของสายนี้ได้ไหม (รับทราบ · เริ่มแก้ไข · ส่งงานแก้ไข)
 *   - VSM ที่สังกัดสายนั้น
 *   - หัวหน้าสายที่ผู้ดูแลระบบกำหนดไว้ (ตาราง line_heads) — แผนกจะเป็นอะไรก็ได้
 *   - เซสชันผู้ดูแลระบบ (/admin)
 */
async function canWorkLine(c, line) {
  const me = actor(c);
  if (!me) return true;
  if (me.role === 'vsm' && me.vsm_line === line) return true;
  const head = await c.env.DB.prepare(`SELECT 1 FROM line_heads WHERE vsm_line = ? AND employee_id = ?`)
    .bind(line, me.id)
    .first();
  return Boolean(head);
}

/* ══════════════════════════════════════════════════════════════════════════
   ตัวจับข้อผิดพลาดกลาง
   ══════════════════════════════════════════════════════════════════════════ */

app.onError((err, c) => {
  if (err instanceof BadInput) return fail(c, err.message, 400);

  // แปลข้อความจากฐานข้อมูลให้เป็นภาษาที่ผู้ใช้เข้าใจ
  const msg = String(err?.message ?? err);
  if (msg.includes('FOREIGN KEY')) {
    return fail(c, 'อ้างถึงข้อมูลที่ไม่มีอยู่จริง หรือมีข้อมูลอื่นผูกอยู่จนลบไม่ได้', 409);
  }
  if (msg.includes('UNIQUE')) return fail(c, 'มีข้อมูลนี้อยู่แล้ว (รหัสซ้ำ)', 409);
  if (msg.includes('CHECK constraint')) return fail(c, 'ค่าที่ส่งมาไม่อยู่ในชุดที่ระบบอนุญาต', 400);

  console.error('unhandled', msg);
  return fail(c, 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์', 500);
});

app.notFound((c) => fail(c, `ไม่พบเส้นทาง ${c.req.method} ${c.req.path}`, 404));

/* ══════════════════════════════════════════════════════════════════════════
   สุขภาพระบบ (ไม่ต้องใช้โทเคน)
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/health', async (c) => {
  let db = 'ok';
  try {
    await c.env.DB.prepare('SELECT 1').first();
  } catch {
    db = 'error';
  }
  return ok(c, { status: 'ok', db, time: nowStamp(), today_bangkok: todayBangkok() });
});

/* ══════════════════════════════════════════════════════════════════════════
   เข้าสู่ระบบ — รหัสพนักงาน + PIN 6 หลัก
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * เข้าสู่ระบบ (พนักงาน หรือผู้ดูแลระบบผ่าน /admin — ใช้ PIN เดียวกันของคนคนนั้น)
 *
 *   ยังไม่เคยตั้ง PIN → ตอบ pin_setup ให้หน้าจอขอ PIN ใหม่ แล้วส่งกลับมาใน new_pin
 *   กรอกผิดติดกัน MAX_FAILS ครั้ง → ล็อก LOCK_MINUTES นาที
 *
 * เข้าไม่ได้ตอบ 200 พร้อม { error } (ไม่ใช่ 4xx) ให้หน้าจอเลือกข้อความเองได้
 * รหัสที่ไม่มีในระบบกับ PIN ผิดตอบ "invalid" เหมือนกัน ไม่บอกว่าผิดตรงไหน
 */
async function signIn(c, kind) {
  const b = await readJson(c);
  const code = str(b, 'code', { max: 40 });
  const pin = typeof b.pin === 'string' ? b.pin : '';
  const newPin = typeof b.new_pin === 'string' ? b.new_pin : '';
  if (!c.env.PIN_PEPPER) return fail(c, 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า PIN_PEPPER — รัน wrangler secret put PIN_PEPPER ก่อน', 500);

  const DB = c.env.DB;
  const e = await DB.prepare(`SELECT * FROM employees WHERE ${normalizedSql('emp_code')} = ?`)
    .bind(normalizeCode(code))
    .first();
  const su = kind === 'admin'
    ? await DB.prepare(`SELECT * FROM superusers WHERE ${normalizedSql('admin_code')} = ?`).bind(normalizeCode(code)).first()
    : null;

  const log = (result) =>
    DB.prepare(
      `INSERT INTO login_history (id, actor_id, actor_name, role, at, result) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(uid('log'), e?.id ?? '-', e?.full_name ?? code, kind === 'admin' ? 'admin' : 'employee', nowStamp(), result)
      .run();
  const deny = async (error, extra = {}) => {
    await log('failed');
    return ok(c, { error, ...extra });
  };

  if (!e || (kind === 'admin' && !su)) return deny('invalid');
  if (e.is_active !== 1) return deny('inactive');
  if (e.can_login !== 1) return deny('no_access');

  const rec = await DB.prepare(`SELECT * FROM employee_pins WHERE employee_id = ?`).bind(e.id).first();
  const now = nowStamp();

  if (!rec) {
    // เข้าครั้งแรก — ยังไม่ใช่ความพยายามที่ผิด จึงไม่ลงบันทึกว่าล้มเหลว
    if (!newPin) return ok(c, { error: 'pin_setup' });
    const reason = weakPinReason(newPin);
    if (reason) return ok(c, { error: 'weak_pin', message: reason });
    const salt = randomToken(16);
    try {
      await DB.batch([
        DB.prepare(
          `INSERT INTO employee_pins (employee_id, pin_hash, pin_salt, failed_count, locked_until, updated_at)
           VALUES (?, ?, ?, 0, NULL, ?)`,
        ).bind(e.id, await hashPin(c.env, e.id, salt, newPin), salt, now),
        entryStmt(DB, {
          table: 'employees', recordId: e.id, action: 'update', field: 'pin',
          oldV: null, newV: 'ตั้ง PIN', actor: e.full_name,
        }),
      ]);
    } catch (err) {
      // มีอีกเครื่องตั้ง PIN ให้บัญชีนี้ไปพร้อมกัน — ให้ลองเข้าด้วย PIN ตามปกติ
      if (isDuplicate(err)) return deny('invalid');
      throw err;
    }
  } else {
    if (rec.locked_until && rec.locked_until > now) return deny('locked', { locked_until: rec.locked_until });
    if (!pin) return ok(c, { error: 'pin_required' });
    const good = sameHex(await hashPin(c.env, e.id, rec.pin_salt, pin), rec.pin_hash);
    if (!good) {
      const fails = rec.failed_count + 1;
      const lock = fails >= MAX_FAILS ? addMinutes(now, LOCK_MINUTES) : null;
      await DB.prepare(`UPDATE employee_pins SET failed_count = ?, locked_until = ? WHERE employee_id = ?`)
        .bind(lock ? 0 : fails, lock, e.id)
        .run();
      return lock ? deny('locked', { locked_until: lock }) : deny('invalid', { attempts_left: MAX_FAILS - fails });
    }
    if (rec.failed_count || rec.locked_until) {
      await DB.prepare(`UPDATE employee_pins SET failed_count = 0, locked_until = NULL WHERE employee_id = ?`)
        .bind(e.id)
        .run();
    }
  }

  const token = randomToken();
  await DB.prepare(
    `INSERT INTO sessions (token_hash, employee_id, kind, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(token), e.id, kind, now, now, sessionExpiry())
    .run();
  await log('success');

  if (kind === 'admin') {
    return ok(c, { token, admin: { id: su.id, admin_code: su.admin_code, full_name: su.full_name } });
  }
  const isSu = await DB.prepare(`SELECT 1 FROM superusers WHERE ${normalizedSql('admin_code')} = ?`)
    .bind(normalizeCode(e.emp_code))
    .first();
  return ok(c, { token, employee: mapEmployee(e), superuser: Boolean(isSu) });
}

app.post('/api/auth/login', (c) => signIn(c, 'employee'));
app.post('/api/auth/admin', (c) => signIn(c, 'admin'));

/** ออกจากระบบ — ลบเซสชันนี้ทิ้งที่เซิร์ฟเวอร์ด้วย โทเคนที่หลุดไปจะใช้ต่อไม่ได้ */
app.post('/api/auth/logout', async (c) => {
  await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(c.get('sessionHash')).run();
  return ok(c, { signed_out: true });
});

/**
 * ผู้ดูแลระบบล้าง PIN (ลืม PIN หรือสงสัยว่ามีคนตั้งแทน)
 * เซสชันทุกเครื่องของคนนั้นถูกตัดทันที แล้วเจ้าตัวตั้ง PIN ใหม่ได้ตอนเข้าครั้งถัดไป
 */
app.post('/api/employees/:id/reset-pin', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'ล้าง PIN ได้เฉพาะผู้ดูแลระบบ', 403);
  const id = c.req.param('id');
  const e = await c.env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(id).first();
  if (!e) return fail(c, 'ไม่พบพนักงานรายนี้', 404);

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM employee_pins WHERE employee_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE employee_id = ?`).bind(id),
    // ถ้าสงสัยว่ามีคนตั้ง PIN แทน เครื่องของคนนั้นต้องเลิกได้รับงานเด้งของเจ้าตัวด้วย
    c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE employee_id = ?`).bind(id),
    entryStmt(c.env.DB, {
      table: 'employees', recordId: id, action: 'update', field: 'pin',
      oldV: null, newV: 'ล้าง PIN', actor: actorName(c),
    }),
  ]);
  return ok(c, { reset: true });
});

app.get('/api/login-history', async (c) => {
  const limit = qInt(c, 'limit', 100, { min: 1, max: 500 });
  const { results } = await c.env.DB.prepare(`SELECT * FROM login_history ORDER BY at DESC LIMIT ?`)
    .bind(limit)
    .all();
  return ok(c, results.map(mapLogin));
});

/* ══════════════════════════════════════════════════════════════════════════
   พนักงาน
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/employees', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, EXISTS (SELECT 1 FROM employee_pins p WHERE p.employee_id = e.id) AS has_pin
       FROM employees e ORDER BY e.emp_code`,
  ).all();
  return ok(c, results.map(mapEmployee));
});

app.get('/api/employees/:id', async (c) => {
  const m = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first();
  return m ? ok(c, mapEmployee(m)) : fail(c, 'ไม่พบพนักงานรายนี้', 404);
});

/** บทบาท VSM ที่ไม่ผูกสายจะไม่มีงานเข้ากล่องเลย ปฏิเสธตั้งแต่ตอนบันทึกดีกว่า */
function requireLineForVsm(role, line) {
  if (role === 'vsm' && !line) {
    throw new BadInput('vsm_line', 'บทบาท VSM ต้องระบุสายที่รับผิดชอบ');
  }
  // บทบาทอื่นไม่ควรมีสายค้างอยู่ เพราะจะทำให้ตัวกรองงานเข้าเพี้ยน
  return role === 'vsm' ? line : null;
}

app.post('/api/employees', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'แก้ไขข้อมูลหลักได้เฉพาะผู้ดูแลระบบ', 403);
  const b = await readJson(c);
  const role = oneOf(b, 'role', ROLES, { required: false, fallback: 'viewer' });
  const row = {
    id: uid('emp'),
    emp_code: str(b, 'emp_code', { max: 40 }),
    full_name: str(b, 'full_name', { max: 200 }),
    full_name_en: str(b, 'full_name_en', { required: false, max: 200, fallback: null }),
    department: str(b, 'department', { required: false, max: 100 }),
    position: str(b, 'position', { required: false, max: 100, fallback: null }),
    avatar_url: str(b, 'avatar_url', { required: false, max: 1000, fallback: null }),
    role,
    vsm_line: requireLineForVsm(role, vsmLine(b, 'vsm_line', { required: false })),
    is_active: bool(b, 'is_active', { fallback: true }) ? 1 : 0,
    dashboard_enabled: bool(b, 'dashboard_enabled', { fallback: true }) ? 1 : 0,
    // คนที่เพิ่มใหม่ยังล็อกอินไม่ได้จนกว่าผู้ดูแลระบบจะเปิดสิทธิ์ให้
    can_login: bool(b, 'can_login', { fallback: false }) ? 1 : 0,
    created_at: nowStamp(),
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO employees (id, emp_code, full_name, full_name_en, department, position,
                              avatar_url, role, vsm_line, is_active, dashboard_enabled, can_login, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id, row.emp_code, row.full_name, row.full_name_en, row.department, row.position,
      row.avatar_url, row.role, row.vsm_line, row.is_active, row.dashboard_enabled, row.can_login, row.created_at,
    ),
    entryStmt(c.env.DB, {
      table: 'employees', recordId: row.id, action: 'create', newV: row.full_name, actor: actorName(c),
    }),
  ]);

  const saved = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(row.id).first();
  return ok(c, mapEmployee(saved), 201);
});

app.put('/api/employees/:id', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'แก้ไขข้อมูลหลักได้เฉพาะผู้ดูแลระบบ', 403);
  const id = c.req.param('id');
  const b = await readJson(c);
  const before = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
  if (!before) return fail(c, 'ไม่พบพนักงานรายนี้', 404);

  const role = 'role' in b ? oneOf(b, 'role', ROLES) : before.role;
  const line = 'vsm_line' in b ? vsmLine(b, 'vsm_line', { required: false }) : before.vsm_line;

  const next = {
    emp_code: 'emp_code' in b ? str(b, 'emp_code', { max: 40 }) : before.emp_code,
    full_name: 'full_name' in b ? str(b, 'full_name', { max: 200 }) : before.full_name,
    full_name_en: 'full_name_en' in b ? str(b, 'full_name_en', { required: false, max: 200, fallback: null }) : before.full_name_en,
    department: 'department' in b ? str(b, 'department', { required: false, max: 100 }) : before.department,
    position: 'position' in b ? str(b, 'position', { required: false, max: 100, fallback: null }) : before.position,
    avatar_url: 'avatar_url' in b ? str(b, 'avatar_url', { required: false, max: 1000, fallback: null }) : before.avatar_url,
    role,
    vsm_line: requireLineForVsm(role, line),
    is_active: 'is_active' in b ? (bool(b, 'is_active') ? 1 : 0) : before.is_active,
    dashboard_enabled: 'dashboard_enabled' in b ? (bool(b, 'dashboard_enabled') ? 1 : 0) : before.dashboard_enabled,
    can_login: 'can_login' in b ? (bool(b, 'can_login') ? 1 : 0) : before.can_login,
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE employees SET emp_code = ?, full_name = ?, full_name_en = ?, department = ?,
                            position = ?, avatar_url = ?, role = ?, vsm_line = ?,
                            is_active = ?, dashboard_enabled = ?, can_login = ?
        WHERE id = ?`,
    ).bind(
      next.emp_code, next.full_name, next.full_name_en, next.department, next.position, next.avatar_url,
      next.role, next.vsm_line, next.is_active, next.dashboard_enabled, next.can_login, id,
    ),
    ...diffStmts(c.env.DB, { table: 'employees', recordId: id, before, after: next, actor: actorName(c) }),
  ]);

  const saved = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
  return ok(c, mapEmployee(saved));
});

/* ══════════════════════════════════════════════════════════════════════════
   จุดตรวจ
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/areas', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM areas ORDER BY id`).all();
  return ok(c, results.map(mapArea));
});

app.post('/api/areas', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'แก้ไขข้อมูลหลักได้เฉพาะผู้ดูแลระบบ', 403);
  const b = await readJson(c);
  const row = {
    id: uid('ar'),
    area_name: str(b, 'area_name', { max: 200 }),
    area_name_en: str(b, 'area_name_en', { required: false, max: 200, fallback: null }),
    parent_id: str(b, 'parent_id', { required: false, max: 60, fallback: null }),
    vsm_line: vsmLine(b, 'vsm_line', { required: false }),
    is_active: bool(b, 'is_active', { fallback: true }) ? 1 : 0,
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO areas (id, area_name, area_name_en, parent_id, vsm_line, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(row.id, row.area_name, row.area_name_en, row.parent_id, row.vsm_line, row.is_active),
    entryStmt(c.env.DB, {
      table: 'areas', recordId: row.id, action: 'create', newV: row.area_name, actor: actorName(c),
    }),
  ]);

  const saved = await c.env.DB.prepare(`SELECT * FROM areas WHERE id = ?`).bind(row.id).first();
  return ok(c, mapArea(saved), 201);
});

app.put('/api/areas/:id', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'แก้ไขข้อมูลหลักได้เฉพาะผู้ดูแลระบบ', 403);
  const id = c.req.param('id');
  const b = await readJson(c);
  const before = await c.env.DB.prepare(`SELECT * FROM areas WHERE id = ?`).bind(id).first();
  if (!before) return fail(c, 'ไม่พบจุดตรวจนี้', 404);

  const next = {
    area_name: 'area_name' in b ? str(b, 'area_name', { max: 200 }) : before.area_name,
    area_name_en: 'area_name_en' in b ? str(b, 'area_name_en', { required: false, max: 200, fallback: null }) : before.area_name_en,
    parent_id: 'parent_id' in b ? str(b, 'parent_id', { required: false, max: 60, fallback: null }) : before.parent_id,
    vsm_line: 'vsm_line' in b ? vsmLine(b, 'vsm_line', { required: false }) : before.vsm_line,
    is_active: 'is_active' in b ? (bool(b, 'is_active') ? 1 : 0) : before.is_active,
  };

  if (next.parent_id === id) return fail(c, 'จุดตรวจเป็นแม่ของตัวเองไม่ได้', 400);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE areas SET area_name = ?, area_name_en = ?, parent_id = ?, vsm_line = ?, is_active = ?
        WHERE id = ?`,
    ).bind(next.area_name, next.area_name_en, next.parent_id, next.vsm_line, next.is_active, id),
    ...diffStmts(c.env.DB, { table: 'areas', recordId: id, before, after: next, actor: actorName(c) }),
  ]);

  const saved = await c.env.DB.prepare(`SELECT * FROM areas WHERE id = ?`).bind(id).first();
  return ok(c, mapArea(saved));
});

/* ══════════════════════════════════════════════════════════════════════════
   ประเภทข้อบกพร่อง
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/categories', async (c) => {
  const activeOnly = c.req.query('active') === '1';
  const sql = activeOnly
    ? `SELECT * FROM defect_categories WHERE is_active = 1 ORDER BY id`
    : `SELECT * FROM defect_categories ORDER BY id`;
  const { results } = await c.env.DB.prepare(sql).all();
  return ok(c, results.map(mapCategory));
});

app.post('/api/categories', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'แก้ไขข้อมูลหลักได้เฉพาะผู้ดูแลระบบ', 403);
  const b = await readJson(c);
  const row = {
    id: uid('cat'),
    category_name: str(b, 'category_name', { max: 200 }),
    category_name_en: str(b, 'category_name_en', { required: false, max: 200, fallback: null }),
    is_active: bool(b, 'is_active', { fallback: true }) ? 1 : 0,
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO defect_categories (id, category_name, category_name_en, is_active) VALUES (?, ?, ?, ?)`,
    ).bind(row.id, row.category_name, row.category_name_en, row.is_active),
    entryStmt(c.env.DB, {
      table: 'defect_categories', recordId: row.id, action: 'create',
      newV: row.category_name, actor: actorName(c),
    }),
  ]);

  const saved = await c.env.DB.prepare(`SELECT * FROM defect_categories WHERE id = ?`).bind(row.id).first();
  return ok(c, mapCategory(saved), 201);
});

app.put('/api/categories/:id', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'แก้ไขข้อมูลหลักได้เฉพาะผู้ดูแลระบบ', 403);
  const id = c.req.param('id');
  const b = await readJson(c);
  const before = await c.env.DB.prepare(`SELECT * FROM defect_categories WHERE id = ?`).bind(id).first();
  if (!before) return fail(c, 'ไม่พบประเภทนี้', 404);

  const next = {
    category_name: 'category_name' in b ? str(b, 'category_name', { max: 200 }) : before.category_name,
    category_name_en: 'category_name_en' in b ? str(b, 'category_name_en', { required: false, max: 200, fallback: null }) : before.category_name_en,
    is_active: 'is_active' in b ? (bool(b, 'is_active') ? 1 : 0) : before.is_active,
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE defect_categories SET category_name = ?, category_name_en = ?, is_active = ? WHERE id = ?`,
    ).bind(next.category_name, next.category_name_en, next.is_active, id),
    ...diffStmts(c.env.DB, { table: 'defect_categories', recordId: id, before, after: next, actor: actorName(c) }),
  ]);

  const saved = await c.env.DB.prepare(`SELECT * FROM defect_categories WHERE id = ?`).bind(id).first();
  return ok(c, mapCategory(saved));
});

/* ══════════════════════════════════════════════════════════════════════════
   ตั้งค่าระบบ
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/settings', async (c) => {
  const s = await c.env.DB.prepare(`SELECT * FROM app_settings WHERE id = 1`).first();
  if (!s) return fail(c, 'ยังไม่มีข้อมูลตั้งค่า — รัน seed.sql ก่อน', 404);
  return ok(c, mapSettings(s));
});

app.put('/api/settings', async (c) => {
  if (!(await isSuperuserCall(c))) return fail(c, 'แก้ไขข้อมูลหลักได้เฉพาะผู้ดูแลระบบ', 403);
  const b = await readJson(c);
  const before = await c.env.DB.prepare(`SELECT * FROM app_settings WHERE id = 1`).first();
  if (!before) return fail(c, 'ยังไม่มีข้อมูลตั้งค่า — รัน seed.sql ก่อน', 404);

  const next = {
    due_days_critical: 'due_days_critical' in b ? int(b, 'due_days_critical', { min: 0, max: 365 }) : before.due_days_critical,
    due_days_major: 'due_days_major' in b ? int(b, 'due_days_major', { min: 0, max: 365 }) : before.due_days_major,
    due_days_minor: 'due_days_minor' in b ? int(b, 'due_days_minor', { min: 0, max: 365 }) : before.due_days_minor,
    target_ontime_pct: 'target_ontime_pct' in b ? int(b, 'target_ontime_pct', { min: 0, max: 100 }) : before.target_ontime_pct,
    company_name: 'company_name' in b ? str(b, 'company_name', { required: false, max: 200 }) : before.company_name,
    plant_name: 'plant_name' in b ? str(b, 'plant_name', { required: false, max: 200 }) : before.plant_name,
  };

  await c.env.DB.prepare(
    `UPDATE app_settings SET due_days_critical = ?, due_days_major = ?, due_days_minor = ?,
                             target_ontime_pct = ?, company_name = ?, plant_name = ?
      WHERE id = 1`,
  )
    .bind(
      next.due_days_critical, next.due_days_major, next.due_days_minor,
      next.target_ontime_pct, next.company_name, next.plant_name,
    )
    .run();

  return ok(c, mapSettings({ ...before, ...next }));
});

/* ══════════════════════════════════════════════════════════════════════════
   รอบตรวจ
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/rounds', async (c) => {
  const where = [];
  const binds = [];

  const from = qDate(c, 'from');
  const to = qDate(c, 'to');
  if (from) { where.push('round_date >= ?'); binds.push(from); }
  if (to) { where.push('round_date <= ?'); binds.push(to); }

  const qcId = c.req.query('qc_id');
  if (qcId) { where.push('qc_id = ?'); binds.push(qcId); }

  const line = c.req.query('vsm_line');
  if (line) {
    if (!VSM_LINES.includes(line)) throw new BadInput('vsm_line', `ต้องเป็น ${VSM_LINES.join(', ')}`);
    where.push('vsm_line = ?');
    binds.push(line);
  }

  const result = c.req.query('result');
  if (result) {
    if (!['pass', 'ng'].includes(result)) throw new BadInput('result', 'ต้องเป็น pass หรือ ng');
    where.push('result = ?');
    binds.push(result);
  }

  const limit = qInt(c, 'limit', 1000, { min: 1, max: 5000 });
  const offset = qInt(c, 'offset', 0, { min: 0, max: 1000000 });

  const sql =
    `SELECT * FROM qc_rounds` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY round_date DESC, round_time DESC LIMIT ? OFFSET ?`;

  const { results } = await c.env.DB.prepare(sql).bind(...binds, limit, offset).all();
  return ok(c, results.map(mapRound));
});

/**
 * บันทึกรอบตรวจ พร้อมเปิดใบแจ้งในคำขอเดียวถ้าพบข้อบกพร่อง
 *
 * ที่ต้องรวมเป็นคำขอเดียวเพราะสองอย่างนี้แยกกันไม่ได้ในเชิงความหมาย
 * ถ้าแยกเป็นสองคำขอแล้วเน็ตหลุดคั่นกลาง จะเหลือรอบตรวจที่บอกว่า "พบข้อบกพร่อง"
 * แต่ไม่มีใบแจ้งให้ใครแก้ ซึ่งเป็นสภาพที่แย่กว่าไม่บันทึกอะไรเลย
 */
app.post('/api/rounds', async (c) => {
  const b = await readJson(c);
  const roundId = clientId(b, 'rnd');
  const roundDate = isoDate(b, 'round_date');
  const result = oneOf(b, 'result', ['pass', 'ng']);
  const who = actorName(c);

  const round = {
    id: roundId,
    round_no: await nextDocNo(c.env.DB, 'qc_rounds', 'round_date', roundDate, 'R'),
    qc_id: str(b, 'qc_id', { max: 60 }),
    round_date: roundDate,
    round_time: hhmm(b, 'round_time'),
    area_id: str(b, 'area_id', { max: 60 }),
    vsm_line: vsmLine(b, 'vsm_line'),
    qty_checked: int(b, 'qty_checked', { required: false, min: 0, max: 1000000, fallback: 0 }),
    result,
    note: str(b, 'note', { required: false, max: 2000 }),
    ...readContext(b),
    created_at: nowStamp(),
  };

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO qc_rounds (id, round_no, qc_id, round_date, round_time, area_id, vsm_line,
                              qty_checked, result, note, shift, machine_no, model_no, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      round.id, round.round_no, round.qc_id, round.round_date, round.round_time, round.area_id,
      round.vsm_line, round.qty_checked, round.result, round.note,
      round.shift, round.machine_no, round.model_no, round.operator_id, round.created_at,
    ),
    entryStmt(c.env.DB, {
      table: 'qc_rounds', recordId: round.id, action: 'create', newV: round.round_no, actor: who,
    }),
  ];

  // ใบแจ้งที่แนบมากับรอบตรวจ — สืบทอดวันที่/เวลา/จุดตรวจ/สายจากรอบเสมอ
  // เพื่อไม่ให้เกิดใบแจ้งที่บอกว่าเกิดคนละที่กับรอบตรวจที่มันสังกัด
  let issueInput = null;
  if (b.issue) {
    if (result !== 'ng') return fail(c, 'แนบใบแจ้งได้เฉพาะรอบตรวจที่ผลเป็น ng', 400);
    issueInput = readIssueInput(
      { ...b.issue, qc_id: round.qc_id, found_date: round.round_date, found_time: round.round_time,
        area_id: round.area_id, vsm_line: round.vsm_line, qty_checked: round.qty_checked,
        // บริบทการผลิตสืบทอดจากรอบตรวจเสมอ ทับค่าที่ client อาจส่งมาในใบแจ้ง
        // ไม่งั้นจะเกิดใบแจ้งที่บอกว่าเกิดคนละกะกับรอบตรวจที่มันสังกัด
        shift: round.shift, machine_no: round.machine_no,
        model_no: round.model_no, operator_id: round.operator_id },
    );
    issueInput.id = clientId(b.issue, 'iss');
    issueInput.round_id = round.id;
    issueInput.issue_no = await nextDocNo(c.env.DB, 'qc_issues', 'found_date', round.round_date, 'QC');
    stmts.push(...issueStmts(c.env.DB, issueInput, who));
  } else if (result === 'ng') {
    return fail(c, 'รอบตรวจที่ผลเป็น ng ต้องแนบใบแจ้งมาด้วย', 400);
  }

  let fresh = true;
  try {
    await c.env.DB.batch(stmts);
  } catch (e) {
    // คิวออฟไลน์ส่งซ้ำด้วย id เดิม — ของอยู่ครบแล้ว ไม่ใช่ข้อผิดพลาด
    if (!isDuplicate(e)) throw e;
    fresh = false;
  }

  // ส่งซ้ำจากคิวต้องไม่เด้งซ้ำ — แจ้งเฉพาะครั้งแรกที่ใบเกิดขึ้นจริง
  if (fresh && issueInput) later(c, notifyNewIssue(c, issueInput));

  const savedRound = await c.env.DB.prepare(`SELECT * FROM qc_rounds WHERE id = ?`).bind(round.id).first();
  const savedIssue = issueInput
    ? await c.env.DB.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).bind(issueInput.id).first()
    : null;

  return ok(
    c,
    { round: mapRound(savedRound), issue: savedIssue ? mapIssue(savedIssue) : null },
    201,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   ใบแจ้งข้อบกพร่อง
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/issues', async (c) => {
  const where = [];
  const binds = [];

  const from = qDate(c, 'from');
  const to = qDate(c, 'to');
  if (from) { where.push('i.found_date >= ?'); binds.push(from); }
  if (to) { where.push('i.found_date <= ?'); binds.push(to); }

  const qcId = c.req.query('qc_id');
  if (qcId) { where.push('i.qc_id = ?'); binds.push(qcId); }

  const areaId = c.req.query('area_id');
  if (areaId) { where.push('i.area_id = ?'); binds.push(areaId); }

  const line = c.req.query('vsm_line');
  if (line) {
    if (!VSM_LINES.includes(line)) throw new BadInput('vsm_line', `ต้องเป็น ${VSM_LINES.join(', ')}`);
    where.push('i.vsm_line = ?');
    binds.push(line);
  }

  const status = c.req.query('status');
  if (status) {
    if (!ISSUE_STATUSES.includes(status)) {
      throw new BadInput('status', `ต้องเป็น ${ISSUE_STATUSES.join(', ')}`);
    }
    where.push('i.status = ?');
    binds.push(status);
  }

  const severity = c.req.query('severity');
  if (severity) {
    if (!SEVERITIES.includes(severity)) throw new BadInput('severity', `ต้องเป็น ${SEVERITIES.join(', ')}`);
    where.push('i.severity = ?');
    binds.push(severity);
  }

  // ?active=1 = เฉพาะที่ยังต้องทำอะไรต่อ · ?overdue=1 = เลยกำหนดแล้วเท่านั้น
  if (c.req.query('active') === '1') {
    where.push(`i.status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})`);
    binds.push(...ACTIVE_STATUSES);
  }
  if (c.req.query('overdue') === '1') {
    where.push(`i.status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')}) AND i.due_date < ?`);
    binds.push(...ACTIVE_STATUSES, todayBangkok());
  }

  const limit = qInt(c, 'limit', 1000, { min: 1, max: 5000 });
  const offset = qInt(c, 'offset', 0, { min: 0, max: 1000000 });

  const sql =
    ISSUE_SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY i.found_date DESC, i.found_time DESC LIMIT ? OFFSET ?`;

  const { results } = await c.env.DB.prepare(sql).bind(...binds, limit, offset).all();
  return ok(c, results.map(mapIssue));
});

app.get('/api/issues/:id', async (c) => {
  const id = c.req.param('id');
  const r = await c.env.DB.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).bind(id).first();
  if (!r) return fail(c, 'ไม่พบใบแจ้งนี้', 404);

  const [{ results: fixes }, { results: history }] = await Promise.all([
    c.env.DB.prepare(`${FIX_SELECT} WHERE f.issue_id = ? ORDER BY f.attempt`).bind(id).all(),
    c.env.DB.prepare(`SELECT * FROM change_history WHERE record_id = ? ORDER BY changed_at DESC`).bind(id).all(),
  ]);

  return ok(c, {
    ...mapIssue(r),
    fixes: fixes.map(mapFix),
    change_history: history.map(mapChange),
  });
});

/** อ่านและตรวจ payload ของใบแจ้ง ใช้ร่วมกันทั้งตอนสร้างและตอนแก้ */
function readIssueInput(b, base = null) {
  const has = (k) => k in b;
  const pick = (k, fn) => (has(k) || !base ? fn() : base[k]);

  return {
    qc_id: pick('qc_id', () => str(b, 'qc_id', { max: 60 })),
    found_date: pick('found_date', () => isoDate(b, 'found_date')),
    found_time: pick('found_time', () => hhmm(b, 'found_time')),
    area_id: pick('area_id', () => str(b, 'area_id', { max: 60 })),
    vsm_line: pick('vsm_line', () => vsmLine(b, 'vsm_line')),
    severity: pick('severity', () => oneOf(b, 'severity', SEVERITIES)),
    part_no: pick('part_no', () => str(b, 'part_no', { required: false, max: 100 })),
    lot_no: pick('lot_no', () => str(b, 'lot_no', { required: false, max: 100 })),
    qty_checked: pick('qty_checked', () => int(b, 'qty_checked', { required: false, min: 0, max: 1000000, fallback: 0 })),
    qty_defect: pick('qty_defect', () => int(b, 'qty_defect', { required: false, min: 0, max: 1000000, fallback: 0 })),
    description: pick('description', () => str(b, 'description', { max: 5000 })),
    due_date: pick('due_date', () => isoDate(b, 'due_date')),
    category_ids: pick('category_ids', () => strArray(b, 'category_ids', { required: true, maxItems: 3, maxLen: 60 })),
    photo_urls: pick('photo_urls', () => strArray(b, 'photo_urls', { required: true, maxItems: 20, maxLen: 300 })),
    // บันทึกเสียงไม่บังคับ — ส่ง null มาเพื่อลบเสียงเดิมทิ้งได้
    voice_url: pick('voice_url', () => str(b, 'voice_url', { required: false, max: 300, fallback: null })),
    ...readIssueContext(b, base),
  };
}

/**
 * บริบทการผลิตของใบแจ้ง — เหมือนของรอบตรวจ ยกเว้นหมายเลขเครื่องจักรที่บังคับกรอก
 *
 * VSM ต้องรู้ว่าเดินไปแก้ที่เครื่องไหน ไม่งั้นต้องโทรกลับมาถาม
 * ข้อบกพร่องที่ไม่เกี่ยวกับเครื่องจักร (คลัง/จุดรับเข้า) ให้กรอก "-"
 * ตอนแก้ใบที่มีอยู่แล้ว บังคับเฉพาะเมื่อผู้เรียกส่งช่องนี้มา เพื่อไม่ให้ใบเก่า
 * ที่ยังไม่มีหมายเลขเครื่องกดรับทราบหรือยกเลิกไม่ได้
 */
function readIssueContext(b, base) {
  const ctx = readContext(b, base);
  if ((!base || 'machine_no' in b) && !ctx.machine_no) {
    throw new BadInput('machine_no', 'ต้องระบุหมายเลขเครื่องจักร (ถ้าไม่เกี่ยวกับเครื่องจักรให้ใส่ -)');
  }
  return ctx;
}

/** ใบใหม่ → เด้งหาหัวหน้าสายและ VSM ของสายนั้น (ยกเว้นคนที่เปิดใบเอง) */
async function notifyNewIssue(c, issue) {
  const me = actor(c);
  const who = (await lineRecipients(c.env.DB, issue.vsm_line)).filter((id) => id !== me?.id);
  await notify(c.env, c.env.DB, who, {
    title: `ปัญหาใหม่จาก QC · ${issue.vsm_line}`,
    body: `${issue.issue_no} · เครื่อง ${issue.machine_no || '-'}\n${clip(issue.description)}`,
    url: `/issues/${issue.id}`,
    tag: issue.id,
  });
}

/** คำสั่งเขียนใบแจ้งใหม่ทั้งชุด (แถวหลัก + ประเภท + รูป + ประวัติ) */
function issueStmts(db, input, who) {
  return [
    db
      .prepare(
        `INSERT INTO qc_issues
           (id, issue_no, round_id, qc_id, found_date, found_time, area_id, vsm_line, severity,
            part_no, lot_no, qty_checked, qty_defect, description, due_date, status,
            shift, machine_no, model_no, operator_id, voice_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id, input.issue_no, input.round_id ?? null, input.qc_id, input.found_date, input.found_time,
        input.area_id, input.vsm_line, input.severity, input.part_no, input.lot_no,
        input.qty_checked, input.qty_defect, input.description, input.due_date,
        input.shift, input.machine_no, input.model_no, input.operator_id, input.voice_url,
        nowStamp(),
      ),
    ...input.category_ids.map((cid, i) =>
      db.prepare(`INSERT INTO issue_categories (issue_id, category_id, sort_order) VALUES (?, ?, ?)`)
        .bind(input.id, cid, i),
    ),
    ...input.photo_urls.map((key, i) =>
      db.prepare(`INSERT INTO issue_photos (id, issue_id, photo_key, sort_order) VALUES (?, ?, ?, ?)`)
        .bind(uid('ph'), input.id, key, i),
    ),
    entryStmt(db, {
      table: 'qc_issues', recordId: input.id, action: 'create', newV: input.issue_no, actor: who,
    }),
  ];
}

app.post('/api/issues', async (c) => {
  const b = await readJson(c);
  const input = readIssueInput(b);
  input.id = clientId(b, 'iss');
  input.round_id = str(b, 'round_id', { required: false, max: 60, fallback: null });
  input.issue_no = await nextDocNo(c.env.DB, 'qc_issues', 'found_date', input.found_date, 'QC');

  if (input.qty_checked > 0 && input.qty_defect > input.qty_checked) {
    return fail(c, 'จำนวนที่บกพร่องต้องไม่เกินจำนวนที่สุ่มตรวจ', 400);
  }

  try {
    await c.env.DB.batch(issueStmts(c.env.DB, input, actorName(c)));
    later(c, notifyNewIssue(c, input));
  } catch (e) {
    if (!isDuplicate(e)) throw e;
  }

  const saved = await c.env.DB.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).bind(input.id).first();
  return ok(c, mapIssue(saved), 201);
});

/**
 * แก้รายละเอียดใบแจ้ง
 *
 * สถานะเปลี่ยนได้ทางนี้เฉพาะสองกรณีที่ไม่มี endpoint เฉพาะทาง
 *   in_progress — VSM กดรับเรื่อง (ตัวซิงก์ส่ง acked_at มาด้วย)
 *   cancelled   — QC/ผู้ดูแลระบบยกเลิกใบที่บันทึกผิดหรือซ้ำ
 * สถานะที่เหลือ (fixed/rejected/verified) เปลี่ยนผ่าน endpoint ของงานแก้ไขเท่านั้น
 * เพื่อไม่ให้ใบถูกปิดโดยไม่มีหลักฐานการแก้ไขแนบอยู่
 */
app.put('/api/issues/:id', async (c) => {
  const id = c.req.param('id');
  const b = await readJson(c);
  const beforeRow = await c.env.DB.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).bind(id).first();
  if (!beforeRow) return fail(c, 'ไม่พบใบแจ้งนี้', 404);

  const before = mapIssue(beforeRow);
  const input = readIssueInput(b, before);
  const who = actorName(c);

  // รับทราบ/เริ่มแก้ไขเป็นงานของฝั่งสาย — ตรวจซ้ำที่นี่เพราะโทเคนเป็นโทเคนร่วม
  const touchesFlow = 'acked_at' in b || 'started_at' in b || b.status === 'in_progress';
  if (touchesFlow && !(await canWorkLine(c, before.vsm_line))) {
    return fail(c, 'รับทราบหรือเริ่มแก้ไขได้เฉพาะหัวหน้าสายและ VSM ของสายนี้', 403);
  }

  let status = before.status;
  if ('status' in b) {
    status = oneOf(b, 'status', ['in_progress', 'cancelled']);
    if (before.status === 'verified' || before.status === 'cancelled') {
      return fail(c, 'ใบที่ปิดหรือยกเลิกแล้วเปลี่ยนสถานะไม่ได้', 409);
    }
    // in_progress มีความหมายเฉพาะตอนยังไม่ได้ส่งงานแก้ไข — คิวที่มาช้ากว่าการส่งงาน
    // ต้องไม่ดึงใบที่รอ QC ตรวจรับ (fixed) หรือที่ถูกตีกลับ ย้อนกลับไปเป็นกำลังแก้ไข
    if (status === 'in_progress' && !['open', 'in_progress'].includes(before.status)) status = before.status;
  }

  // เวลาของแต่ละขั้นนับครั้งแรกเท่านั้น (ใช้วัดเวลาตอบสนอง) — ส่งซ้ำจากคิวไม่ทับของเดิม
  const stamp = (k) => (k in b && b[k] ? str(b, k, { max: 40 }) : null);
  const startedAt = before.started_at ?? stamp('started_at');
  const ackedAt = before.acked_at ?? stamp('acked_at') ?? startedAt;

  if (input.qty_checked > 0 && input.qty_defect > input.qty_checked) {
    return fail(c, 'จำนวนที่บกพร่องต้องไม่เกินจำนวนที่สุ่มตรวจ', 400);
  }

  const stmts = [
    c.env.DB.prepare(
      `UPDATE qc_issues
          SET vsm_line = ?, severity = ?, part_no = ?, lot_no = ?, qty_checked = ?, qty_defect = ?,
              description = ?, due_date = ?, status = ?, acked_at = ?, started_at = ?,
              shift = ?, machine_no = ?, model_no = ?, operator_id = ?, voice_key = ?
        WHERE id = ?`,
    ).bind(
      input.vsm_line, input.severity, input.part_no, input.lot_no, input.qty_checked, input.qty_defect,
      input.description, input.due_date, status, ackedAt, startedAt,
      input.shift, input.machine_no, input.model_no, input.operator_id, input.voice_url, id,
    ),
  ];

  // ตารางลูก: เขียนทับทั้งชุดเฉพาะเมื่อผู้เรียกส่งฟิลด์นั้นมาจริง
  if ('category_ids' in b) {
    stmts.push(c.env.DB.prepare(`DELETE FROM issue_categories WHERE issue_id = ?`).bind(id));
    input.category_ids.forEach((cid, i) =>
      stmts.push(
        c.env.DB.prepare(`INSERT INTO issue_categories (issue_id, category_id, sort_order) VALUES (?, ?, ?)`)
          .bind(id, cid, i),
      ),
    );
  }
  if ('photo_urls' in b) {
    stmts.push(c.env.DB.prepare(`DELETE FROM issue_photos WHERE issue_id = ?`).bind(id));
    input.photo_urls.forEach((key, i) =>
      stmts.push(
        c.env.DB.prepare(`INSERT INTO issue_photos (id, issue_id, photo_key, sort_order) VALUES (?, ?, ?, ?)`)
          .bind(uid('ph'), id, key, i),
      ),
    );
  }

  stmts.push(
    ...diffStmts(c.env.DB, {
      table: 'qc_issues', recordId: id, before,
      after: { ...input, status, acked_at: ackedAt, started_at: startedAt }, actor: who,
    }),
  );

  await c.env.DB.batch(stmts);

  const saved = await c.env.DB.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).bind(id).first();
  return ok(c, mapIssue(saved));
});

/* ══════════════════════════════════════════════════════════════════════════
   งานแก้ไขจากฝั่ง VSM + การตรวจรับของ QC
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/fixes', async (c) => {
  const where = [];
  const binds = [];

  const issueId = c.req.query('issue_id');
  if (issueId) { where.push('f.issue_id = ?'); binds.push(issueId); }

  if (c.req.query('pending') === '1') where.push(`f.verify_result = 'pending'`);

  const limit = qInt(c, 'limit', 1000, { min: 1, max: 5000 });
  const offset = qInt(c, 'offset', 0, { min: 0, max: 1000000 });

  const sql =
    FIX_SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY f.fixed_at DESC LIMIT ? OFFSET ?`;

  const { results } = await c.env.DB.prepare(sql).bind(...binds, limit, offset).all();
  return ok(c, results.map(mapFix));
});

/**
 * VSM ส่งงานแก้ไข
 *
 * ตรวจสิทธิ์ซ้ำที่นี่แม้หน้าจอจะกันไว้แล้ว เพราะโทเคนของแอปเป็นโทเคนร่วม
 * ใครที่เปิดหน้าเว็บได้ก็ยิง API ตรงได้ ถ้าไม่ตรวจ สายหนึ่งจะปิดงานแทนอีกสายได้
 * เซสชันผู้ดูแลระบบ (/admin) ทำแทนได้ เพราะต้องแก้ข้อมูลที่ค้างให้ผู้ใช้ได้
 */
app.post('/api/issues/:id/fixes', async (c) => {
  const issueId = c.req.param('id');
  const b = await readJson(c);
  const me = actor(c);

  const issue = await c.env.DB.prepare(`SELECT * FROM qc_issues WHERE id = ?`).bind(issueId).first();
  if (!issue) return fail(c, 'ไม่พบใบแจ้งนี้', 404);
  // ตรวจสิทธิ์ก่อนตรวจสถานะเสมอ — คนที่ไม่มีสิทธิ์ไม่ควรรู้ด้วยซ้ำว่าใบนี้อยู่สถานะไหน
  if (!(await canWorkLine(c, issue.vsm_line))) {
    return fail(c, 'ส่งงานแก้ไขได้เฉพาะหัวหน้าสายและ VSM ของสายนี้', 403);
  }
  if (!['open', 'in_progress', 'rejected'].includes(issue.status)) {
    return fail(c, 'ใบแจ้งนี้ไม่ได้อยู่ในสถานะที่ส่งงานแก้ไขได้', 409);
  }

  // ปิดงานบังคับแค่ "รูปหลังแก้ไข + คำอธิบาย" ตามที่โรงงานกำหนด
  // สาเหตุ (root_cause) เหลือไว้เป็นช่องไม่บังคับ เพื่อให้ข้อมูลเก่ายังอ่านได้
  const input = {
    id: clientId(b, 'fix'),
    issue_id: issueId,
    responder_id: str(b, 'responder_id', { max: 60 }),
    root_cause: str(b, 'root_cause', { required: false, max: 3000 }),
    action_taken: str(b, 'action_taken', { max: 3000 }),
    // บังคับรูปยืนยัน — นี่คือหลักฐานที่ QC ใช้ตรวจรับ ถ้าไม่มีก็ไม่มีอะไรให้ตรวจ
    photo_urls: strArray(b, 'photo_urls', { required: true, maxItems: 20, maxLen: 300 }),
    fixed_at: nowStamp(),
  };

  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM issue_fixes WHERE issue_id = ?`)
    .bind(issueId)
    .first();
  const attempt = (row?.n ?? 0) + 1;

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO issue_fixes (id, issue_id, responder_id, attempt, root_cause, action_taken, fixed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.id, input.issue_id, input.responder_id, attempt,
      input.root_cause, input.action_taken, input.fixed_at,
    ),
    ...input.photo_urls.map((key, i) =>
      c.env.DB.prepare(`INSERT INTO fix_photos (id, fix_id, photo_key, sort_order) VALUES (?, ?, ?, ?)`)
        .bind(uid('fp'), input.id, key, i),
    ),
    // ส่งงานแก้ไข = รับทราบและเริ่มแก้ไปแล้วโดยปริยาย ขั้นที่ข้ามมาให้ประทับเวลาตรงนี้
    c.env.DB.prepare(
      `UPDATE qc_issues SET status = 'fixed', acked_at = COALESCE(acked_at, ?), started_at = COALESCE(started_at, ?)
        WHERE id = ?`,
    ).bind(input.fixed_at, input.fixed_at, issueId),
    entryStmt(c.env.DB, {
      table: 'qc_issues', recordId: issueId, action: 'update', field: 'status',
      oldV: issue.status, newV: 'fixed', actor: actorName(c),
    }),
  ];

  try {
    await c.env.DB.batch(stmts);
    // แก้เสร็จ → เด้งหา QC ที่เปิดใบ ให้มาตรวจรับ
    later(
      c,
      notify(c.env, c.env.DB, [issue.qc_id].filter((id) => id !== me?.id), {
        title: `แก้ไขเสร็จแล้ว รอ QC ตรวจรับ · ${issue.vsm_line}`,
        body: `${issue.issue_no} · เครื่อง ${issue.machine_no || '-'}\n${clip(input.action_taken)}`,
        url: `/issues/${issueId}`,
        tag: issueId,
      }),
    );
  } catch (e) {
    if (!isDuplicate(e)) throw e;
  }

  const saved = await c.env.DB.prepare(`${FIX_SELECT} WHERE f.id = ?`).bind(input.id).first();
  return ok(c, mapFix(saved), 201);
});

/**
 * QC ตรวจรับงานแก้ไข
 *   pass → ปิดใบ (verified) พร้อมประทับเวลาปิด ซึ่งใช้วัดว่าทันกำหนดไหม
 *   fail → ตีกลับ (rejected) ใบยังนับเป็นงานค้างต่อไป และ closed_at ต้องถูกล้าง
 *          เผื่อกรณีตรวจรับผ่านไปแล้วแต่กลับมาเปิดใหม่
 */
app.put('/api/fixes/:id/verify', async (c) => {
  const fixId = c.req.param('id');
  const b = await readJson(c);
  const me = actor(c);

  if (me && me.role !== 'qc') {
    return fail(c, 'ตรวจรับได้เฉพาะเจ้าหน้าที่ QC และผู้ดูแลระบบ', 403);
  }

  const fix = await c.env.DB.prepare(`SELECT * FROM issue_fixes WHERE id = ?`).bind(fixId).first();
  if (!fix) return fail(c, 'ไม่พบงานแก้ไขนี้', 404);
  if (fix.verify_result !== 'pending') return fail(c, 'งานแก้ไขนี้ถูกตรวจรับไปแล้ว', 409);

  const result = oneOf(b, 'verify_result', ['pass', 'fail']);
  const note = str(b, 'verify_note', { required: false, max: 3000 });
  if (result === 'fail' && !note) {
    return fail(c, 'การตีกลับต้องระบุเหตุผล เพื่อให้ผู้แก้ไขรู้ว่าต้องทำอะไรต่อ', 400);
  }

  const verifiedBy = str(b, 'verified_by', { required: false, max: 60, fallback: me?.id ?? null });
  const stamp = nowStamp();
  const status = result === 'pass' ? 'verified' : 'rejected';

  const issue = await c.env.DB.prepare(`SELECT * FROM qc_issues WHERE id = ?`).bind(fix.issue_id).first();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE issue_fixes SET verify_result = ?, verify_note = ?, verified_by = ?, verified_at = ? WHERE id = ?`,
    ).bind(result, note, verifiedBy, stamp, fixId),
    c.env.DB.prepare(`UPDATE qc_issues SET status = ?, closed_at = ? WHERE id = ?`).bind(
      status,
      result === 'pass' ? stamp : null,
      fix.issue_id,
    ),
    entryStmt(c.env.DB, {
      table: 'qc_issues', recordId: fix.issue_id, action: 'update', field: 'status',
      oldV: issue?.status ?? null, newV: status, actor: actorName(c),
    }),
  ]);

  // ตีกลับ → เด้งกลับไปหาสายให้แก้ใหม่ พร้อมเหตุผล
  if (result === 'fail' && issue) {
    later(
      c,
      lineRecipients(c.env.DB, issue.vsm_line).then((ids) =>
        notify(c.env, c.env.DB, ids.filter((id) => id !== me?.id), {
          title: `QC ตีกลับ ต้องแก้ใหม่ · ${issue.vsm_line}`,
          body: `${issue.issue_no} · เครื่อง ${issue.machine_no || '-'}\n${clip(note)}`,
          url: `/issues/${issue.id}`,
          tag: issue.id,
        }),
      ),
    );
  }

  const saved = await c.env.DB.prepare(`${FIX_SELECT} WHERE f.id = ?`).bind(fixId).first();
  return ok(c, mapFix(saved));
});

/* ══════════════════════════════════════════════════════════════════════════
   งานค้าง + ร่องรอยการแก้ไข
   ══════════════════════════════════════════════════════════════════════════ */

/** ใบแจ้งที่ค้างอยู่ เรียงจากเลยกำหนดมากสุดก่อน — ใช้ทำรายงานเร่งรัดประจำวัน */
app.get('/api/issues/open/list', async (c) => {
  const limit = qInt(c, 'limit', 100, { min: 1, max: 500 });
  const line = c.req.query('vsm_line');
  if (line && !VSM_LINES.includes(line)) throw new BadInput('vsm_line', `ต้องเป็น ${VSM_LINES.join(', ')}`);

  const today = todayBangkok();
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.issue_no, i.found_date, i.due_date, i.severity, i.status, i.vsm_line, i.description,
            q.full_name AS qc_name, a.area_name
       FROM qc_issues i
       JOIN employees q ON q.id = i.qc_id
       JOIN areas a ON a.id = i.area_id
      WHERE i.status IN ('open', 'in_progress', 'fixed', 'rejected')
        ${line ? 'AND i.vsm_line = ?' : ''}
      ORDER BY i.due_date ASC, i.found_date ASC
      LIMIT ?`,
  )
    .bind(...(line ? [line, limit] : [limit]))
    .all();

  return ok(
    c,
    results.map((r) => ({
      issue_id: r.id,
      issue_no: r.issue_no,
      found_date: r.found_date,
      due_date: r.due_date,
      severity: r.severity,
      status: r.status,
      vsm_line: r.vsm_line,
      description: r.description,
      qc_name: r.qc_name,
      area_name: r.area_name,
      days_open: Math.max(0, diffDays(r.found_date, today)),
      days_overdue: Math.max(0, diffDays(r.due_date, today)),
    })),
  );
});

app.get('/api/change-history', async (c) => {
  const recordId = c.req.query('record_id');
  const limit = qInt(c, 'limit', 300, { min: 1, max: 1000 });

  const { results } = recordId
    ? await c.env.DB.prepare(`SELECT * FROM change_history WHERE record_id = ? ORDER BY changed_at DESC LIMIT ?`)
        .bind(recordId, limit).all()
    : await c.env.DB.prepare(`SELECT * FROM change_history ORDER BY changed_at DESC LIMIT ?`).bind(limit).all();

  return ok(c, results.map(mapChange));
});

/**
 * รอยล่าสุดของการเปลี่ยนแปลงทั้งระบบ — อ่านแถวเดียวผ่าน index
 *
 * หน้าจอถามทุกนาทีว่ามีอะไรใหม่ไหม แล้วค่อยดึงข้อมูลชุดใหญ่เมื่อค่านี้เปลี่ยนจริง
 * ถ้าดึงชุดใหญ่ทุกนาทีตรง ๆ จะกินโควตาการอ่านของ D1 วันละหลายสิบล้านแถว
 */
app.get('/api/changes/latest', async (c) => {
  const row = await c.env.DB.prepare(`SELECT id, changed_at FROM change_history ORDER BY changed_at DESC LIMIT 1`).first();
  return ok(c, { id: row?.id ?? null, changed_at: row?.changed_at ?? null });
});

/* ══════════════════════════════════════════════════════════════════════════
   หัวหน้าสาย VSM — คนที่ใบแจ้งของสายนั้นเด้งไปหา
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/line-heads', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT vsm_line, employee_id FROM line_heads ORDER BY vsm_line, created_at`,
  ).all();
  return ok(c, results);
});

/**
 * ตั้งหัวหน้าของสายหนึ่งทั้งชุด (ส่งอาร์เรย์ว่าง = ยังไม่กำหนด)
 *
 * คนที่ถูกตั้งเป็นหัวหน้าต้องเข้าระบบได้ ไม่งั้นงานจะเด้งไปหาคนที่เปิดแอปไม่ได้
 * จึงเปิดสิทธิ์เข้าใช้งานให้ในคำสั่งเดียวกัน (บันทึกลงประวัติการแก้ไขด้วย)
 */
app.put('/api/line-heads/:line', async (c) => {
  const line = c.req.param('line');
  if (!VSM_LINES.includes(line)) return fail(c, `สายต้องเป็น ${VSM_LINES.join(', ')}`, 400);
  if (!(await isSuperuserCall(c))) return fail(c, 'กำหนดหัวหน้าสายได้เฉพาะผู้ดูแลระบบ', 403);

  const b = await readJson(c);
  const ids = strArray(b, 'employee_ids', { maxItems: 10, maxLen: 60 });

  const people = ids.length
    ? (
        await c.env.DB.prepare(
          `SELECT id, can_login, is_active FROM employees WHERE id IN (${ids.map(() => '?').join(', ')})`,
        )
          .bind(...ids)
          .all()
      ).results
    : [];
  if (people.length !== ids.length) return fail(c, 'มีรหัสพนักงานที่ไม่อยู่ในทะเบียน', 400);
  if (people.some((p) => p.is_active !== 1)) return fail(c, 'ตั้งพนักงานที่ปิดบัญชีแล้วเป็นหัวหน้าสายไม่ได้', 400);

  const { results: beforeRows } = await c.env.DB.prepare(
    `SELECT employee_id FROM line_heads WHERE vsm_line = ? ORDER BY created_at`,
  )
    .bind(line)
    .all();
  const before = beforeRows.map((r) => r.employee_id);
  const who = actorName(c);
  const stamp = nowStamp();

  const stmts = [
    c.env.DB.prepare(`DELETE FROM line_heads WHERE vsm_line = ?`).bind(line),
    ...ids.map((id) =>
      c.env.DB.prepare(`INSERT INTO line_heads (vsm_line, employee_id, created_at) VALUES (?, ?, ?)`).bind(line, id, stamp),
    ),
    ...people
      .filter((p) => p.can_login !== 1)
      .flatMap((p) => [
        c.env.DB.prepare(`UPDATE employees SET can_login = 1 WHERE id = ?`).bind(p.id),
        entryStmt(c.env.DB, {
          table: 'employees', recordId: p.id, action: 'update', field: 'can_login',
          oldV: 'false', newV: 'true', actor: who,
        }),
      ]),
  ];
  if (before.join(',') !== ids.join(',')) {
    stmts.push(
      entryStmt(c.env.DB, {
        table: 'line_heads', recordId: line, action: 'update', field: 'employee_ids',
        oldV: before.join(', ') || null, newV: ids.join(', ') || null, actor: who,
      }),
    );
  }

  await c.env.DB.batch(stmts);
  return ok(c, ids.map((employee_id) => ({ vsm_line: line, employee_id })));
});

/* ══════════════════════════════════════════════════════════════════════════
   การแจ้งเตือนแบบเด้ง (Web Push) — ดู src/lib/push.js
   ══════════════════════════════════════════════════════════════════════════ */

/** กุญแจสาธารณะที่เบราว์เซอร์ต้องใช้ตอนสมัครรับการแจ้งเตือน (null = ยังไม่ได้ตั้งค่า) */
app.get('/api/push/key', (c) => ok(c, { key: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null }));

app.post('/api/push/subscribe', async (c) => {
  const me = actor(c);
  // ต้องรู้ว่าเครื่องนี้เป็นของใคร ไม่งั้นส่งงานให้ถูกคนไม่ได้
  if (!me) return fail(c, 'ต้องเข้าสู่ระบบด้วยรหัสพนักงานก่อนเปิดการแจ้งเตือน', 400);

  const b = await readJson(c);
  const endpoint = str(b, 'endpoint', { max: 1000 });
  if (!/^https:\/\//.test(endpoint)) throw new BadInput('endpoint', 'ต้องเป็น https');
  const keys = b.keys && typeof b.keys === 'object' ? b.keys : {};
  const p256dh = str(keys, 'p256dh', { max: 200 });
  const auth = str(keys, 'auth', { max: 100 });

  // เครื่องเดิมเปลี่ยนคนล็อกอิน → ย้ายเจ้าของไปเป็นคนใหม่ คนเก่าจะได้ไม่ได้รับงานของคนใหม่
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, employee_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET employee_id = excluded.employee_id,
                                            p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(endpoint, me.id, p256dh, auth, nowStamp())
    .run();
  return ok(c, { subscribed: true }, 201);
});

app.post('/api/push/unsubscribe', async (c) => {
  const b = await readJson(c);
  const endpoint = str(b, 'endpoint', { max: 1000 });
  await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(endpoint).run();
  return ok(c, { subscribed: false });
});

/** ส่งข้อความทดสอบหาเครื่องของตัวเอง — ไว้ให้ผู้ใช้เช็คว่าเด้งจริง */
app.post('/api/push/test', async (c) => {
  const me = actor(c);
  if (!me) return fail(c, 'ต้องเข้าสู่ระบบด้วยรหัสพนักงานก่อน', 400);
  if (!pushConfigured(c.env)) return fail(c, 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน (VAPID)', 503);
  await notify(c.env, c.env.DB, [me.id], {
    title: 'QC Audit Line · ทดสอบการแจ้งเตือน',
    body: `เครื่องนี้พร้อมรับงานแล้ว — ${me.name}`,
    url: '/mywork',
    tag: 'test',
  });
  return ok(c, { sent: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   รูปหลักฐาน (R2)
   ══════════════════════════════════════════════════════════════════════════ */

const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * ชนิดไฟล์เสียงที่รับ — MediaRecorder ของแต่ละเบราว์เซอร์ให้มาไม่เหมือนกัน
 * Chrome/Firefox ได้ webm(opus) · Safari ได้ mp4(aac) จึงต้องรับทั้งคู่
 * ไฟล์เสียงเก็บใน R2 ที่เดียวกับรูป เพราะเป็นหลักฐานประกอบใบแจ้งเหมือนกัน
 */
const ALLOWED_AUDIO = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav',
]);

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
  'audio/aac': 'aac', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav',
};

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

app.post('/api/uploads', async (c) => {
  const contentType = (c.req.header('Content-Type') ?? '').split(';')[0].trim();

  let blob;
  let type;

  if (contentType === 'multipart/form-data') {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return fail(c, 'ไม่พบไฟล์ในฟิลด์ "file"', 400);
    blob = file;
    type = file.type;
  } else {
    // ส่ง blob ดิบมาตรง ๆ ก็ได้ (frontend บีบอัดเป็น JPEG อยู่แล้ว)
    blob = await c.req.blob();
    type = contentType;
  }

  if (!ALLOWED_IMAGE.has(type) && !ALLOWED_AUDIO.has(type)) {
    return fail(c, `ชนิดไฟล์ "${type || 'ไม่ระบุ'}" ไม่รองรับ — ต้องเป็นรูป (JPEG/PNG/WebP) หรือเสียง (WebM/MP4/OGG)`, 400);
  }
  if (blob.size === 0) return fail(c, 'ไฟล์ว่างเปล่า', 400);
  if (blob.size > MAX_PHOTO_BYTES) {
    return fail(c, `ไฟล์ใหญ่เกิน ${MAX_PHOTO_BYTES / 1024 / 1024} MB`, 413);
  }

  const ext = EXT_BY_TYPE[type] ?? 'bin';
  // จัดเก็บแยกตามวัน เพื่อให้ไล่ดู/ล้างของเก่าใน R2 ได้ง่าย
  const key = `${todayBangkok()}/${uid(ALLOWED_AUDIO.has(type) ? 'au' : 'ph')}.${ext}`;

  await c.env.PHOTOS.put(key, blob.stream(), { httpMetadata: { contentType: type } });

  return ok(c, { key, size: blob.size, content_type: type }, 201);
});

app.get('/api/uploads/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return fail(c, 'ไม่พบรูปนี้', 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: obj.httpEtag,
    },
  });
});

app.delete('/api/uploads/:key{.+}', async (c) => {
  const key = c.req.param('key');
  // ไฟล์ถูกอ้างได้จากสามที่ ต้องเช็คให้ครบ ไม่งั้นลบรูปยืนยันการแก้ไข
  // หรือบันทึกเสียงของใบแจ้งทิ้งได้โดยไม่รู้ตัว
  const stillUsed = await c.env.DB.prepare(
    `SELECT 1 FROM issue_photos WHERE photo_key = ?
      UNION ALL
     SELECT 1 FROM fix_photos WHERE photo_key = ?
      UNION ALL
     SELECT 1 FROM qc_issues WHERE voice_key = ?
     LIMIT 1`,
  )
    .bind(key, key, key)
    .first();
  if (stillUsed) return fail(c, 'ลบไม่ได้ — ไฟล์นี้ยังถูกใช้อยู่ในใบแจ้งหรืองานแก้ไข', 409);

  await c.env.PHOTOS.delete(key);
  return ok(c, { key, deleted: true });
});

/* ══════════════════════════════════════════════════════════════════════════
   แดชบอร์ด + ส่งออก
   ══════════════════════════════════════════════════════════════════════════ */

/** ช่วงวันที่เริ่มต้น: ย้อนหลัง 30 วันถึงวันนี้ */
function dateRange(c) {
  const to = qDate(c, 'to') ?? todayBangkok();
  const from = qDate(c, 'from') ?? addDays(to, -29);
  if (from > to) throw new BadInput('from', 'ต้องไม่มาหลัง to');
  return { from, to };
}

app.get('/api/dashboard/summary', async (c) => {
  const { from, to } = dateRange(c);
  return ok(c, await buildSummary(c.env.DB, from, to));
});

app.get('/api/export/csv', async (c) => {
  const { from, to } = dateRange(c);
  const csv = await buildCsv(c.env.DB, from, to);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="qc-issues-${from}-to-${to}.csv"`,
    },
  });
});

export default app;
