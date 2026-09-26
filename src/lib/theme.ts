/**
 * ธีมสี + โหมดสว่าง/มืด — เก็บค่าที่เลือกไว้ในเครื่อง
 *
 * สีหลักล็อกไว้ที่น้ำเงินแบรนด์ TENNECO (ดู src/index.css) ไม่มีให้เลือกสีอื่นแล้ว
 * เหลือให้ผู้ใช้สลับได้แค่โหมดสว่าง/มืด — หน้าไลน์กลางวันใช้สว่าง กะดึกบางคนชอบมืด
 */

export type Mode = 'light' | 'dark';

const MODE_KEY = 'qc.mode';
/** คีย์ของตัวเลือกสีรุ่นก่อน — ลบทิ้งตอนบูตเพื่อไม่ให้ค้างอยู่ในเครื่อง */
const LEGACY_ACCENT_KEY = 'qc.accent';

export function getMode(): Mode {
  const v = localStorage.getItem(MODE_KEY);
  if (v === 'dark' || v === 'light') return v;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: Mode = getMode()) {
  const root = document.documentElement;
  root.classList.remove('theme-steel', 'theme-lime');
  root.classList.toggle('dark', mode === 'dark');
  localStorage.setItem(MODE_KEY, mode);
  localStorage.removeItem(LEGACY_ACCENT_KEY);
  // แถบสถานะของมือถือให้กลืนกับแถบหัวแอป
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'dark' ? '#13203f' : '#253f94');
}

/** สีประจำตัวจาก id (ใช้กับ avatar และแท็ก) */
export function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
