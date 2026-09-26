/**
 * คิวรอซิงก์ — เก็บใน IndexedDB เพราะต้องอยู่รอดแม้ปิดเบราว์เซอร์หรือแบตหมด
 *
 * ในโรงงานสัญญาณมักไม่ถึง ผู้ใช้จึงต้องบันทึกงานได้เสมอ
 * ทุกการเขียนจะถูกใส่คิวที่นี่ก่อน แล้วค่อยส่งขึ้นเซิร์ฟเวอร์เมื่อกลับมาออนไลน์
 *
 * ใช้ฐาน IndexedDB คนละตัวกับรูปภาพ (qc-photos) เพื่อไม่ให้ชนกัน
 */

const DB_NAME = 'qc-sync';
const STORE = 'queue';

export type QueueKind =
  | 'round.create'
  | 'issue.create' | 'issue.update'
  | 'fix.create' | 'fix.verify'
  | 'employee.save' | 'area.save' | 'category.save'
  | 'lineheads.save'
  | 'settings.save';

export interface QueueItem {
  /** เลขลำดับอัตโนมัติ — ใช้เป็นลำดับการส่งด้วย ของเก่าต้องไปก่อนเสมอ */
  seq?: number;
  kind: QueueKind;
  /** id ที่ฝั่งเครื่องสร้างไว้ก่อน ใช้จับคู่กับของจริงหลังซิงก์ */
  localId: string;
  payload: unknown;
  createdAt: string;
  /** จำนวนครั้งที่ลองส่งแล้วไม่สำเร็จ */
  tries: number;
  lastError?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // ฐานมีอยู่แล้วแต่ไม่มีตารางที่ต้องใช้ (เช่นถูกสร้างค้างไว้ด้วยเวอร์ชันเดียวกัน)
      // ยกเวอร์ชันขึ้นเพื่อบังคับให้ onupgradeneeded ทำงานและสร้างตารางให้
      if (!db.objectStoreNames.contains(STORE)) {
        const version = db.version + 1;
        db.close();
        const retry = indexedDB.open(DB_NAME, version);
        retry.onupgradeneeded = () => {
          if (!retry.result.objectStoreNames.contains(STORE)) {
            retry.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
          }
        };
        retry.onsuccess = () => resolve(retry.result);
        retry.onerror = () => reject(retry.error);
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** ใส่งานเข้าคิว คืนเลขลำดับที่ได้ */
export async function enqueue(item: Omit<QueueItem, 'seq' | 'createdAt' | 'tries'>): Promise<number> {
  const full: Omit<QueueItem, 'seq'> = { ...item, createdAt: new Date().toISOString(), tries: 0 };
  return (await tx<IDBValidKey>('readwrite', (s) => s.add(full))) as number;
}

/** อ่านคิวทั้งหมด เรียงตามลำดับที่ใส่เข้ามา */
export async function listQueue(): Promise<QueueItem[]> {
  const all = await tx<QueueItem[]>('readonly', (s) => s.getAll() as IDBRequest<QueueItem[]>);
  return all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export async function queueSize(): Promise<number> {
  return tx<number>('readonly', (s) => s.count());
}

export async function removeFromQueue(seq: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(seq));
}

/** บันทึกว่าส่งไม่สำเร็จ เพื่อให้แสดงสาเหตุและนับจำนวนครั้งได้ */
export async function markFailed(item: QueueItem, error: string): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...item, tries: item.tries + 1, lastError: error }));
}

export async function clearQueue(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}
