/**
 * Service worker — ทำให้แอปเปิดได้แม้ไม่มีสัญญาณ
 *
 * กลยุทธ์
 *   ไฟล์แอป (HTML/JS/CSS/ไอคอน)  cache-first  แล้วอัปเดตเบื้องหลัง
 *   คำขอ API                      ไม่แคชเลย ปล่อยให้ชั้นซิงก์จัดการเอง
 *
 * เหตุผลที่ไม่แคช API: ข้อมูลจริงถูกเก็บเป็นสำเนาใน localStorage/IndexedDB
 * โดย src/lib/db.ts และ src/lib/queue.ts อยู่แล้ว ถ้ามาแคชซ้ำที่นี่อีกชั้น
 * จะได้ข้อมูลเก่าค้างโดยที่แอปไม่รู้ตัว ซึ่งอันตรายกว่าการไม่มีข้อมูล
 */

// ขึ้นเลขเมื่อไฟล์ใน PRECACHE เปลี่ยน (v3 = path อิง scope เพื่อเสิร์ฟใต้ /QC-Audit-/ บน GitHub Pages ได้)
// แคชเก่าจะถูกล้างตอน activate
const CACHE_PREFIX = 'qc-audit-';
const VERSION = `${CACHE_PREFIX}v3`;
const SHELL = `${VERSION}-shell`;

/**
 * แอปเสิร์ฟได้ทั้งที่ root (Cloudflare Pages) และใต้ชื่อ repo (topmaha.github.io/QC-Audit-/)
 * จึงห้ามเขียน path แบบขึ้นต้นด้วย / ตรง ๆ — ต้องต่อจาก scope ของ service worker เสมอ
 * path ของแอปที่ Worker ส่งมา (เช่น /issues/abc) ก็แปลงผ่านฟังก์ชันนี้เหมือนกัน
 */
const inScope = (path) => new URL(String(path).replace(/^\/+/, ''), self.registration.scope).href;

// ไฟล์ขั้นต่ำที่ต้องมีเพื่อให้แอปเปิดขึ้นมาได้
const PRECACHE = ['', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // ไฟล์ใดโหลดไม่ได้ก็ไม่ให้ล้มทั้งชุด
      .then((cache) => Promise.allSettled(PRECACHE.map((path) => cache.add(inScope(path)))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // ล้างเฉพาะแคชของแอปนี้ — บน github.io ทุกแอปของบัญชีใช้ origin เดียวกัน (แคชร่วมกัน)
      // ถ้าล้างทุกอันที่ไม่ใช่ของเรา จะไปลบแคชออฟไลน์ของ Gemba Audit ฯลฯ ทิ้งด้วย
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(CACHE_PREFIX) && !k.startsWith(VERSION)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ข้ามคำขอ API ทั้งหมด ให้ชั้นซิงก์ของแอปเป็นคนตัดสินใจ
  if (url.pathname.startsWith('/api/')) return;

  // คนละโดเมน (เช่น Worker หรือฟอนต์) ปล่อยผ่านตามปกติ
  if (url.origin !== self.location.origin) return;

  // การเปิดหน้า: ลองเน็ตก่อนเพื่อให้ได้เวอร์ชันใหม่ ถ้าไม่ได้ค่อยใช้ของที่แคชไว้
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(inScope('index.html'), copy));
          return res;
        })
        .catch(() => caches.match(inScope('index.html')).then((r) => r ?? Response.error())),
    );
    return;
  }

  // ไฟล์อื่น: ใช้ของที่แคชไว้ก่อน (เร็วและใช้ได้ตอนออฟไลน์) แล้วเติมแคชเบื้องหลัง
  event.respondWith(
    caches.match(req).then((hit) => {
      const fromNet = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? fromNet;
    }),
  );
});

/* ── การแจ้งเตือนแบบเด้ง ─────────────────────────────────────────────────
   Worker ส่งข้อความที่เข้ารหัสมา (ดู worker/src/lib/push.js) เบราว์เซอร์ถอดให้แล้ว
   เนื้อความเป็น JSON { title, body, url, tag } — tag เดียวกันแทนที่อันเดิม ไม่ซ้อนกัน */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'QC Audit Line', {
      body: data.body || 'มีงานใหม่รอคุณ',
      icon: inScope('icons/icon-192.png'),
      badge: inScope('icons/icon-192.png'),
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      vibrate: [200, 100, 200],
      data: { url: data.url || '/mywork' },
    }),
  );
});

// แตะการแจ้งเตือน → เปิดใบนั้นในแอปที่เปิดอยู่แล้ว หรือเปิดแอปขึ้นมาใหม่
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = inScope((event.notification.data && event.notification.data.url) || '/mywork');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // เทียบกับ scope ไม่ใช่ origin — บน github.io หน้าต่างของแอปอื่นในบัญชีเดียวกันก็ origin เดียวกัน
      const win = list.find((c) => c.url.startsWith(self.registration.scope));
      if (win) {
        return win.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : undefined));
      }
      return self.clients.openWindow(url);
    }),
  );
});
