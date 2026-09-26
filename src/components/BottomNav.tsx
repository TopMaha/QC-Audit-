import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  ClipboardCheck,
  FileText,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
  Shield,
} from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useInbox, useSession } from '@/hooks/useData';
import { useI18n, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Item {
  to: string;
  key: TKey;
  icon: ComponentType<{ className?: string }>;
}

const MYWORK: Item = { to: '/mywork', key: 'nav.mywork', icon: Inbox };
const ISSUES: Item = { to: '/issues', key: 'nav.issues', icon: ListChecks };
const INSPECT: Item = { to: '/inspect', key: 'nav.inspect', icon: ClipboardCheck };
const DASHBOARD: Item = { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard };

const SECONDARY: Item[] = [
  { to: '/rounds', key: 'nav.rounds', icon: FileText },
  { to: '/vsm', key: 'nav.vsm', icon: BarChart3 },
];

export function BottomNav() {
  const { t } = useI18n();
  // canInspect = QC และผู้ดูแลระบบ — VSM ที่ไม่ได้ดูแลระบบไม่ได้เป็นคนตรวจ
  const { session, admin, canInspect } = useSession();
  const inbox = useInbox();
  const [moreOpen, setMoreOpen] = useState(false);

  // เมนู "เพิ่มเติม" เป็นของแถบล่างบนมือถือ — ขยายหน้าต่างจนเป็นเมนูบนแล้วต้องปิดตาม
  // ไม่งั้นกล่องจะค้างอยู่กลางจอทั้งที่ปุ่มที่เปิดมันหายไปแล้ว (md = 768px ตรงกับ md:hidden ด้านล่าง)
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const onChange = () => wide.matches && setMoreOpen(false);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);
  const location = useLocation();

  const canDash = session?.dashboard_enabled || admin;

  const items: Item[] = [
    MYWORK,
    ...(canInspect ? [INSPECT] : []),
    ISSUES,
    ...(canDash ? [DASHBOARD] : []),
  ];
  const secondary: Item[] = [
    ...SECONDARY,
    ...(admin
      ? [
          { to: '/admin/report', key: 'nav.report' as TKey, icon: FileText },
          { to: '/admin/settings', key: 'nav.settings' as TKey, icon: Shield },
        ]
      : []),
  ];
  const moreActive = secondary.some((s) => location.pathname.startsWith(s.to));

  return (
    <>
      {/* เดสก์ท็อป: เมนูบน */}
      <nav className="sticky top-14 z-30 hidden border-b bg-background/80 backdrop-blur md:block">
        {/* เมนูมีได้ถึง 9 รายการ (ผู้ดูแลระบบ) — จอแคบให้เลื่อนแนวนอน ไม่ให้ชื่อเมนูตกบรรทัด */}
        <div className="scroll-x no-scrollbar mx-auto flex max-w-6xl items-center gap-1 px-5 py-1.5">
          {[...items, ...secondary].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'press focusable flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-medium',
                  isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {t(item.key)}
              {item.to === '/mywork' && inbox.length ? (
                <span className="num rounded-full bg-bad px-1.5 text-[10px] font-semibold leading-[18px] text-white">
                  {inbox.length}
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* มือถือ: เมนูล่าง */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-md pb-safe md:hidden">
        <div className="mx-auto flex max-w-lg items-stretch">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'absolute inset-x-4 top-0 h-[2px] rounded-full transition-opacity',
                      isActive ? 'bg-accent opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="relative">
                    <item.icon className={cn('h-[18px] w-[18px]', isActive && 'text-accent')} />
                    {/* จำนวนงานค้างต้องเห็นจากทุกหน้า ไม่งั้นคนที่ไม่ได้เปิดหน้างานของฉันจะไม่รู้ว่ามีงานเข้า */}
                    {item.to === '/mywork' && inbox.length ? (
                      <span className="num absolute -right-2 -top-1.5 min-w-[15px] rounded-full bg-bad px-[3px] text-[9px] font-semibold leading-[15px] text-white">
                        {inbox.length > 99 ? '99+' : inbox.length}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate px-0.5">{t(item.key)}</span>
                </>
              )}
            </NavLink>
          ))}

          <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
            <DialogTrigger asChild>
              <button
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium',
                  moreActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn('absolute inset-x-4 top-0 h-[2px] rounded-full', moreActive ? 'bg-accent' : 'opacity-0')}
                />
                <MoreHorizontal className={cn('h-[18px] w-[18px]', moreActive && 'text-accent')} />
                <span>{t('nav.more')}</span>
              </button>
            </DialogTrigger>
            <DialogContent title={t('nav.more')}>
              <div className="grid grid-cols-2 gap-2">
                {secondary.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className="press focusable flex flex-col gap-2 rounded-md border bg-card p-4 text-sm font-medium"
                  >
                    <item.icon className="h-5 w-5 text-accent" />
                    {t(item.key)}
                  </NavLink>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </nav>
    </>
  );
}
