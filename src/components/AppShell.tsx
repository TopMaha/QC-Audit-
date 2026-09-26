import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';
import { InboxAlert } from './InboxAlert';
import { useSession, useSessionGuard } from '@/hooks/useData';

/** โครงหน้าจอของผู้ใช้ที่เข้าสู่ระบบแล้ว + ตรวจสอบสิทธิ์ */
export function AppShell() {
  const { session, admin } = useSession();
  const location = useLocation();
  useSessionGuard();

  if (!session && !admin) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="relative z-10 flex min-h-[100dvh] flex-col">
      <AppHeader />
      <BottomNav />
      <InboxAlert />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-28 pt-4 sm:px-5 md:pb-10">
        <Outlet />
      </main>
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
