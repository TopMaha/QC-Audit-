/**
 * ฟังก์ชันวันที่ทั้งหมดของระบบ — โซนเวลา Asia/Bangkok, สัปดาห์เริ่มวันอาทิตย์
 * ห้ามใช้ new Date() ตรง ๆ ในหน้าจอเพื่อคำนวณวันที่ ให้เรียกผ่านไฟล์นี้เสมอ
 */
export const TZ = 'Asia/Bangkok';

/** วันที่รูปแบบ YYYY-MM-DD */
export type ISODate = string;
export type Lang = 'th' | 'en';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** วันนี้ตามเวลาไทย */
export function todayISO(): ISODate {
  return dateFmt.format(new Date());
}

/** เวลาปัจจุบัน HH:mm ตามเวลาไทย */
export function nowHHMM(): string {
  return timeFmt.format(new Date());
}

/** timestamp เต็มสำหรับบันทึกลงฐานข้อมูล */
export function nowStamp(): string {
  return new Date().toISOString();
}

/** แปลง ISODate เป็น Date (ตรึงเที่ยงคืน UTC เพื่อไม่ให้โซนเวลาเลื่อนวัน) */
export function toDate(iso: ISODate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function addMonths(iso: ISODate, n: number): ISODate {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toISO(d);
}

/** 0 = อาทิตย์ … 6 = เสาร์ */
export function weekdayIndex(iso: ISODate): number {
  return toDate(iso).getUTCDay();
}

/** ต้นสัปดาห์ = วันอาทิตย์ */
export function startOfWeek(iso: ISODate): ISODate {
  return addDays(iso, -weekdayIndex(iso));
}
export function endOfWeek(iso: ISODate): ISODate {
  return addDays(startOfWeek(iso), 6);
}
export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}
export function endOfMonth(iso: ISODate): ISODate {
  const d = toDate(iso);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export function rangeDays(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; diffDays(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export function inRange(iso: ISODate, from: ISODate, to: ISODate): boolean {
  return iso >= from && iso <= to;
}

export function isToday(iso: ISODate): boolean {
  return iso === todayISO();
}
export function isPast(iso: ISODate): boolean {
  return iso < todayISO();
}
export function isFuture(iso: ISODate): boolean {
  return iso > todayISO();
}

/** 'YYYY-MM' */
export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_TH_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_EN_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const DOW_TH_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** ปี พ.ศ. สำหรับภาษาไทย, ค.ศ. สำหรับอังกฤษ */
export function yearLabel(iso: ISODate, lang: Lang): number {
  const y = Number(iso.slice(0, 4));
  return lang === 'th' ? y + 543 : y;
}

/** เช่น '18 ส.ค. 69' / '18 Aug 2026' */
export function formatDate(iso: ISODate, lang: Lang, opts?: { full?: boolean; noYear?: boolean }): string {
  const d = Number(iso.slice(8, 10));
  const m = Number(iso.slice(5, 7)) - 1;
  const months = lang === 'th' ? (opts?.full ? MONTHS_TH_FULL : MONTHS_TH) : opts?.full ? MONTHS_EN_FULL : MONTHS_EN;
  if (opts?.noYear) return `${d} ${months[m]}`;
  const y = yearLabel(iso, lang);
  return `${d} ${months[m]} ${lang === 'th' && !opts?.full ? String(y).slice(2) : y}`;
}

export function formatMonth(key: string, lang: Lang, full = false): string {
  const m = Number(key.slice(5, 7)) - 1;
  const months = lang === 'th' ? (full ? MONTHS_TH_FULL : MONTHS_TH) : full ? MONTHS_EN_FULL : MONTHS_EN;
  return `${months[m]} ${yearLabel(`${key}-01`, lang)}`;
}

export function formatWeekday(iso: ISODate, lang: Lang, full = false): string {
  const i = weekdayIndex(iso);
  if (lang === 'en') return DOW_EN[i];
  return full ? DOW_TH_FULL[i] : DOW_TH[i];
}

export function dowLabels(lang: Lang): string[] {
  return lang === 'th' ? DOW_TH : DOW_EN;
}

export function formatRange(from: ISODate, to: ISODate, lang: Lang): string {
  return `${formatDate(from, lang, { noYear: true })} – ${formatDate(to, lang)}`;
}

/** 'วันนี้' / 'พรุ่งนี้' / '3 วันที่แล้ว' */
export function relativeDay(iso: ISODate, lang: Lang): string {
  const n = diffDays(todayISO(), iso);
  if (n === 0) return lang === 'th' ? 'วันนี้' : 'Today';
  if (n === 1) return lang === 'th' ? 'พรุ่งนี้' : 'Tomorrow';
  if (n === -1) return lang === 'th' ? 'เมื่อวาน' : 'Yesterday';
  if (n > 0) return lang === 'th' ? `อีก ${n} วัน` : `in ${n} days`;
  return lang === 'th' ? `${-n} วันที่แล้ว` : `${-n} days ago`;
}

/** สัปดาห์ทั้งหมดที่คาบเกี่ยวกับเดือน (อิงวันอาทิตย์) */
export function weeksOfMonth(key: string): { start: ISODate; end: ISODate }[] {
  const first = `${key}-01`;
  const last = endOfMonth(first);
  const out: { start: ISODate; end: ISODate }[] = [];
  for (let s = startOfWeek(first); s <= last; s = addDays(s, 7)) {
    out.push({ start: s, end: addDays(s, 6) });
  }
  return out;
}

/** ตารางปฏิทิน 6 แถว × 7 วัน ของเดือนที่ระบุ */
export function calendarGrid(key: string): ISODate[] {
  const start = startOfWeek(`${key}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** เวลา HH:mm -> นาที (ใช้เรียงลำดับ) */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
