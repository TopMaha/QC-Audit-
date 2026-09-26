/**
 * PIN และเซสชัน
 *
 * รหัสพนักงานเดาได้ จึงเป็นแค่ "ชื่อผู้ใช้" — ตัวยืนยันตัวตนคือ PIN 6 หลักที่แต่ละคนตั้งเอง
 * เข้าระบบสำเร็จแล้ว Worker ออกโทเคนเซสชันให้ ทุกคำขอหลังจากนั้นต้องแนบโทเคนนี้
 * (header X-Session) Worker จึงรู้ว่าใครทำอะไรจากโทเคน ไม่ใช่จากรหัสที่เครื่องบอกมาเอง
 *
 * ค่าที่ต้องตั้ง: PIN_PEPPER (secret) — ใช้เป็นกุญแจ HMAC ของค่าแฮช PIN
 * PIN มีแค่ล้านแบบ ถ้าฐานข้อมูลหลุด แฮชช้าแค่ไหนก็ไล่เดาได้ในไม่กี่นาที
 * pepper ที่อยู่นอกฐานข้อมูลทำให้ไล่เดาไม่ได้เลยถ้าไม่มี secret ตัวนี้
 */

const enc = new TextEncoder();

/** อายุเซสชัน — ใช้งานอยู่เรื่อย ๆ จะต่ออายุให้เอง คนที่หายไปนานต้องเข้าระบบใหม่ */
export const SESSION_DAYS = 60;
/** กรอก PIN ผิดติดกันเท่านี้ครั้ง บัญชีถูกล็อกชั่วคราว */
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 15;

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

let hmacKey = null;
let hmacFor = null;

async function pepperKey(env) {
  if (!env.PIN_PEPPER) throw new Error('PIN_PEPPER is not configured');
  if (hmacFor !== env.PIN_PEPPER) {
    hmacKey = await crypto.subtle.importKey('raw', enc.encode(env.PIN_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacFor = env.PIN_PEPPER;
  }
  return hmacKey;
}

export async function hashPin(env, employeeId, salt, pin) {
  return hex(await crypto.subtle.sign('HMAC', await pepperKey(env), enc.encode(`${employeeId}:${salt}:${pin}`)));
}

/** เทียบแบบใช้เวลาคงที่ กันการเดาจากเวลาตอบกลับ */
export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * PIN ที่ยอมรับ — 6 หลัก และไม่ใช่แบบที่คนเดาเป็นอย่างแรก
 * คืนข้อความเหตุผลเมื่อไม่ผ่าน (ภาษาไทย แสดงบนหน้าจอได้เลย) หรือ null เมื่อใช้ได้
 */
export function weakPinReason(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return 'PIN ต้องเป็นตัวเลข 6 หลัก';
  if (/^(\d)\1{5}$/.test(pin)) return 'PIN ห้ามเป็นเลขซ้ำกันทั้งหมด';
  const up = '0123456789012345';
  const down = '9876543210987654';
  if (up.includes(pin) || down.includes(pin)) return 'PIN ห้ามเป็นเลขเรียงกัน';
  return null;
}

export function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
