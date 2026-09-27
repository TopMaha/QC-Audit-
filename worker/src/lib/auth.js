/**
 * เซสชัน
 *
 * เข้าระบบด้วยรหัสพนักงาน (ไม่มี PIN) แล้ว Worker ออกโทเคนเซสชันให้ ทุกคำขอหลังจากนั้นต้องแนบโทเคนนี้
 * (header X-Session) Worker จึงรู้ว่าใครทำอะไรจากโทเคน ไม่ใช่จากรหัสที่เครื่องบอกมาเอง
 * ในฐานข้อมูลเก็บแค่ค่าแฮชของโทเคน ฐานข้อมูลหลุดก็เอาไปสวมเซสชันไม่ได้
 */

const enc = new TextEncoder();

/** อายุเซสชัน — ใช้งานอยู่เรื่อย ๆ จะต่ออายุให้เอง คนที่หายไปนานต้องเข้าระบบใหม่ */
export const SESSION_DAYS = 60;

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
