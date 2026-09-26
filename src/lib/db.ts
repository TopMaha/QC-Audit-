import { buildSeedDb } from './seed';
import type { Db } from './types';

/**
 * ── ชั้นเก็บข้อมูล (Data layer) ───────────────────────────────
 * เวอร์ชันนี้เก็บลง localStorage ของเครื่อง เพื่อให้แอปใช้งานได้จริงทันที
 * โดยยังไม่ต้องต่อระบบหลังบ้าน โครงตารางตรงตาม src/lib/types.ts ทุกคอลัมน์
 *
 * หน้าจอทุกหน้าอ่าน–เขียนที่นี่เท่านั้น ไม่ยิง HTTP เอง
 * การส่งขึ้นเซิร์ฟเวอร์เป็นหน้าที่ของ src/lib/sync.ts ทั้งหมด
 */

/**
 * การเปลี่ยนเลขนี้ทำให้เครื่องที่ยังค้างสำเนาชุดเก่าเริ่มใหม่จากทะเบียนตั้งต้น
 * ต้องขึ้นเลขทุกครั้งที่โครงข้อมูลเปลี่ยนจนอ่านของเดิมไม่ได้
 */
const KEY = 'qc.db.v2';
/**
 * v1 เก็บทะเบียนพนักงานทั้งโรงงาน (รวมรหัสผู้ดูแลระบบ) ไว้ตั้งแต่ก่อนเข้าระบบ — ลบทิ้งทุกเครื่อง
 * v2 เริ่มว่าง แล้วเติมจากเซิร์ฟเวอร์หลังเข้าสู่ระบบด้วย PIN เท่านั้น
 */
const LEGACY_KEYS: string[] = ['qc.db.v1'];
const LATENCY = 80; // จำลองดีเลย์เครือข่าย เพื่อให้เห็น loading state จริง

let cache: Db | null = null;
const listeners = new Set<() => void>();

function fresh(): Db {
  for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  const db = buildSeedDb();
  localStorage.setItem(KEY, JSON.stringify(db));
  return db;
}

function read(): Db {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Db) : fresh();
  } catch {
    cache = fresh();
  }
  return cache;
}

function persist() {
  if (cache) localStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((fn) => fn());
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** อ่านข้อมูล (async เพื่อให้พฤติกรรมเหมือนเรียก API จริง) */
export async function query<T>(fn: (db: Db) => T): Promise<T> {
  await sleep(LATENCY);
  return structuredClone(fn(read()));
}

/** อ่านแบบทันที ใช้เฉพาะกรณีที่ต้องใช้ค่าใน render loop */
export function peek<T>(fn: (db: Db) => T): T {
  return fn(read());
}

/** เขียนข้อมูล */
export async function mutate<T>(fn: (db: Db) => T): Promise<T> {
  await sleep(LATENCY);
  const db = read();
  const result = fn(db);
  persist();
  return structuredClone(result);
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** ล้างสำเนาในเครื่องแล้วเริ่มใหม่จากทะเบียนตั้งต้น (ไม่กระทบข้อมูลบนเซิร์ฟเวอร์) */
export async function resetDb() {
  localStorage.removeItem(KEY);
  cache = null;
  read();
  persist();
}

/** ล้างงานตรวจทั้งหมด แต่เก็บผู้ใช้/พื้นที่/ประเภทไว้ (ใช้ตอนขึ้นระบบจริง) */
export async function clearTransactions() {
  return mutate((db) => {
    db.qc_rounds = [];
    db.qc_issues = [];
    db.issue_fixes = [];
    db.change_history = [];
  });
}

export async function exportDb(): Promise<string> {
  return JSON.stringify(read(), null, 2);
}

/**
 * ทับสำเนาในเครื่องด้วยข้อมูลจากเซิร์ฟเวอร์ (ใช้โดย src/lib/sync.ts)
 * เขียนทับเฉพาะตารางที่ส่งมา ตารางอื่นคงของเดิมไว้
 */
export function hydrate(patch: Partial<Db>) {
  const db = read();
  cache = { ...db, ...patch };
  persist();
}

export async function importDb(json: string) {
  const parsed = JSON.parse(json) as Db;
  if (!parsed.employees || !parsed.areas) throw new Error('ไฟล์ข้อมูลไม่ถูกต้อง');
  cache = parsed;
  persist();
}
