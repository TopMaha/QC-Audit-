/**
 * ธีมสี + โหมดสว่าง/มืด — เก็บค่าที่เลือกไว้ในเครื่อง
 *
 * สีหลักล็อกไว้ที่น้ำเงินแบรนด์ TENNECO (ดู src/index.css) ไม่มีให้เลือกสีอื่นแล้ว
 * เหลือให้ผู้ใช้สลับได้แค่โหมดสว่าง/มืด — ค่าเริ่มต้นคือสว่าง (น้ำเงิน–ขาว) ทุกเครื่อง
 * ไม่ตามโหมดมืดของมือถือ กะดึกที่ชอบมืดกดสลับเองที่หัวแอป แล้วเครื่องจะจำไว้
 */

export type Mode = 'light' | 'dark';

/** เก็บเฉพาะตอนผู้ใช้กดสลับเอง */
const MODE_KEY = 'qc.theme';
/**
 * คีย์รุ่นก่อน — ลบทิ้งตอนบูต
 * qc.mode ถูกบันทึกทุกครั้งที่เปิดแอปตามโหมดของมือถือ ถ้าอ่านต่อ เครื่องที่ตั้งมืดไว้จะไม่ได้ธีมสว่างเริ่มต้น
 */
const LEGACY_KEYS = ['qc.mode', 'qc.accent'];

export function getMode(): Mode {
  return localStorage.getItem(MODE_KEY) === 'dark' ? 'dark' : 'light';
}

export function applyTheme(mode: Mode = getMode()) {
  const root = document.documentElement;
  root.classList.remove('theme-steel', 'theme-lime');
  root.classList.toggle('dark', mode === 'dark');
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  // แถบสถานะของมือถือให้กลืนกับแถบหัวแอป
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'dark' ? '#13203f' : '#253f94');
}

/** ผู้ใช้กดสลับโหมดเอง — ใช้ทันทีและจำไว้ในเครื่อง */
export function setMode(mode: Mode) {
  localStorage.setItem(MODE_KEY, mode);
  applyTheme(mode);
}

/** สีประจำตัวจาก id (ใช้กับ avatar และแท็ก) */
export function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
