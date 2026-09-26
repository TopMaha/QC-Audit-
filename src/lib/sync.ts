/**
 * ตัวซิงก์ข้อมูลระหว่างเครื่องกับเซิร์ฟเวอร์
 *
 * แนวคิด: หน้าจอทุกหน้าอ่าน–เขียนกับ "สำเนาในเครื่อง" (src/lib/db.ts) เท่านั้น
 * ไฟล์นี้ทำหน้าที่สองอย่างอยู่เบื้องหลัง
 *   pull — ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์มาทับสำเนาในเครื่อง
 *   push — ส่งงานที่ค้างในคิวขึ้นเซิร์ฟเวอร์ตามลำดับที่ทำไว้
 *
 * ผลคือแอปใช้งานได้ต่อเนื่องแม้เน็ตหลุดกลางคัน ซึ่งเป็นเรื่องปกติในโรงงาน
 * และไม่ต้องแก้หน้าจอสักหน้าเดียว
 */

import { ONLINE_MODE } from './config';
import { hydrate, peek } from './db';
import { ApiError, apiGet, apiPost, apiPut, apiUpload } from './net';
import { LOCAL_PREFIX, getPhotoBlob } from './photos';
import { listQueue, markFailed, queueSize, removeFromQueue, type QueueItem } from './queue';
import { authToken } from './session';
import type {
  Area,
  AppSettings,
  ChangeHistory,
  DefectCategory,
  Employee,
  IssueFix,
  LineHead,
  LoginHistory,
  QcIssue,
  QcRound,
} from './types';

export type SyncState = 'offline' | 'idle' | 'syncing' | 'pending' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** จำนวนงานที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ */
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  online: boolean;
}

let status: SyncStatus = {
  state: ONLINE_MODE ? 'idle' : 'offline',
  pending: 0,
  lastSyncedAt: null,
  lastError: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
};

const listeners = new Set<() => void>();

/** snapshot ต้องเป็น reference เดิมถ้าค่าไม่เปลี่ยน ไม่งั้น useSyncExternalStore จะวนไม่จบ */
export const getSyncStatus = () => status;

export function subscribeSync(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setStatus(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch };
  const same =
    next.state === status.state &&
    next.pending === status.pending &&
    next.lastSyncedAt === status.lastSyncedAt &&
    next.lastError === status.lastError &&
    next.online === status.online;
  if (same) return;
  status = next;
  listeners.forEach((fn) => fn());
}

/* ── ดึงข้อมูลจากเซิร์ฟเวอร์มาทับสำเนาในเครื่อง ───────────────────────── */

/**
 * @returns false เมื่อไม่ได้ทับ เพราะผู้ใช้เพิ่งบันทึกอะไรเข้าคิวระหว่างที่กำลังดึง
 *
 * ของที่ดึงมาเป็นภาพของเซิร์ฟเวอร์ "ก่อน" งานชิ้นนั้น ถ้าทับลงไปเลย งานที่ผู้ใช้เพิ่งกด
 * (เช่น กดรับทราบแล้วกดเริ่มแก้ไขต่อทันที) จะหายไปจากหน้าจอจนกว่ารอบซิงก์ถัดไปจะส่งขึ้น
 * ผู้เรียก (syncNow) จะส่งคิวขึ้นก่อนแล้วดึงใหม่อีกรอบ
 */
export async function pull(): Promise<boolean> {
  if (!ONLINE_MODE) return true;

  const [employees, areas, categories, rounds, issues, fixes, loginHistory, changeHistory, settings, lineHeads] =
    await Promise.all([
      apiGet<Employee[]>('/api/employees'),
      apiGet<Area[]>('/api/areas'),
      apiGet<DefectCategory[]>('/api/categories'),
      apiGet<QcRound[]>('/api/rounds?limit=5000'),
      apiGet<QcIssue[]>('/api/issues?limit=5000'),
      apiGet<IssueFix[]>('/api/fixes?limit=5000'),
      apiGet<LoginHistory[]>('/api/login-history'),
      apiGet<ChangeHistory[]>('/api/change-history?limit=1000'),
      apiGet<AppSettings>('/api/settings'),
      // Worker รุ่นก่อนหน้ายังไม่มีเส้นทางนี้ — ใช้ของในเครื่องไปก่อน อย่าให้ทั้งรอบซิงก์ล้ม
      apiGet<LineHead[]>('/api/line-heads').catch(() => peek((db) => db.line_heads ?? [])),
    ]);

  if ((await queueSize()) > 0) return false;

  // รอยล่าสุดของการเปลี่ยนแปลงที่เห็นแล้ว — ตัวเช็คทุกนาทีเทียบกับค่านี้ (ดู checkForChanges)
  lastMarker = changeHistory[0]?.id ?? null;

  hydrate({
    line_heads: lineHeads,
    employees,
    areas,
    defect_categories: categories,
    qc_rounds: rounds,
    qc_issues: issues,
    issue_fixes: fixes,
    login_history: loginHistory,
    // ประวัติการแก้ไขจากเซิร์ฟเวอร์ทับของในเครื่องได้ เพราะ syncNow() ส่งคิวขึ้นให้หมดก่อน
    // แล้วค่อยดึงลงมา ของที่เพิ่งบันทึกในเครื่องจึงถูกบันทึกฝั่งเซิร์ฟเวอร์ไปแล้ว
    // (ถ้าส่งไม่สำเร็จจะโยนออกไปตั้งแต่ pushAll ยังไม่ถึงบรรทัดนี้)
    // ทับแบบนี้เท่านั้นที่ทำให้ผู้ดูแลเห็นการแก้ไขของ "คนอื่น" ไม่ใช่แค่ของเครื่องตัวเอง
    change_history: changeHistory,
    app_settings: settings,
    // superusers เก็บของเดิมไว้ เพราะ API ไม่เปิดให้ดึงรายชื่อ (มีแค่ endpoint ตรวจรหัส)
    superusers: peek((db) => db.superusers),
  });
  return true;
}

/* ── ส่งงานที่ค้างขึ้นเซิร์ฟเวอร์ ───────────────────────────────────────── */

/**
 * อัปโหลดรูปที่ยังอยู่ในเครื่อง แล้วคืนคีย์ที่เซิร์ฟเวอร์ให้มา
 * คีย์ที่ไม่ได้ขึ้นต้นด้วย local: แปลว่าอัปโหลดไปแล้ว ปล่อยผ่าน
 */
async function uploadPendingPhotos(keys: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(LOCAL_PREFIX)) {
      out.push(key);
      continue;
    }
    const blob = await getPhotoBlob(key);
    if (!blob) continue; // รูปหายไปจากเครื่องแล้ว ข้ามไปไม่ให้ทั้งคิวค้าง
    out.push(await apiUpload(blob));
  }
  return out;
}

/**
 * ไฟล์แนบเดี่ยว (บันทึกเสียงของใบแจ้ง) — คืน null เมื่อไม่มีไฟล์หรืออัปโหลดไม่ขึ้น
 *
 * ⚠️ เสียงต้อง "ล้มแล้วไปต่อ" เสมอ ห้ามโยนข้อผิดพลาดของข้อมูลออกไปเด็ดขาด
 * เพราะ pushAll() ทิ้งงานทั้งชิ้นเมื่อเซิร์ฟเวอร์ตอบ 4xx ถ้าปล่อยให้โยน
 * เซิร์ฟเวอร์รุ่นเก่าที่ยังไม่รับไฟล์เสียงจะทำให้ "ทั้งใบแจ้ง" หายไปจากคิว
 * ทั้งที่เสียงเป็นแค่ของแถม — เสียใบแจ้งแย่กว่าเสียเสียงมาก
 *
 * ส่วนเน็ตหลุด/เซิร์ฟเวอร์ล่ม (offline หรือ 5xx) ยังต้องโยนออกไปเหมือนเดิม
 * เพื่อให้ทั้งรอบหยุดแล้วลองใหม่ ไม่ใช่ส่งใบแจ้งขึ้นไปโดยไม่มีเสียงถาวร
 */
async function uploadPendingMedia(key: unknown): Promise<string | null> {
  if (typeof key !== 'string' || key === '') return null;
  try {
    const [uploaded] = await uploadPendingPhotos([key]);
    return uploaded ?? null;
  } catch (e) {
    const err = e as ApiError;
    if (err.isOffline || err.status >= 500 || err.status === 401) throw err;
    console.warn('อัปโหลดบันทึกเสียงไม่สำเร็จ — ส่งใบแจ้งขึ้นไปโดยไม่มีเสียง', key, err.message);
    return null;
  }
}

/** ส่งงานหนึ่งชิ้น — โยน ApiError ออกไปให้ผู้เรียกตัดสินใจว่าจะหยุดหรือข้าม */
async function pushItem(item: QueueItem): Promise<void> {
  const p = item.payload as Record<string, unknown>;

  switch (item.kind) {
    case 'round.create': {
      // รอบตรวจกับใบแจ้งไปด้วยกันในคำขอเดียว ฝั่ง Worker เขียนทั้งคู่ใน batch เดียว
      const issue = p.issue as Record<string, unknown> | null;
      const body = { ...p };
      if (issue) {
        body.issue = {
          ...issue,
          photo_urls: await uploadPendingPhotos((issue.photo_urls as string[]) ?? []),
          voice_url: await uploadPendingMedia(issue.voice_url),
        };
      }
      await apiPost('/api/rounds', body);
      return;
    }

    case 'issue.create': {
      const photos = await uploadPendingPhotos((p.photo_urls as string[]) ?? []);
      await apiPost('/api/issues', {
        ...p,
        photo_urls: photos,
        voice_url: await uploadPendingMedia(p.voice_url),
      });
      return;
    }
    case 'issue.update': {
      const body = { ...p };
      if (Array.isArray(p.photo_urls)) body.photo_urls = await uploadPendingPhotos(p.photo_urls as string[]);
      if ('voice_url' in p) body.voice_url = await uploadPendingMedia(p.voice_url);
      await apiPut(`/api/issues/${item.localId}`, body);
      return;
    }

    case 'fix.create': {
      const photos = await uploadPendingPhotos((p.photo_urls as string[]) ?? []);
      await apiPost(`/api/issues/${p.issue_id}/fixes`, { ...p, photo_urls: photos });
      return;
    }
    case 'fix.verify':
      await apiPut(`/api/fixes/${item.localId}/verify`, p);
      return;

    case 'employee.save':
      await (item.localId.startsWith('new:')
        ? apiPost('/api/employees', p)
        : apiPut(`/api/employees/${item.localId}`, p));
      return;
    case 'area.save':
      await (item.localId.startsWith('new:') ? apiPost('/api/areas', p) : apiPut(`/api/areas/${item.localId}`, p));
      return;
    case 'category.save':
      await (item.localId.startsWith('new:')
        ? apiPost('/api/categories', p)
        : apiPut(`/api/categories/${item.localId}`, p));
      return;

    case 'lineheads.save':
      await apiPut(`/api/line-heads/${item.localId}`, p);
      return;

    case 'settings.save':
      await apiPut('/api/settings', p);
      return;
  }
}

/**
 * ส่งคิวทั้งหมดตามลำดับ
 *
 * เจอเน็ตหลุดให้หยุดทันที เก็บที่เหลือไว้รอบหน้า (ลำดับสำคัญ)
 * แต่ถ้าเซิร์ฟเวอร์ปฏิเสธเพราะข้อมูลผิด (4xx) ให้ทิ้งงานชิ้นนั้นแล้วไปต่อ
 * ไม่งั้นงานเสียชิ้นเดียวจะขวางคิวทั้งหมดตลอดไป
 */
async function pushAll(): Promise<{ sent: number; dropped: number }> {
  let sent = 0;
  let dropped = 0;

  for (const item of await listQueue()) {
    try {
      await pushItem(item);
      await removeFromQueue(item.seq!);
      sent++;
    } catch (e) {
      const err = e as ApiError;
      // 401 = เซสชันใช้ไม่ได้ ไม่ใช่ข้อมูลผิด — เก็บงานไว้ส่งหลังเข้าระบบใหม่ ห้ามทิ้ง
      if (err.isOffline || err.status >= 500 || err.status === 401) {
        await markFailed(item, err.message);
        throw err; // เน็ตหรือเซิร์ฟเวอร์มีปัญหา หยุดทั้งรอบ
      }
      // ข้อมูลชิ้นนี้เซิร์ฟเวอร์ไม่รับ — ทิ้งไปเพื่อไม่ให้ขวางคิว
      console.warn('ทิ้งงานที่ซิงก์ไม่ได้', item.kind, item.localId, err.message);
      await removeFromQueue(item.seq!);
      dropped++;
    }
  }
  return { sent, dropped };
}

/* ── รอบซิงก์ ───────────────────────────────────────────────────────────── */

let running = false;
/** มีคนสั่งซิงก์ระหว่างที่รอบก่อนยังวิ่งอยู่ — จบรอบแล้วให้วิ่งต่ออีกรอบทันที ไม่ต้องรอนาทีถัดไป */
let rerun = false;
/** ให้ TanStack Query รู้ว่าข้อมูลเปลี่ยน จะได้โหลดหน้าจอใหม่ */
let onChanged: (() => void) | null = null;

export function setSyncListener(fn: () => void) {
  onChanged = fn;
}

/** ซิงก์หนึ่งรอบ: ส่งของค้างขึ้นก่อน แล้วค่อยดึงของใหม่ลงมา */
export async function syncNow(): Promise<void> {
  // ยังไม่ได้เข้าระบบ — ทุกเส้นทางต้องมีเซสชัน ยิงไปก็ได้ 401 เปล่า ๆ
  if (!ONLINE_MODE || !authToken()) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setStatus({ state: 'syncing', lastError: null });

  try {
    let sent = 0;
    // ผู้ใช้บันทึกเพิ่มระหว่างดึง → ส่งของใหม่ขึ้นแล้วดึงอีกรอบ (จำกัดไว้ 3 รอบ ที่เหลือไปรอบหน้า)
    for (let round = 0; round < 3; round++) {
      sent += (await pushAll()).sent;
      if (await pull()) break;
      if (round === 2) rerun = true;
    }
    setStatus({
      state: 'idle',
      pending: await queueSize(),
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      online: true,
    });
    if (sent > 0 || onChanged) onChanged?.();
  } catch (e) {
    const err = e as ApiError;
    const pending = await queueSize();
    setStatus({
      state: err.isOffline ? 'offline' : 'error',
      pending,
      lastError: err.message,
      online: err.isOffline ? false : status.online,
    });
  } finally {
    running = false;
    if (status.state === 'idle' && status.pending > 0) setStatus({ state: 'pending' });
    // เน็ตหลุดไม่ต้องวนซ้ำทันที — ตัวจับเวลาทุกนาทีจะลองใหม่เอง
    if (rerun && status.state !== 'offline' && status.state !== 'error') {
      rerun = false;
      void syncNow();
    }
  }
}

/** เรียกหลังเขียนข้อมูลลงคิว เพื่ออัปเดตตัวเลขที่ยังไม่ซิงก์ให้เห็นทันที */
export async function refreshPending(): Promise<void> {
  const pending = await queueSize();
  setStatus({ pending, state: pending > 0 && status.state === 'idle' ? 'pending' : status.state });
}

let started = false;

/** เริ่มระบบซิงก์ — เรียกครั้งเดียวตอนแอปบูต */
export function startSync(): void {
  if (started || !ONLINE_MODE) return;
  started = true;

  window.addEventListener('online', () => {
    setStatus({ online: true });
    void syncNow();
  });
  window.addEventListener('offline', () => setStatus({ online: false, state: 'offline' }));

  // กลับมาที่แท็บแล้วซิงก์ให้อัตโนมัติ
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });

  // ลองส่งของค้างเป็นระยะ เผื่อสัญญาณกลับมาโดยที่เบราว์เซอร์ไม่แจ้ง event
  // ถ้าไม่มีของค้าง ให้ถามแค่ว่ามีอะไรใหม่ไหม — งานที่ QC เพิ่งเปิดจะได้เด้งถึง VSM ภายในนาทีเดียว
  setInterval(() => {
    if (status.pending > 0 || status.state === 'offline' || status.state === 'error') void syncNow();
    else void checkForChanges();
  }, 60_000);

  void syncNow();
}

/** id ของประวัติการแก้ไขล่าสุดที่ดึงมาแล้ว — null = ยังไม่เคยดึง */
let lastMarker: string | null = null;

/**
 * ถามเซิร์ฟเวอร์ว่ามีการเปลี่ยนแปลงใหม่ไหม (อ่านแถวเดียว) แล้วค่อยซิงก์เต็มเมื่อมีจริง
 *
 * ถ้าซิงก์เต็มทุกนาที แต่ละเครื่องจะอ่าน D1 หลายพันแถวต่อนาที
 * ซึ่งทั้งโรงงานรวมกันเกินโควตาการอ่านรายวันได้ง่าย ๆ
 */
async function checkForChanges(): Promise<void> {
  if (!ONLINE_MODE || running || !authToken()) return;
  try {
    const latest = await apiGet<{ id: string | null }>('/api/changes/latest');
    if (latest.id !== lastMarker) await syncNow();
  } catch {
    // Worker รุ่นเก่าไม่มีเส้นทางนี้ หรือเน็ตหลุด — รอบหน้าค่อยลองใหม่ ไม่ต้องเตือนใคร
  }
}
