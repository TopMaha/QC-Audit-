import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Moon, Shield, Sun } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SyncBadge } from '@/components/SyncBadge';
import { useSession } from '@/hooks/useData';
import { personLabel, useI18n } from '@/lib/i18n';
import { signOut as signOutApi } from '@/lib/api';
import { getMode, setMode, type Mode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const LOGO = `${import.meta.env.BASE_URL}brand/tenneco-logo.png`;
const LOGO_WHITE = `${import.meta.env.BASE_URL}brand/tenneco-logo-white.png`;

/**
 * โลโก้ TENNECO จากไฟล์ของบริษัท (ตัดพื้นขาวออกแล้ว ไม่ได้วาดใหม่หรือบิดสัดส่วน)
 *   auto  น้ำเงินบนพื้นสว่าง · ขาวในโหมดมืด
 *   white ขาวเสมอ — ใช้บนแถบหัวสีน้ำเงิน
 */
export function BrandMark({ className, tone = 'auto' }: { className?: string; tone?: 'auto' | 'white' }) {
  if (tone === 'white') {
    return <img src={LOGO_WHITE} alt="TENNECO" className={cn('h-4 w-auto shrink-0', className)} />;
  }
  return (
    <>
      <img src={LOGO} alt="TENNECO" className={cn('h-4 w-auto shrink-0 dark:hidden', className)} />
      <img src={LOGO_WHITE} alt="TENNECO" className={cn('hidden h-4 w-auto shrink-0 dark:block', className)} />
    </>
  );
}

export function AppHeader() {
  const { t, lang, setLang } = useI18n();
  const { session, admin } = useSession();
  const navigate = useNavigate();
  const [mode, setModeState] = useState<Mode>(() => getMode());

  const toggleMode = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    setModeState(next);
    setMode(next);
  };

  const signOut = async () => {
    // เลิกรับงานเด้งบนเครื่องนี้ + ลบเซสชันที่เซิร์ฟเวอร์ แล้วค่อยล้างในเครื่อง — ดู signOut ใน src/lib/api.ts
    await signOutApi();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 bg-header text-header-foreground shadow-panel pt-safe">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-5">
        <Link
          to={session ? '/mywork' : '/'}
          className="focusable flex min-w-0 items-center gap-3 rounded-md focus-visible:ring-offset-header"
        >
          <BrandMark tone="white" className="h-[18px] sm:h-5" />
          {/* มือถือจอแคบ: เหลือแค่โลโก้ ปุ่มด้านขวาจะได้ไม่เบียดจนชื่อแอปตกบรรทัด */}
          <span className="hidden h-7 w-px shrink-0 bg-white/30 sm:block" aria-hidden />
          <span className="hidden min-w-0 leading-none sm:block">
            <span className="block text-[13px] font-semibold tracking-wide">QC Audit Line</span>
            <span className="mt-0.5 block truncate text-[10px] text-white/75">
              {t('app.subtitle')}
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          <SyncBadge />

          {/* สวิตช์ภาษา */}
          <div className="flex h-8 items-center rounded-md border bg-card p-0.5">
            {(['th', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={cn(
                  'press focusable h-7 rounded-[4px] px-2 font-mono text-[11px] font-semibold uppercase tracking-wider',
                  lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={lang === l}
              >
                {l}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="iconSm"
            onClick={toggleMode}
            aria-label={mode === 'dark' ? t('theme.light') : t('theme.dark')}
            title={mode === 'dark' ? t('theme.light') : t('theme.dark')}
          >
            {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          {session ? (
            <Popover>
              <PopoverTrigger asChild>
                <button className="focusable press flex items-center gap-2 rounded-md border bg-card py-0.5 pl-0.5 pr-2">
                  <Avatar
                    name={personLabel(session, lang)}
                    src={session.avatar_url}
                    seed={session.employee_id}
                    size={28}
                  />
                  <span className="hidden max-w-[120px] truncate text-[13px] font-medium sm:block">
                    {personLabel(session, lang)}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2">
                <div className="border-b px-2 pb-2">
                  <div className="truncate text-sm font-semibold">{personLabel(session, lang)}</div>
                  <div className="num text-[11px] text-muted-foreground">
                    {session.emp_code} · {session.department}
                  </div>
                  {/* บทบาทกำหนดว่าเห็นอะไรและทำอะไรได้ จึงต้องเห็นตลอดเวลาว่าล็อกอินมาเป็นใคร */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <Badge tone={session.role === 'qc' ? 'steel' : session.role === 'vsm' ? 'accent' : 'neutral'}>
                      {t(`role.${session.role}` as 'role.qc')}
                    </Badge>
                    {session.vsm_line ? <Badge tone="accent">{session.vsm_line}</Badge> : null}
                  </div>
                </div>
                <div className="pt-2">
                  {admin ? (
                    <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                      <Link to="/admin/settings">
                        <Shield className="h-4 w-4" />
                        {t('nav.settings')}
                      </Link>
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" className="w-full justify-start text-bad" onClick={signOut}>
                    <LogOut className="h-4 w-4" />
                    {t('auth.signOut')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : admin ? (
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('admin.exitAdmin')}</span>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="brand-bar h-[3px] w-full" />
    </header>
  );
}
