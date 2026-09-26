/**
 * การแจ้งเตือนแบบเด้ง (Web Push) ฝั่งเครื่องผู้ใช้
 *
 * เครื่องสมัครรับกับบริการ push ของเบราว์เซอร์ แล้วส่งที่อยู่ไปเก็บที่ Worker
 * เมื่อมีงานเข้า Worker ยิงข้อความมาที่เครื่องนี้ตรง ๆ (ดู worker/src/lib/push.js)
 * service worker (public/sw.js) เป็นคนโชว์การแจ้งเตือน จึงเด้งได้แม้ปิดแอปไปแล้ว
 *
 * ข้อจำกัดของแพลตฟอร์ม
 *   Android Chrome  ได้ทันที
 *   iPhone/iPad     ต้อง "เพิ่มลงหน้าจอโฮม" แล้วเปิดจากไอคอนก่อน (iOS 16.4 ขึ้นไป)
 */

import { ONLINE_MODE } from './config';
import { apiGet, apiPost } from './net';

export type PushState = 'local' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

export class PushError extends Error {
  constructor(public reason: 'denied' | 'notConfigured' | 'failed', message?: string) {
    super(message ?? reason);
  }
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState(): Promise<PushState> {
  if (!ONLINE_MODE) return 'local';
  if (!supported()) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function fromB64url(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** ขอสิทธิ์ + สมัครรับ + ผูกเครื่องนี้กับพนักงานที่ล็อกอินอยู่ */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError('denied');

  const { key } = await apiGet<{ key: string | null }>('/api/push/key');
  if (!key) throw new PushError('notConfigured');
  const serverKey = fromB64url(key);

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // สมัครไว้ด้วยกุญแจชุดเก่า (เซิร์ฟเวอร์เปลี่ยนกุญแจ) — ต้องสมัครใหม่ ไม่งั้นข้อความจะไม่มาถึง
  if (sub && !sameKey(sub.options.applicationServerKey, serverKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey as BufferSource });
  await apiPost('/api/push/subscribe', sub.toJSON());
}

/** เลิกรับบนเครื่องนี้ — เรียกตอนออกจากระบบด้วย คนถัดไปที่ใช้เครื่องจะได้ไม่เห็นงานของคนเดิม */
export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await apiPost('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * ย้ำกับเซิร์ฟเวอร์ว่าเครื่องนี้เป็นของคนที่ล็อกอินอยู่ตอนนี้
 * เรียกทุกครั้งที่เปิดแอป — ถ้าเซิร์ฟเวอร์เคยลบทิ้ง (เช่นเปลี่ยนเจ้าของเครื่อง) จะได้กลับมาครบ
 */
export async function refreshPushOwner(): Promise<void> {
  if (!ONLINE_MODE || !supported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await apiPost('/api/push/subscribe', sub.toJSON()).catch(() => {});
}

export const sendTestPush = () => apiPost('/api/push/test');

/**
 * โชว์การแจ้งเตือนจากในแอปเอง (ตอนแอปเปิดค้างอยู่เบื้องหลัง)
 * ใช้ tag เดียวกับที่ Worker ส่งมา ถ้ามาทั้งสองทางจะเหลือแค่อันเดียว ไม่เด้งซ้ำ
 */
export async function showLocalNotification(title: string, body: string, url: string, tag: string) {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  await reg?.showNotification(title, {
    body,
    tag,
    icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icons/icon-192.png`,
    data: { url },
  });
}
