import { mutate, peek, query } from './db';
import { ONLINE_MODE } from './config';
import { apiPost } from './net';
import { enqueue, type QueueKind } from './queue';
import { disablePush } from './push';
import { endAdminSession, endSession, startAdminSession, startSession } from './session';
import { refreshPending, syncNow } from './sync';
import { nowStamp, todayISO, type ISODate } from './time';
import { normalizeCode, uid } from './utils';
import type {
  Area,
  AppSettings,
  ChangeHistory,
  DefectCategory,
  Employee,
  IssueFix,
  IssueStatus,
  LineHead,
  LoginHistory,
  ProductionContext,
  QcIssue,
  QcRound,
  RoundResult,
  Severity,
  Superuser,
  VsmLine,
} from './types';

/**
 * ── ชั้นข้อมูลของโดเมน ──────────────────────────────────────
 * ทุกฟังก์ชันเขียนลง "สำเนาในเครื่อง" ก่อนเสมอ แล้วค่อยใส่คิวรอซิงก์
 * ผู้ใช้จึงบันทึกงานได้ทันทีแม้เน็ตไม่ถึง ซึ่งเป็นเรื่องปกติในโรงงาน
 * ส่วนการส่งขึ้นเซิร์ฟเวอร์เป็นหน้าที่ของ src/lib/sync.ts
 */

/**
 * ใส่งานเข้าคิวรอซิงก์ แล้วลองส่งทันทีถ้าออนไลน์อยู่
 *
 * ⚠️ ห้ามโยนข้อผิดพลาดออกไปเด็ดขาด
 * ข้อมูลถูกเขียนลงสำเนาในเครื่องเรียบร้อยแล้วก่อนถึงบรรทัดนี้
 * ถ้าปล่อยให้ล้ม ผู้ใช้จะเห็นว่าบันทึกไม่สำเร็จทั้งที่งานถูกเก็บไว้แล้ว
 * แล้วจะกดบันทึกซ้ำจนเกิดข้อมูลซ้ำ — แย่กว่าการซิงก์ช้าไปหนึ่งรอบ
 */
async function queueWrite(kind: QueueKind, localId: string, payload: unknown) {
  if (!ONLINE_MODE) return; // โหมดในเครื่องล้วน ไม่ต้องซิงก์
  try {
    await enqueue({ kind, localId, payload });
    await refreshPending();
    void syncNow();
  } catch (e) {
    // เข้าคิวไม่ได้ (เช่น IndexedDB ถูกปิดหรือพื้นที่เต็ม)
    // งานยังอยู่ในเครื่องครบ รอบซิงก์ถัดไปจะดึงของจากเซิร์ฟเวอร์มาเทียบเอง
    console.warn('ใส่คิวรอซิงก์ไม่สำเร็จ — ข้อมูลถูกบันทึกในเครื่องแล้ว', kind, localId, e);
  }
}

/** ── การเข้าสู่ระบบ ─────────────────────────────────────── */

/**
 * ผลการเข้าสู่ระบบ — error ตรงกับที่ Worker ตอบ (ดู signIn ใน worker/src/index.js)
 *   invalid      ไม่พบรหัสนี้ (หรือไม่อยู่ในทะเบียนผู้ดูแลระบบ สำหรับ /admin)
 *   offline      ติดต่อเซิร์ฟเวอร์ไม่ได้ — การเข้าสู่ระบบต้องใช้เน็ต
 */
export type LoginError = 'not_found' | 'inactive' | 'no_access' | 'invalid' | 'offline';

export interface LoginResult {
  error?: LoginError;
}

interface ServerLogin {
  error?: LoginError;
  token?: string;
  employee?: Employee;
  superuser?: boolean;
  admin?: { id: string; admin_code: string; full_name: string };
}

async function serverSignIn(path: string, code: string): Promise<ServerLogin> {
  try {
    return await apiPost<ServerLogin>(path, { code: code.trim() });
  } catch {
    return { error: 'offline' };
  }
}

/**
 * เข้าสู่ระบบด้วยรหัสพนักงาน — ต้องใช้เน็ต เพราะ Worker เป็นคนออกโทเคนเซสชัน
 * เข้าได้แล้วเซสชันอยู่ยาว ใช้งานออฟไลน์ต่อได้ตามปกติ
 */
export async function loginEmployee(code: string): Promise<LoginResult> {
  if (!ONLINE_MODE) return localLogin(code);
  const d = await serverSignIn('/api/auth/login', code);
  if (!d.token || !d.employee) return { error: d.error ?? 'invalid' };
  startSession(d.employee, d.token, Boolean(d.superuser));
  // สำเนาในเครื่องว่างจนกว่าจะเข้าระบบ (ทะเบียนไม่ได้ฝังในไฟล์เว็บแล้ว) — ดึงก่อนพาเข้าหน้างาน
  await syncNow();
  return {};
}

/** โหมดผู้ดูแลระบบ (/admin) — รหัสต้องอยู่ในทะเบียนผู้ดูแลระบบ */
export async function loginAdmin(code: string): Promise<LoginResult> {
  if (!ONLINE_MODE) {
    const wanted = normalizeCode(code);
    const su = peek((db) => db.superusers.find((s) => normalizeCode(s.admin_code) === wanted));
    if (!su) return { error: 'invalid' };
    startAdminSession(su, null);
    return {};
  }
  const d = await serverSignIn('/api/auth/admin', code);
  if (!d.token || !d.admin) return { error: d.error ?? 'invalid' };
  startAdminSession(d.admin, d.token);
  await syncNow();
  return {};
}

/** โหมดในเครื่อง (ไม่มีเซิร์ฟเวอร์ ใช้ตอนพัฒนา) — ตรวจกับทะเบียนในเครื่อง */
async function localLogin(code: string): Promise<LoginResult> {
  const wanted = normalizeCode(code);
  const res = await mutate((db) => {
    const e = db.employees.find((x) => normalizeCode(x.emp_code) === wanted);
    const granted = Boolean(e) && e!.is_active && e!.can_login;
    db.login_history.unshift({
      id: uid('log'),
      actor_id: e?.id ?? '-',
      actor_name: e?.full_name ?? code,
      role: 'employee',
      at: nowStamp(),
      result: granted ? 'success' : 'failed',
    });
    if (!e) return { error: 'not_found' as const };
    if (!e.is_active) return { error: 'inactive' as const };
    if (!e.can_login) return { error: 'no_access' as const };
    return { employee: e, superuser: db.superusers.some((s) => normalizeCode(s.admin_code) === wanted) };
  });
  if ('employee' in res && res.employee) {
    startSession(res.employee, null, res.superuser);
    return {};
  }
  return res;
}

/**
 * ออกจากระบบ — เลิกรับการแจ้งเตือนบนเครื่องนี้ แล้วลบเซสชันที่เซิร์ฟเวอร์
 * ทั้งสองอย่างต้องทำก่อนล้างเซสชันในเครื่อง เพราะต้องใช้โทเคนเดิมยืนยันตัว
 * เน็ตไม่ดีก็ไม่รอเกินสองวินาที — ผู้ใช้ต้องออกจากระบบได้เสมอ
 */
export async function signOut(): Promise<void> {
  const within = (p: Promise<unknown>) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  if (ONLINE_MODE) {
    await within(disablePush());
    await within(apiPost('/api/auth/logout'));
  }
  endSession();
  endAdminSession();
}

export async function getLoginHistory(): Promise<LoginHistory[]> {
  return query((db) => db.login_history.slice(0, 100));
}

/** ── ข้อมูลหลัก ─────────────────────────────────────────── */

export async function getEmployees(): Promise<Employee[]> {
  return query((db) => [...db.employees].sort((a, b) => a.emp_code.localeCompare(b.emp_code)));
}

export async function saveEmployee(input: Partial<Employee> & { id?: string }, actor: string): Promise<Employee> {
  const saved = await mutate((db) => {
    if (input.id) {
      const idx = db.employees.findIndex((m) => m.id === input.id);
      const before = db.employees[idx];
      const next = { ...before, ...input } as Employee;
      db.employees[idx] = next;
      logDiff(db.change_history, 'employees', next.id, before, next, actor);
      return next;
    }
    const created: Employee = {
      id: uid('emp'),
      emp_code: input.emp_code ?? '',
      full_name: input.full_name ?? '',
      full_name_en: input.full_name_en,
      department: input.department ?? '',
      position: input.position,
      avatar_url: input.avatar_url ?? null,
      role: input.role ?? 'viewer',
      vsm_line: input.vsm_line ?? null,
      is_active: input.is_active ?? true,
      dashboard_enabled: input.dashboard_enabled ?? true,
      // คนที่เพิ่มใหม่ยังล็อกอินไม่ได้จนกว่าจะเปิดสิทธิ์ให้ — ตรงกับฝั่ง Worker
      can_login: input.can_login ?? false,
      created_at: nowStamp(),
    };
    db.employees.push(created);
    db.change_history.unshift(entry('employees', created.id, 'create', null, created.full_name, actor));
    return created;
  });

  await queueWrite('employee.save', input.id ?? `new:${saved.id}`, {
    id: saved.id,
    emp_code: saved.emp_code,
    full_name: saved.full_name,
    full_name_en: saved.full_name_en,
    department: saved.department,
    position: saved.position,
    avatar_url: saved.avatar_url,
    role: saved.role,
    vsm_line: saved.vsm_line,
    is_active: saved.is_active,
    dashboard_enabled: saved.dashboard_enabled,
    can_login: saved.can_login,
  });
  return saved;
}

export async function getAreas(): Promise<Area[]> {
  return query((db) => db.areas);
}

export async function saveArea(input: Partial<Area> & { id?: string }, actor: string): Promise<Area> {
  const saved = await mutate((db) => {
    if (input.id) {
      const idx = db.areas.findIndex((a) => a.id === input.id);
      const before = db.areas[idx];
      const next = { ...before, ...input } as Area;
      db.areas[idx] = next;
      logDiff(db.change_history, 'areas', next.id, before, next, actor);
      return next;
    }
    const created: Area = {
      id: uid('ar'),
      area_name: input.area_name ?? '',
      area_name_en: input.area_name_en,
      parent_id: input.parent_id ?? null,
      vsm_line: input.vsm_line ?? null,
      is_active: input.is_active ?? true,
    };
    db.areas.push(created);
    db.change_history.unshift(entry('areas', created.id, 'create', null, created.area_name, actor));
    return created;
  });

  await queueWrite('area.save', input.id ?? `new:${saved.id}`, {
    id: saved.id,
    area_name: saved.area_name,
    area_name_en: saved.area_name_en,
    parent_id: saved.parent_id,
    vsm_line: saved.vsm_line,
    is_active: saved.is_active,
  });
  return saved;
}

export async function getCategories(): Promise<DefectCategory[]> {
  return query((db) => db.defect_categories);
}

export async function saveCategory(
  input: Partial<DefectCategory> & { id?: string },
  actor: string,
): Promise<DefectCategory> {
  const saved = await mutate((db) => {
    if (input.id) {
      const idx = db.defect_categories.findIndex((t) => t.id === input.id);
      const before = db.defect_categories[idx];
      const next = { ...before, ...input } as DefectCategory;
      db.defect_categories[idx] = next;
      logDiff(db.change_history, 'defect_categories', next.id, before, next, actor);
      return next;
    }
    const created: DefectCategory = {
      id: uid('cat'),
      category_name: input.category_name ?? '',
      category_name_en: input.category_name_en,
      is_active: input.is_active ?? true,
    };
    db.defect_categories.push(created);
    db.change_history.unshift(entry('defect_categories', created.id, 'create', null, created.category_name, actor));
    return created;
  });

  await queueWrite('category.save', input.id ?? `new:${saved.id}`, {
    id: saved.id,
    category_name: saved.category_name,
    category_name_en: saved.category_name_en,
    is_active: saved.is_active,
  });
  return saved;
}

/** ── หัวหน้าสาย VSM ─────────────────────────────────────── */

export async function getLineHeads(): Promise<LineHead[]> {
  return query((db) => db.line_heads ?? []);
}

/**
 * ตั้งหัวหน้าของสายหนึ่งทั้งชุด — ใบแจ้งของสายนั้นจะเด้งไปหาคนเหล่านี้
 * คนที่ยังเข้าระบบไม่ได้จะถูกเปิดสิทธิ์ให้ในคราวเดียว (Worker ทำแบบเดียวกัน)
 */
export async function saveLineHeads(line: VsmLine, employeeIds: string[], actor: string): Promise<LineHead[]> {
  const saved = await mutate((db) => {
    const before = (db.line_heads ?? []).filter((h) => h.vsm_line === line).map((h) => h.employee_id);
    db.line_heads = [
      ...(db.line_heads ?? []).filter((h) => h.vsm_line !== line),
      ...employeeIds.map((employee_id) => ({ vsm_line: line, employee_id })),
    ];
    for (const id of employeeIds) {
      const idx = db.employees.findIndex((e) => e.id === id);
      if (idx < 0 || db.employees[idx].can_login) continue;
      const prev = db.employees[idx];
      db.employees[idx] = { ...prev, can_login: true };
      logDiff(db.change_history, 'employees', id, prev, db.employees[idx], actor);
    }
    if (before.join(',') !== employeeIds.join(',')) {
      db.change_history.unshift(
        entry('line_heads', line, 'update', before.join(', ') || null, employeeIds.join(', ') || null, actor, 'employee_ids'),
      );
    }
    return db.line_heads.filter((h) => h.vsm_line === line);
  });

  await queueWrite('lineheads.save', line, { employee_ids: employeeIds });
  return saved;
}

export async function getSettings(): Promise<AppSettings> {
  return query((db) => db.app_settings);
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const saved = await mutate((db) => {
    db.app_settings = { ...db.app_settings, ...patch };
    return db.app_settings;
  });

  await queueWrite('settings.save', 'settings', patch);
  return saved;
}

/** ── รอบตรวจ + ปัญหาที่พบ ───────────────────────────────── */

export async function getRounds(): Promise<QcRound[]> {
  return query((db) => db.qc_rounds);
}

export async function getIssues(): Promise<QcIssue[]> {
  return query((db) => db.qc_issues);
}

export async function getFixes(): Promise<IssueFix[]> {
  return query((db) => db.issue_fixes);
}

/**
 * เลขที่เอกสารแบบเรียงตามวัน เช่น QC-260829-003
 *
 * ค่านี้เป็นเลข "ชั่วคราว" ที่ออกจากเครื่องผู้ใช้ เพราะต้องบันทึกได้ตอนออฟไลน์
 * เมื่อซิงก์สำเร็จ เซิร์ฟเวอร์จะออกเลขจริงของตัวเองแล้วส่งกลับมาทับ
 * (ดู worker/src/index.js — เลขบนเซิร์ฟเวอร์คือเลขที่ใช้อ้างอิงอย่างเป็นทางการ)
 */
function docNo(prefix: string, date: ISODate, seq: number): string {
  const ymd = date.slice(2).replace(/-/g, '');
  return `${prefix}-${ymd}-${String(seq).padStart(3, '0')}`;
}

export type RoundInput = {
  qc_id: string;
  round_date: ISODate;
  round_time: string;
  area_id: string;
  vsm_line: VsmLine;
  qty_checked: number;
  result: RoundResult;
  note?: string;
} & Partial<ProductionContext>;

export type IssueInput = {
  round_id: string | null;
  qc_id: string;
  found_date: ISODate;
  found_time: string;
  area_id: string;
  vsm_line: VsmLine;
  category_ids: string[];
  severity: Severity;
  part_no?: string;
  lot_no?: string;
  qty_checked: number;
  qty_defect: number;
  description: string;
  photo_urls: string[];
  voice_url?: string | null;
  due_date: ISODate;
} & Partial<ProductionContext>;

/** เติมค่าว่างให้ครบทุกฟิลด์ของบริบทการผลิต — ใช้ตอนสร้างเรคคอร์ดใหม่ */
function context(input: Partial<ProductionContext>): ProductionContext {
  return {
    shift: input.shift ?? null,
    machine_no: input.machine_no ?? '',
    model_no: input.model_no ?? '',
    operator_id: input.operator_id ?? null,
  };
}

/**
 * ฟิลด์ของใบแจ้งที่สืบทอดจากรอบตรวจเสมอ ผู้เรียกจึงไม่ต้องส่งมาซ้ำ
 * (ถ้าเปิดให้ส่งเองได้ จะเกิดใบแจ้งที่บอกว่าเกิดคนละกะกับรอบตรวจที่มันสังกัด)
 */
type InheritedFromRound =
  | 'round_id' | 'qc_id' | 'found_date' | 'found_time' | 'area_id' | 'vsm_line' | 'qty_checked'
  | keyof ProductionContext;

/** สร้างรอบตรวจ (ผ่าน) หรือรอบตรวจ + ใบแจ้งปัญหา (ไม่ผ่าน) ในการกดครั้งเดียว */
export async function createRound(
  round: RoundInput,
  issue: Omit<IssueInput, InheritedFromRound> | null,
  actor: string,
): Promise<{ round: QcRound; issue: QcIssue | null }> {
  const result = await mutate((db) => {
    const sameDay = db.qc_rounds.filter((r) => r.round_date === round.round_date).length;
    const createdRound: QcRound = {
      id: uid('rnd'),
      round_no: docNo('R', round.round_date, sameDay + 1),
      qc_id: round.qc_id,
      round_date: round.round_date,
      round_time: round.round_time,
      area_id: round.area_id,
      vsm_line: round.vsm_line,
      qty_checked: round.qty_checked,
      result: round.result,
      note: round.note ?? '',
      ...context(round),
      created_at: nowStamp(),
    };
    db.qc_rounds.push(createdRound);
    db.change_history.unshift(
      entry('qc_rounds', createdRound.id, 'create', null, createdRound.round_no, actor),
    );

    let createdIssue: QcIssue | null = null;
    if (issue) {
      createdIssue = newIssue(db.qc_issues, {
        ...issue,
        round_id: createdRound.id,
        qc_id: round.qc_id,
        found_date: round.round_date,
        found_time: round.round_time,
        area_id: round.area_id,
        vsm_line: round.vsm_line,
        qty_checked: round.qty_checked,
        ...context(createdRound),
      });
      db.qc_issues.push(createdIssue);
      db.change_history.unshift(
        entry('qc_issues', createdIssue.id, 'create', null, createdIssue.issue_no, actor),
      );
    }
    return { round: createdRound, issue: createdIssue };
  });

  await queueWrite('round.create', result.round.id, {
    id: result.round.id,
    qc_id: result.round.qc_id,
    round_date: result.round.round_date,
    round_time: result.round.round_time,
    area_id: result.round.area_id,
    vsm_line: result.round.vsm_line,
    qty_checked: result.round.qty_checked,
    result: result.round.result,
    note: result.round.note,
    ...context(result.round),
    // ส่งใบแจ้งไปพร้อมกันในคำขอเดียว เพื่อไม่ให้เกิดสภาพ "มีรอบตรวจ NG แต่ไม่มีใบแจ้ง"
    // ถ้าเน็ตหลุดกลางคันระหว่างสองคำขอที่แยกกัน
    issue: result.issue ? issuePayload(result.issue) : null,
  });

  return result;
}

/** แจ้งปัญหานอกรอบ หรือเพิ่มปัญหาใบที่สองของรอบเดิม */
export async function createIssue(input: IssueInput, actor: string): Promise<QcIssue> {
  const created = await mutate((db) => {
    const issue = newIssue(db.qc_issues, input);
    db.qc_issues.push(issue);
    db.change_history.unshift(entry('qc_issues', issue.id, 'create', null, issue.issue_no, actor));
    return issue;
  });

  await queueWrite('issue.create', created.id, issuePayload(created));
  return created;
}

function newIssue(existing: QcIssue[], input: IssueInput): QcIssue {
  const sameDay = existing.filter((i) => i.found_date === input.found_date).length;
  return {
    id: uid('iss'),
    issue_no: docNo('QC', input.found_date, sameDay + 1),
    round_id: input.round_id,
    qc_id: input.qc_id,
    found_date: input.found_date,
    found_time: input.found_time,
    area_id: input.area_id,
    vsm_line: input.vsm_line,
    category_ids: input.category_ids.slice(0, 3),
    severity: input.severity,
    part_no: input.part_no ?? '',
    lot_no: input.lot_no ?? '',
    qty_checked: input.qty_checked,
    qty_defect: input.qty_defect,
    description: input.description,
    photo_urls: input.photo_urls,
    voice_url: input.voice_url ?? null,
    ...context(input),
    due_date: input.due_date,
    status: 'open',
    acked_at: null,
    started_at: null,
    closed_at: null,
    created_at: nowStamp(),
  };
}

function issuePayload(i: QcIssue) {
  return {
    id: i.id,
    round_id: i.round_id,
    qc_id: i.qc_id,
    found_date: i.found_date,
    found_time: i.found_time,
    area_id: i.area_id,
    vsm_line: i.vsm_line,
    category_ids: i.category_ids,
    severity: i.severity,
    part_no: i.part_no,
    lot_no: i.lot_no,
    qty_checked: i.qty_checked,
    qty_defect: i.qty_defect,
    description: i.description,
    photo_urls: i.photo_urls,
    voice_url: i.voice_url,
    shift: i.shift,
    machine_no: i.machine_no,
    model_no: i.model_no,
    operator_id: i.operator_id,
    due_date: i.due_date,
  };
}

/** แก้ไขรายละเอียดใบแจ้ง (QC เจ้าของใบหรือผู้ดูแลระบบเท่านั้น — บังคับที่หน้าจอ) */
export async function updateIssue(id: string, patch: Partial<QcIssue>, actor: string): Promise<QcIssue> {
  const next = await mutate((db) => {
    const idx = db.qc_issues.findIndex((i) => i.id === id);
    const before = db.qc_issues[idx];
    const merged: QcIssue = { ...before, ...patch };
    if (patch.category_ids) merged.category_ids = patch.category_ids.slice(0, 3);
    db.qc_issues[idx] = merged;
    logDiff(db.change_history, 'qc_issues', id, before, merged, actor);
    return merged;
  });

  // ส่งเฉพาะฟิลด์ที่ผู้ใช้แก้จริง เพื่อไม่ให้ทับค่าที่คนอื่นเพิ่งแก้บนเซิร์ฟเวอร์
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) body[key] = (next as unknown as Record<string, unknown>)[key];
  await queueWrite('issue.update', id, body);
  return next;
}

/**
 * ขั้นที่ 2 และ 3 ของใบแจ้ง — VSM กด "รับทราบ" แล้วกด "เริ่มแก้ไข"
 *
 * ทั้งสองขั้นใช้สถานะ in_progress เดียวกัน แยกด้วย started_at (ดู stageOf ใน calc.ts)
 * เรียกซ้ำได้โดยไม่ทำให้ข้อมูลเพี้ยน — เวลาครั้งแรกเท่านั้นที่นับ ทั้งที่นี่และฝั่ง Worker
 * เริ่มแก้ไขโดยยังไม่เคยกดรับทราบ ถือว่ารับทราบไปพร้อมกัน
 */
async function advanceIssue(id: string, step: 'ack' | 'start', actor: string): Promise<QcIssue> {
  const stamp = nowStamp();
  const next = await mutate((db) => {
    const idx = db.qc_issues.findIndex((i) => i.id === id);
    const before = db.qc_issues[idx];
    const merged: QcIssue = {
      ...before,
      status: before.status === 'open' ? 'in_progress' : before.status,
      acked_at: before.acked_at ?? stamp,
      started_at: step === 'start' ? (before.started_at ?? stamp) : (before.started_at ?? null),
    };
    db.qc_issues[idx] = merged;
    logDiff(db.change_history, 'qc_issues', id, before, merged, actor);
    return merged;
  });

  await queueWrite('issue.update', id, {
    // ใบที่ถูกตีกลับกลับมาเริ่มแก้ใหม่ ไม่ต้องส่งสถานะ — Worker รับแค่ in_progress/cancelled
    ...(next.status === 'in_progress' ? { status: next.status } : {}),
    acked_at: next.acked_at,
    ...(step === 'start' ? { started_at: next.started_at } : {}),
  });
  return next;
}

/** ขั้นที่ 2 — VSM รับทราบ (จับเวลาตอบสนอง) */
export const ackIssue = (id: string, actor: string) => advanceIssue(id, 'ack', actor);

/** ขั้นที่ 3 — VSM เริ่มลงมือแก้ไข */
export const startIssue = (id: string, actor: string) => advanceIssue(id, 'start', actor);

/** ยกเลิกใบแจ้ง (บันทึกผิด/ซ้ำ) — ไม่ลบทิ้ง เพราะต้องเก็บเป็นหลักฐาน */
export async function cancelIssue(id: string, actor: string): Promise<QcIssue> {
  return updateIssue(id, { status: 'cancelled' }, actor);
}

/** ── งานแก้ไขจากฝั่ง VSM ─────────────────────────────────── */

/**
 * ขั้นที่ 4 "แก้ไขเสร็จแล้ว" — โรงงานกำหนดให้ปิดงานด้วยรูปหลังแก้ไข + คำอธิบายเท่านั้น
 * root_cause เหลือไว้ไม่บังคับ เพื่อให้ข้อมูลเก่าที่เคยกรอกสาเหตุยังอ่านได้ครบ
 */
export type FixInput = {
  issue_id: string;
  responder_id: string;
  root_cause?: string;
  /** คำอธิบายการแก้ไข — บังคับ */
  action_taken: string;
  /** บังคับอย่างน้อย 1 รูป — เป็นหลักฐานว่าแก้ไขจริง */
  photo_urls: string[];
};

export async function submitFix(input: FixInput, actor: string): Promise<IssueFix> {
  const created = await mutate((db) => {
    const attempt = db.issue_fixes.filter((f) => f.issue_id === input.issue_id).length + 1;
    const fix: IssueFix = {
      id: uid('fix'),
      issue_id: input.issue_id,
      responder_id: input.responder_id,
      attempt,
      root_cause: input.root_cause ?? '',
      action_taken: input.action_taken,
      photo_urls: input.photo_urls,
      fixed_at: nowStamp(),
      verify_result: 'pending',
      verify_note: '',
      verified_by: null,
      verified_at: null,
    };
    db.issue_fixes.push(fix);

    const idx = db.qc_issues.findIndex((i) => i.id === input.issue_id);
    if (idx >= 0) {
      const before = db.qc_issues[idx];
      // ขั้นที่ข้ามมา (ส่งงานโดยไม่ได้กดรับทราบ/เริ่มแก้) ประทับเวลาตรงนี้ ตรงกับฝั่ง Worker
      const merged: QcIssue = {
        ...before,
        status: 'fixed',
        acked_at: before.acked_at ?? fix.fixed_at,
        started_at: before.started_at ?? fix.fixed_at,
      };
      db.qc_issues[idx] = merged;
      logDiff(db.change_history, 'qc_issues', merged.id, before, merged, actor);
    }
    db.change_history.unshift(
      entry('issue_fixes', fix.id, 'create', null, `ครั้งที่ ${attempt}`, actor, 'attempt'),
    );
    return fix;
  });

  await queueWrite('fix.create', created.id, {
    id: created.id,
    issue_id: created.issue_id,
    responder_id: created.responder_id,
    root_cause: created.root_cause,
    action_taken: created.action_taken,
    photo_urls: created.photo_urls,
  });
  return created;
}

/**
 * QC ตรวจรับงานแก้ไข
 *   pass → ปิดใบ (verified) พร้อมจับเวลาปิด
 *   fail → ตีกลับ (rejected) ให้ VSM แก้ใหม่ ใบยังนับเป็นงานค้างต่อไป
 */
export async function verifyFix(
  fixId: string,
  result: 'pass' | 'fail',
  note: string,
  verifiedBy: string,
  actor: string,
): Promise<IssueFix> {
  const stamp = nowStamp();
  const saved = await mutate((db) => {
    const idx = db.issue_fixes.findIndex((f) => f.id === fixId);
    const before = db.issue_fixes[idx];
    const next: IssueFix = {
      ...before,
      verify_result: result,
      verify_note: note,
      verified_by: verifiedBy,
      verified_at: stamp,
    };
    db.issue_fixes[idx] = next;

    const ii = db.qc_issues.findIndex((i) => i.id === next.issue_id);
    if (ii >= 0) {
      const issueBefore = db.qc_issues[ii];
      const status: IssueStatus = result === 'pass' ? 'verified' : 'rejected';
      const merged: QcIssue = {
        ...issueBefore,
        status,
        closed_at: result === 'pass' ? stamp : null,
      };
      db.qc_issues[ii] = merged;
      logDiff(db.change_history, 'qc_issues', merged.id, issueBefore, merged, actor);
    }
    return next;
  });

  await queueWrite('fix.verify', fixId, {
    verify_result: saved.verify_result,
    verify_note: saved.verify_note,
    verified_by: saved.verified_by,
  });
  return saved;
}

/** ── Audit trail ────────────────────────────────────────── */

/**
 * ประวัติการแก้ไข — ไม่ส่ง recordId มาคือขอทั้งระบบ (หน้าบันทึกระบบของผู้ดูแล)
 * เพดานตรงกับที่ตัวซิงก์ดึงมาจากเซิร์ฟเวอร์ ดู pull() ใน src/lib/sync.ts
 */
export async function getChangeHistory(recordId?: string, limit = 1000): Promise<ChangeHistory[]> {
  return query((db) =>
    recordId ? db.change_history.filter((c) => c.record_id === recordId) : db.change_history.slice(0, limit),
  );
}

function entry(
  table: string,
  recordId: string,
  action: ChangeHistory['action_type'],
  oldV: string | null,
  newV: string | null,
  actor: string,
  field?: string,
): ChangeHistory {
  return {
    id: uid('ch'),
    table_name: table,
    record_id: recordId,
    action_type: action,
    field,
    old_value: oldV,
    new_value: newV,
    changed_by: actor,
    changed_at: nowStamp(),
  };
}

const IGNORED_FIELDS = new Set(['id', 'created_at', 'issue_no', 'round_no']);

function logDiff(sink: ChangeHistory[], table: string, id: string, before: any, after: any, actor: string) {
  for (const key of Object.keys(after)) {
    if (IGNORED_FIELDS.has(key)) continue;
    const a = normalize(before?.[key]);
    const b = normalize(after[key]);
    if (a === b) continue;
    sink.unshift(entry(table, id, 'update', a, b, actor, key));
  }
}

function normalize(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** วันนี้ตามเวลาไทย — ให้หน้าจอเรียกผ่านที่นี่เพื่อไม่ต้อง import time เพิ่ม */
export const today = todayISO;
