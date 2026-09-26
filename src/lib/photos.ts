/**
 * ไฟล์แนบ (รูปหลักฐาน + บันทึกเสียง) — บีบอัดรูปในเครื่องก่อนเก็บ
 * เพื่อประหยัดพื้นที่และเน็ตของผู้ใช้
 * เก็บไฟล์จริงไว้ใน IndexedDB (แทน storage bucket ของหลังบ้าน)
 * ค่าที่บันทึกลงเรคคอร์ดคือคีย์รูปแบบ 'local:<id>'
 *
 * รูปกับเสียงใช้คลังเดียวกันโดยตั้งใจ — ชนิดไฟล์อยู่ใน blob.type อยู่แล้ว
 * ตัวซิงก์และตัวแสดงผลจึงไม่ต้องแยกสองทาง
 */

import { apiFetchPhoto } from './net';

const DB_NAME = 'qc-photos';
const STORE = 'photos';
const PREFIX = 'local:';

/** คีย์ที่ขึ้นต้นด้วยค่านี้คือรูปที่ยังอยู่แค่ในเครื่อง ยังไม่ได้อัปโหลดขึ้น R2 */
export const LOCAL_PREFIX = PREFIX;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** บีบอัดรูป: ย่อด้านยาวสุดไม่เกิน maxDim และแปลงเป็น JPEG */
export async function compressImage(file: File, maxDim = 1400, quality = 0.72): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality),
  );
}

function newKey(): string {
  return `${PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** เก็บ blob ลงคลังในเครื่อง คืนคีย์ที่ใช้อ้างถึงมัน */
async function putBlob(blob: Blob): Promise<string> {
  const key = newKey();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return key;
}

export async function savePhoto(file: File): Promise<string> {
  return putBlob(await compressImage(file));
}

/**
 * เก็บไฟล์เสียงที่อัดจากหน้างาน — ใช้คลังและคีย์แบบเดียวกับรูปโดยตั้งใจ
 * ตัวซิงก์ (uploadPendingPhotos) จึงอัปโหลดให้เองโดยไม่ต้องรู้ว่าเป็นเสียงหรือรูป
 * เสียงไม่ต้องบีบอัดซ้ำ เพราะ MediaRecorder เข้ารหัส opus/aac มาให้แล้ว
 */
export async function saveAudio(blob: Blob): Promise<string> {
  return putBlob(blob);
}

const urlCache = new Map<string, string>();

export async function photoUrl(key: string): Promise<string | null> {
  if (urlCache.has(key)) return urlCache.get(key)!;

  // คีย์ที่ไม่ใช่ของในเครื่อง = อยู่บน R2 ต้องดึงผ่าน API เพราะต้องแนบโทเคน
  // (ใส่ใน <img src> ตรง ๆ ไม่ได้ เบราว์เซอร์ไม่ส่ง header ให้)
  if (!key.startsWith(PREFIX)) {
    const remote = await apiFetchPhoto(key);
    if (!remote) return null;
    const remoteUrl = URL.createObjectURL(remote);
    urlCache.set(key, remoteUrl);
    return remoteUrl;
  }

  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

/** อ่านไฟล์รูปจากเครื่อง — ใช้ตอนซิงก์เพื่ออัปโหลดขึ้น R2 */
export async function getPhotoBlob(key: string): Promise<Blob | null> {
  if (!key.startsWith(PREFIX)) return null;
  const db = await openDb();
  return new Promise<Blob | null>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

/**
 * อ่านไฟล์รูปได้ทั้งที่ยังอยู่ในเครื่องและที่ขึ้น R2 แล้ว — ใช้ตอนใส่รูปลงไฟล์ Excel
 * (getPhotoBlob อ่านได้แค่ของในเครื่อง เพราะตัวซิงก์ต้องการเฉพาะของที่ยังไม่อัปโหลด)
 */
export async function readPhotoBlob(key: string): Promise<Blob | null> {
  if (key.startsWith(PREFIX)) return getPhotoBlob(key);
  return apiFetchPhoto(key);
}

export async function deletePhoto(key: string) {
  const cached = urlCache.get(key);
  if (cached) {
    URL.revokeObjectURL(cached);
    urlCache.delete(key);
  }
  if (!key.startsWith(PREFIX)) return;
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
