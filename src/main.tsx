import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { I18nProvider } from '@/lib/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/ui/toast';
import { applyTheme } from '@/lib/theme';
import { onUnauthorized } from '@/lib/net';
import { registerLocalRoster } from '@/lib/seed';
import { EXPIRED_KEY, endAdminSession, endSession, getSession, isAdmin } from '@/lib/session';
import { setSyncListener, startSync } from '@/lib/sync';
import './index.css';

applyTheme();

/**
 * เปิดไฟล์ตรง ๆ (file://) ใช้ HashRouter เพื่อให้เส้นทางทำงานได้โดยไม่ต้องมีเซิร์ฟเวอร์
 * กรณีอื่นใช้ BrowserRouter โดยผูก basename กับ base ของ Vite เพื่อให้ deploy ได้ทั้ง
 *   Cloudflare Pages  -> BASE_URL = '/'            (เสิร์ฟที่ root)
 *   GitHub Pages      -> BASE_URL = '/QC_Audit/' (เสิร์ฟใต้ชื่อ repo)
 * โดยไม่ต้องแก้โค้ดสลับไปมา
 */
const isFile = window.location.protocol === 'file:';
const Router = isFile ? HashRouter : BrowserRouter;
const routerProps = isFile ? {} : { basename: import.meta.env.BASE_URL };

const queryClient = new QueryClient({
  defaultOptions: {
    /**
     * networkMode: 'always' สำคัญมากสำหรับแอปนี้
     *
     * ค่าเริ่มต้นของ TanStack Query คือ 'online' ซึ่งจะ "หยุดค้าง" query และ mutation
     * ไว้เฉย ๆ เมื่อเบราว์เซอร์รายงานว่าออฟไลน์ ผู้ใช้จะเห็นปุ่มค้างที่ "กำลังบันทึก…"
     * แล้วงานที่เพิ่งกรอกหายไปทั้งที่กดบันทึกแล้ว
     *
     * แต่แอปนี้อ่าน–เขียนกับสำเนาในเครื่องเสมอ (src/lib/db.ts) ไม่ได้ยิงเน็ตตรง ๆ
     * จึงต้องให้ทำงานต่อได้ทุกสถานการณ์ ส่วนการส่งขึ้นเซิร์ฟเวอร์เป็นหน้าที่ของคิวใน sync.ts
     */
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

// ซิงก์เสร็จแล้วให้หน้าจอโหลดข้อมูลใหม่ (สำเนาในเครื่องเพิ่งถูกทับด้วยของจากเซิร์ฟเวอร์)
setSyncListener(() => queryClient.invalidateQueries());

// เซิร์ฟเวอร์ไม่รับเซสชันแล้ว (หมดอายุ · ถูกล้าง PIN · ถูกถอนสิทธิ์) → ล้างในเครื่อง
// AppShell จะพากลับหน้าแรกเอง และหน้าแรกบอกเหตุผลจากธง EXPIRED_KEY
// งานที่ค้างในคิวไม่ถูกทิ้ง — ส่งต่อหลังเข้าระบบใหม่ (ดู pushAll ใน src/lib/sync.ts)
onUnauthorized(() => {
  if (!getSession() && !isAdmin()) return;
  try {
    sessionStorage.setItem(EXPIRED_KEY, '1');
  } catch {
    // ไม่มี sessionStorage ก็แค่ไม่ได้เห็นข้อความอธิบาย
  }
  endSession();
  endAdminSession();
});

// Service worker — ทำให้เปิดแอปได้แม้ไม่มีสัญญาณ และติดตั้งลงหน้าจอโฮมได้
// ต้องเสิร์ฟผ่าน http/https เท่านั้น เปิดแบบ file:// จะลงทะเบียนไม่ได้
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        // ลงทะเบียนไม่สำเร็จไม่ใช่เรื่องคอขาดบาดตาย แอปยังใช้งานได้ตามปกติ
      });
  });
}

async function boot() {
  /* ทะเบียนพนักงานในไฟล์ roster.ts ใช้เฉพาะโหมดในเครื่อง (ไม่ได้ตั้ง VITE_API_URL)
     ต้องเขียนเงื่อนไขด้วย import.meta.env ตรง ๆ แบบนี้ — Vite แทนค่าเป็นข้อความตอน build
     แล้วตัวย่อไฟล์ตัดกิ่งนี้ทิ้งทั้งก้อน ไฟล์ roster จึงไม่ถูกสร้างใน build ของจริงเลย
     (ถ้าใช้ตัวแปร ONLINE_MODE ตัวย่อไฟล์อ่านค่าไม่ออก ทะเบียนจะหลุดไปอยู่ในไฟล์เว็บ) */
  if (!import.meta.env.VITE_API_URL) registerLocalRoster(await import('@/lib/roster'));

  startSync();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <I18nProvider>
            <ToastProvider>
              <Router {...routerProps}>
                <App />
              </Router>
            </ToastProvider>
          </I18nProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void boot();
