import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * คำนำหน้าชื่อ — ต้องตัดทิ้งก่อนย่อชื่อ ไม่งั้นวงกลมย่อชื่อจะขึ้น "น" เหมือนกันเกือบทุกคน
 * เรียงจากยาวไปสั้น เพราะ "นางสาว" ต้องถูกจับก่อน "นาง"
 */
const TITLES = ['ว่าที่ ร.ต.', 'ว่าที่ร.ต.', 'นางสาว', 'น.ส.', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.', 'Mr.', 'Mrs.', 'Ms.'];

export function initials(name: string): string {
  let clean = name.trim();
  for (const t of TITLES) {
    if (clean.startsWith(t)) {
      clean = clean.slice(t.length).trim();
      break;
    }
  }
  const parts = (clean || name.trim()).split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? '') + (parts[1][0] ?? '');
}

/**
 * ทำรหัสให้อยู่ในรูปมาตรฐานก่อนเทียบ
 *
 * รหัสพนักงานมีขีดกลางและตัวพิมพ์ใหญ่ (เช่น A-123 · ABC123) แต่คนหน้างานพิมพ์บนมือถือ
 * มักได้ 't815' หรือ 't 815' ออกมา ถ้าเทียบตรง ๆ จะเข้าระบบไม่ได้ทั้งที่รหัสถูก
 * ตรวจแล้วว่ารหัสทั้ง 393 ตัวไม่ชนกันเลยเมื่อตัดขีดกลางและตัวพิมพ์ออก
 */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function pct(actual: number, plan: number): number {
  if (!plan) return 0;
  return Math.round((actual / plan) * 100);
}
