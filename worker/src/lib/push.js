/**
 * การแจ้งเตือนแบบเด้ง (Web Push) — ส่งจาก Worker ตรงถึงมือถือโดยไม่ต้องเปิดแอปค้างไว้
 *
 * ทำเองด้วย WebCrypto ไม่ได้ใช้ไลบรารี web-push เพราะตัวนั้นพึ่งโมดูล crypto ของ Node
 * มาตรฐานที่ใช้มีสามฉบับ
 *   RFC 8030  ยิง POST ไปที่ endpoint ของบริการ push (FCM / Mozilla / Apple)
 *   RFC 8292  VAPID — ลงนาม JWT ด้วยกุญแจ ES256 ของเรา บริการ push จึงรู้ว่าใครส่ง
 *   RFC 8291  เข้ารหัสเนื้อความ (aes128gcm) — บริการ push อ่านข้อความไม่ได้
 *
 * ค่าที่ต้องตั้ง
 *   VAPID_PUBLIC_KEY   [vars] ใน wrangler.toml — กุญแจสาธารณะ (base64url, 65 ไบต์)
 *   VAPID_PRIVATE_JWK  secret — กุญแจลับรูปแบบ JWK (wrangler secret put VAPID_PRIVATE_JWK)
 * ไม่ได้ตั้งค่า = ข้ามการส่งเงียบ ๆ ระบบส่วนอื่นทำงานตามปกติ
 *
 * ⚠️ การแจ้งเตือนเป็นของแถม ห้ามทำให้การบันทึกงานล้มเด็ดขาด
 * ทุกฟังก์ชันในไฟล์นี้กลืนข้อผิดพลาดเอง และถูกเรียกผ่าน waitUntil หลังตอบผู้ใช้ไปแล้ว
 */

const enc = new TextEncoder();

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export const pushConfigured = (env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK);

/* ── VAPID (RFC 8292) ─────────────────────────────────────────────────────── */

let signingKey = null;

function vapidKey(env) {
  // import ครั้งเดียวต่อ isolate — ทุกคำขอในอายุของ isolate ใช้กุญแจตัวเดิม
  signingKey ??= crypto.subtle.importKey(
    'jwk',
    JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return signingKey;
}

async function vapidAuth(env, endpoint) {
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        // ผู้ติดต่อของเจ้าของระบบตามที่บริการ push ขอ — ใช้ URL ของแอป ไม่ใช่อีเมลใคร
        sub: env.VAPID_SUBJECT || 'https://qc-audit-line.pages.dev',
      }),
    ),
  );
  // WebCrypto คืนลายเซ็น ECDSA เป็น r||s 64 ไบต์ ซึ่งตรงกับรูปแบบที่ JWS ต้องการพอดี
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await vapidKey(env),
    enc.encode(`${head}.${claims}`),
  );
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/* ── เข้ารหัสเนื้อความ (RFC 8291, aes128gcm) ─────────────────────────────── */

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

async function encrypt(sub, text) {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);

  // กุญแจชั่วคราวของเราเองสำหรับข้อความนี้ข้อความเดียว
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 = ตัวคั่นของเรคคอร์ดสุดท้าย (มีเรคคอร์ดเดียว)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))),
  );

  // หัวข้อความ: salt(16) · ขนาดเรคคอร์ด(4) · ความยาว keyid(1) · keyid = กุญแจสาธารณะชั่วคราว
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/* ── ส่ง ──────────────────────────────────────────────────────────────────── */

/**
 * ส่งข้อความหาทุกเครื่องของพนักงานที่ระบุ
 * @param {{ title: string, body: string, url: string, tag?: string }} message
 */
export async function notify(env, db, employeeIds, message) {
  try {
    if (!pushConfigured(env)) return;
    const ids = [...new Set(employeeIds.filter(Boolean))];
    if (!ids.length) return;

    const { results } = await db
      .prepare(`SELECT * FROM push_subscriptions WHERE employee_id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids)
      .all();
    if (!results.length) return;

    // เนื้อความเกิน ~4 KB เข้ารหัสเป็นเรคคอร์ดเดียวไม่ได้ ตัดให้สั้นไว้ก่อน
    const text = JSON.stringify({ ...message, body: String(message.body ?? '').slice(0, 400) });

    await Promise.all(
      results.map(async (sub) => {
        try {
          const res = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
              Authorization: await vapidAuth(env, sub.endpoint),
              TTL: '86400',
              Urgency: 'high',
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
            },
            body: await encrypt(sub, text),
          });
          // เครื่องนั้นยกเลิกการแจ้งเตือนหรือถอนแอปไปแล้ว — ลบทิ้งจะได้ไม่ยิงซ้ำทุกครั้ง
          if (res.status === 404 || res.status === 410) {
            await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(sub.endpoint).run();
          } else if (!res.ok) {
            console.warn('push rejected', res.status, (await res.text()).slice(0, 200));
          }
        } catch (e) {
          console.warn('push failed', String(e?.message ?? e));
        }
      }),
    );
  } catch (e) {
    console.warn('notify failed', String(e?.message ?? e));
  }
}

/**
 * ผู้รับของสายหนึ่ง — หัวหน้าสายที่ผู้ดูแลระบบกำหนด + VSM ของสายนั้นที่เข้าระบบได้
 * (VSM ที่เข้าระบบได้คือระดับหัวหน้าอยู่แล้ว ดู LEAD_POSITIONS ใน src/lib/roster.ts)
 */
export async function lineRecipients(db, line) {
  const { results } = await db
    .prepare(
      `SELECT employee_id AS id FROM line_heads WHERE vsm_line = ?
        UNION
       SELECT id FROM employees WHERE role = 'vsm' AND vsm_line = ? AND is_active = 1 AND can_login = 1`,
    )
    .bind(line, line)
    .all();
  return results.map((r) => r.id);
}
