import { ONLINE_MODE } from './config';
import type { Employee, Role, VsmLine } from './types';

/**
 * เซสชันผู้ใช้ เก็บใน localStorage — คงอยู่หลังรีเฟรช/เปลี่ยนหน้า
 *
 * token คือโทเคนที่ Worker ออกให้หลังกรอก PIN ถูก ทุกคำขอแนบไปใน X-Session
 * (ดู src/lib/net.ts) Worker ตัดสินว่าใครทำอะไรจากโทเคนนี้เท่านั้น
 * เซสชันที่เก็บไว้จากรุ่นก่อนมี PIN ไม่มีโทเคน — ถือว่ายังไม่ได้เข้าระบบ ต้องเข้าใหม่
 */

const KEY = 'qc.session';
const ADMIN_KEY = 'qc.admin';
/** sessionStorage — ธงบอกหน้าแรกว่าถูกพากลับมาเพราะเซสชันใช้ไม่ได้แล้ว */
export const EXPIRED_KEY = 'qc.expired';

export interface Session {
  employee_id: string;
  emp_code: string;
  full_name: string;
  full_name_en?: string;
  department: string;
  role: Role;
  /** สายที่รับผิดชอบ — ใช้กรอง "งานของฉัน" ให้ VSM เห็นเฉพาะของสายตัวเอง */
  vsm_line: VsmLine | null;
  dashboard_enabled: boolean;
  avatar_url?: string | null;
  signed_in_at: string;
  /** โทเคนเซสชันจาก Worker — null ได้เฉพาะโหมดในเครื่อง (ไม่มีเซิร์ฟเวอร์) */
  token: string | null;
  /** อยู่ในทะเบียนผู้ดูแลระบบ — Worker เป็นคนบอก ไม่ได้ตัดสินจากรายชื่อในเครื่อง */
  superuser: boolean;
}

/** เซสชันโหมดผู้ดูแลระบบ (เข้าที่ /admin) */
export interface AdminSession {
  admin_code: string;
  full_name: string;
  token: string | null;
  signed_in_at: string;
}

const listeners = new Set<() => void>();

/**
 * แคชค่าที่ parse แล้วไว้ เพื่อให้ได้ reference เดิมตราบใดที่ข้อมูลไม่เปลี่ยน
 * (useSyncExternalStore ต้องการ snapshot ที่เสถียร ไม่งั้นจะ re-render ไม่สิ้นสุด)
 */
let cachedRaw: string | null = null;
let cachedSession: Session | null = null;

export function getSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (raw === cachedRaw) return cachedSession;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    cachedSession = parsed && (parsed.token || !ONLINE_MODE) ? parsed : null;
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

export function startSession(e: Employee, token: string | null, superuser: boolean): Session {
  const s: Session = {
    employee_id: e.id,
    emp_code: e.emp_code,
    full_name: e.full_name,
    full_name_en: e.full_name_en,
    department: e.department,
    role: e.role,
    vsm_line: e.vsm_line,
    dashboard_enabled: e.dashboard_enabled,
    avatar_url: e.avatar_url,
    signed_in_at: new Date().toISOString(),
    token,
    superuser,
  };
  localStorage.setItem(KEY, JSON.stringify(s));
  emit();
  return s;
}

/**
 * ซิงก์ค่าสิทธิ์ล่าสุดจากฐานข้อมูล (Admin แก้แล้วต้องมีผลทันที)
 *
 * ถูกเตะออกเมื่อ: ถูกลบออกจากทะเบียน · ปิดบัญชี (ลาออก) · ถูกถอนสิทธิ์เข้าใช้งาน
 * ทั้งสามกรณีต้องออกจากระบบทันที ไม่ใช่รอให้เซสชันหมดอายุ
 *
 * บทบาทและสายที่รับผิดชอบก็ต้องตามให้ทัน ไม่งั้นคนที่ถูกย้ายสายจะยังเห็นงานของสายเดิม
 */
export function syncSession(e: Employee | undefined): 'ok' | 'kicked' {
  const s = getSession();
  if (!s) return 'ok';
  if (!e || !e.is_active || !e.can_login) {
    endSession();
    return 'kicked';
  }
  const changed =
    s.dashboard_enabled !== e.dashboard_enabled ||
    s.full_name !== e.full_name ||
    s.avatar_url !== e.avatar_url ||
    s.role !== e.role ||
    s.vsm_line !== e.vsm_line ||
    s.department !== e.department;

  if (changed) {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...s,
        dashboard_enabled: e.dashboard_enabled,
        full_name: e.full_name,
        avatar_url: e.avatar_url,
        role: e.role,
        vsm_line: e.vsm_line,
        department: e.department,
      }),
    );
    emit();
  }
  return 'ok';
}

export function endSession() {
  localStorage.removeItem(KEY);
  emit();
}

let cachedAdminRaw: string | null = null;
let cachedAdmin: AdminSession | null = null;

export function getAdminSession(): AdminSession | null {
  const raw = localStorage.getItem(ADMIN_KEY);
  if (raw === cachedAdminRaw) return cachedAdmin;
  cachedAdminRaw = raw;
  try {
    // รุ่นก่อนเก็บแค่ '1' — ใครก็ตั้งเองได้จาก DevTools จึงไม่นับอีกต่อไป
    const parsed = raw && raw !== '1' ? (JSON.parse(raw) as AdminSession) : null;
    cachedAdmin = parsed && (parsed.token || !ONLINE_MODE) ? parsed : null;
  } catch {
    cachedAdmin = null;
  }
  return cachedAdmin;
}

export function isAdmin(): boolean {
  return getAdminSession() !== null;
}

export function startAdminSession(admin: { admin_code: string; full_name: string }, token: string | null) {
  const a: AdminSession = { ...admin, token, signed_in_at: new Date().toISOString() };
  localStorage.setItem(ADMIN_KEY, JSON.stringify(a));
  emit();
}

export function endAdminSession() {
  localStorage.removeItem(ADMIN_KEY);
  emit();
}

/**
 * โทเคนที่แนบไปกับคำขอ — เซสชันพนักงานก่อน แล้วค่อยโหมดผู้ดูแลระบบ
 * (ล็อกอินเป็นพนักงานอยู่ด้วย = ทำในนามพนักงานคนนั้น ตรงกับ adminOnly ในหน้าจอ)
 */
export function authToken(): string | null {
  return getSession()?.token ?? getAdminSession()?.token ?? null;
}

export function subscribeSession(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}
