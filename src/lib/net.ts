/**
 * ชั้นเดียวที่คุยกับ Worker โดยตรง — component ห้ามเรียก fetch เอง
 *
 * ทุกคำตอบจาก API มีรูปแบบ { ok, data } หรือ { ok, error }
 * ไฟล์นี้แกะเปลือกนั้นออก คืนเฉพาะ data และโยน ApiError เมื่อผิดพลาด
 */

import { API_URL, AUTH_TOKEN, AUTH_TOKEN_OK, ONLINE_MODE } from './config';
import { authToken } from './session';

/** ข้อผิดพลาดจากฝั่ง API — มีสถานะ HTTP ติดมาด้วยเพื่อแยกแยะปลายทาง */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
  /** ต่อเน็ตไม่ได้ (ไม่ใช่ความผิดของข้อมูล) — ใช้ตัดสินว่าควรเข้าโหมดออฟไลน์ */
  get isOffline() {
    return this.status === 0;
  }
}

const TIMEOUT_MS = 15_000;

function headers(extra?: HeadersInit): HeadersInit {
  const h: Record<string, string> = { ...(extra as Record<string, string>) };
  if (AUTH_TOKEN) h['X-Auth-Token'] = AUTH_TOKEN;
  // โทเคนเซสชันที่ได้หลังกรอก PIN — Worker รู้ว่าใครทำรายการจากตัวนี้เท่านั้น
  const session = authToken();
  if (session) h['X-Session'] = session;
  return h;
}

/**
 * เซิร์ฟเวอร์ตอบ 401 ทั้งที่เราแนบเซสชันไป = เซสชันหมดอายุ ถูกล้าง PIN หรือถูกถอนสิทธิ์
 * แอปต้องพาผู้ใช้ไปเข้าสู่ระบบใหม่ ไม่ใช่ค้างอยู่ในหน้าที่ทุกปุ่มกดแล้วล้มเงียบ ๆ
 */
let unauthorized: (() => void) | null = null;
export function onUnauthorized(fn: () => void) {
  unauthorized = fn;
}
function checkAuth(status: number, sentSession: boolean) {
  if (status === 401 && sentSession) unauthorized?.();
}

/**
 * ตรวจการตั้งค่าก่อนยิง — โทเคนผิดรูปทำให้ fetch ล้มแบบเดียวกับเน็ตหลุด
 * จึงตอบ 401 แทน (ผลเดียวกับที่ Worker ตอบเมื่อโทเคนไม่ตรง) ไม่ให้ถูกนับเป็นออฟไลน์
 */
function assertConfigured() {
  if (!ONLINE_MODE) throw new ApiError('ยังไม่ได้ตั้งค่า VITE_API_URL', 0);
  if (!AUTH_TOKEN_OK) throw new ApiError('VITE_AUTH_TOKEN ตั้งค่าไม่ถูกต้อง', 401);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  assertConfigured();

  // ตัดการรอที่ค้างนาน — ในโรงงานสัญญาณมักหายกลางคัน
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  const sentSession = authToken() !== null;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal: ctl.signal,
      headers: body === undefined ? headers() : headers({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 0);
  } finally {
    clearTimeout(timer);
  }

  let payload: { ok?: boolean; data?: T; error?: string } | null = null;
  try {
    payload = await res.json();
  } catch {
    // ตอบมาไม่ใช่ JSON (เช่นหน้า error ของ proxy)
  }

  if (!res.ok || !payload?.ok) {
    checkAuth(res.status, sentSession);
    throw new ApiError(payload?.error ?? `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`, res.status);
  }
  return payload.data as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
export const apiPut = <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {});
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);

/** อัปโหลดรูปขึ้น R2 — ส่ง blob ดิบ ไม่ใช่ JSON */
export async function apiUpload(blob: Blob): Promise<string> {
  assertConfigured();

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/uploads`, {
      method: 'POST',
      headers: headers({ 'Content-Type': blob.type || 'image/jpeg' }),
      body: blob,
    });
  } catch {
    throw new ApiError('อัปโหลดรูปไม่สำเร็จ — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 0);
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.ok) {
    checkAuth(res.status, authToken() !== null);
    throw new ApiError(payload?.error ?? 'อัปโหลดรูปไม่สำเร็จ', res.status);
  }
  return payload.data.key as string;
}

/** ดึงรูปจาก R2 มาเป็น Blob (ต้องแนบโทเคน จึงใช้ <img src> ตรง ๆ ไม่ได้) */
export async function apiFetchPhoto(key: string): Promise<Blob | null> {
  if (!ONLINE_MODE) return null;
  try {
    const res = await fetch(`${API_URL}/api/uploads/${key}`, { headers: headers() });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** ที่อยู่สำหรับดาวน์โหลด CSV (เปิดผ่าน fetch เพราะต้องแนบโทเคน) */
export async function apiDownloadCsv(from: string, to: string): Promise<string> {
  assertConfigured();
  const res = await fetch(`${API_URL}/api/export/csv?from=${from}&to=${to}`, { headers: headers() });
  if (!res.ok) throw new ApiError('ส่งออก CSV ไม่สำเร็จ', res.status);
  return res.text();
}
