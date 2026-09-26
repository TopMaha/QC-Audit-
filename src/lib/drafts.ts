import type { ISODate } from './time';
import type { Severity, Shift, VsmLine } from './types';

/**
 * ── ร่างที่ยังไม่ได้บันทึก ─────────────────────────────────
 *
 * หน้าบันทึกผลตรวจมีฟิลด์เยอะและ QC กรอกทีละอย่างระหว่างเดินไลน์
 * ถ้ามีสายเข้า สลับแอปไปดูอย่างอื่น หรือเบราว์เซอร์บนมือถือคืนหน่วยความจำ
 * ทั้งหน้าจะถูกสร้างใหม่และสิ่งที่กรอกไว้หายหมด — ต้องเดินกลับไปดูของจริงอีกรอบ
 *
 * ไฟล์นี้เก็บสิ่งที่กรอกค้างไว้ลง localStorage เป็นระยะ แล้วคืนให้เมื่อกลับเข้ามา
 *
 * เก็บเฉพาะ "คีย์" ของรูปและเสียง ไม่ใช่ตัวไฟล์ — ไฟล์จริงอยู่ใน IndexedDB
 * (ดู src/lib/photos.ts) ซึ่งอยู่รอดข้ามการปิดแอปอยู่แล้ว ร่างจึงเล็กมาก
 *
 * ⚠️ ร่างไม่ใช่ข้อมูลที่บันทึกแล้ว ไม่มีการซิงก์ขึ้นเซิร์ฟเวอร์ และไม่นับในรายงานใด ๆ
 * ทันทีที่ผู้ใช้กดบันทึกสำเร็จ ร่างจะถูกลบทิ้ง
 */

export interface InspectDraft {
  /** เวลาที่บันทึกร่างครั้งล่าสุด — เอาไปบอกผู้ใช้ว่าค้างไว้ตั้งแต่เมื่อไร */
  savedAt: string;
  date: ISODate;
  time: string;
  areaId: string | null;
  vsm: VsmLine | null;
  qtyChecked: string;
  note: string;
  shift: Shift | null;
  /** ผู้ใช้เลือกกะเองแล้วหรือยัง — ถ้าเลือกแล้วห้ามให้เวลาที่เปลี่ยนไปทับค่า */
  shiftTouched: boolean;
  machineNo: string;
  modelNo: string;
  operatorId: string | null;
  foundIssue: boolean;
  categoryIds: string[];
  severity: Severity;
  partNo: string;
  lotNo: string;
  qtyDefect: string;
  description: string;
  photos: string[];
  voice: string | null;
  dueDate: string;
  dueTouched: boolean;
}

const PREFIX = 'qc.draft.';

/**
 * หนึ่งร่างต่อหนึ่งโหมดต่อหนึ่งคน
 *
 * แยกตามคนเพราะเครื่องหนึ่งเครื่องถูกใช้ต่อ ๆ กันหลายกะ ร่างของคนก่อนหน้า
 * ต้องไม่โผล่มาให้คนถัดไปเห็น (และเผลอกดบันทึกในนามตัวเอง)
 * แยกตามโหมดเพราะบันทึกรอบตรวจกับแจ้งนอกรอบเป็นงานคนละใบ กรอกค้างพร้อมกันได้
 */
export function draftKey(mode: 'round' | 'adhoc', who: string | null | undefined): string {
  return `${PREFIX}${mode}.${who || 'admin'}`;
}

export function loadDraft(key: string): InspectDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as InspectDraft;
    // ร่างที่โครงสร้างไม่ตรง (มาจากเวอร์ชันเก่า) ทิ้งไปเงียบ ๆ ดีกว่าทำหน้าจอพัง
    return d && typeof d === 'object' && typeof d.savedAt === 'string' ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: Omit<InspectDraft, 'savedAt'>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // พื้นที่เต็มหรือโหมดส่วนตัว — ร่างเป็นของแถม ไม่ควรทำให้การกรอกงานสะดุด
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* เช่นเดียวกับด้านบน */
  }
}

/**
 * ร่างนี้มีอะไรที่ผู้ใช้กรอกไว้จริงหรือยัง
 *
 * วันที่/เวลา/ความรุนแรงมีค่าตั้งต้นอยู่แล้วจึงไม่นับ ไม่งั้นแค่เปิดหน้าทิ้งไว้
 * ก็จะขึ้นแถบ "กู้ร่างคืนแล้ว" ทั้งที่ยังไม่ได้พิมพ์อะไรเลย
 */
export function hasContent(d: InspectDraft): boolean {
  return Boolean(
    d.areaId ||
      d.qtyChecked ||
      d.note.trim() ||
      d.machineNo.trim() ||
      d.modelNo.trim() ||
      d.operatorId ||
      d.categoryIds.length ||
      d.partNo.trim() ||
      d.lotNo.trim() ||
      d.qtyDefect ||
      d.description.trim() ||
      d.photos.length ||
      d.voice,
  );
}

/** คีย์ไฟล์แนบทั้งหมดในร่าง — ใช้ลบไฟล์ที่ไม่มีใครอ้างถึงแล้วตอนผู้ใช้ทิ้งร่าง */
export function draftAttachments(d: InspectDraft): string[] {
  return d.voice ? [...d.photos, d.voice] : [...d.photos];
}
