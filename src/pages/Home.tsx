import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, Shield } from 'lucide-react';
import { BrandMark } from '@/components/AppHeader';
import { SignInForm } from '@/components/SignInForm';
import { useToast } from '@/components/ui/toast';
import { useSession, useSettings } from '@/hooks/useData';
import { useI18n } from '@/lib/i18n';
import { EXPIRED_KEY, getSession } from '@/lib/session';
import { formatDate, todayISO } from '@/lib/time';
import { STAGES } from '@/lib/types';

export default function Home() {
  const { t, lang, setLang } = useI18n();
  const { session } = useSession();
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  // ถูกพากลับมาเพราะเซสชันใช้ไม่ได้แล้ว (ดู onUnauthorized ใน main.tsx)
  // อ่านใน initializer แต่ลบใน effect — initializer ต้องไม่มีผลข้างเคียง (StrictMode เรียกซ้ำสองรอบ)
  const [expired] = useState(() => {
    try {
      return sessionStorage.getItem(EXPIRED_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem(EXPIRED_KEY);
    } catch {
      // ไม่มี sessionStorage ก็ไม่มีอะไรให้ลบ
    }
  }, []);

  if (session) return <Navigate to="/mywork" replace />;

  const done = () => {
    const name = getSession()?.full_name;
    if (name) toast(`${t('auth.welcome')} ${name}`);
    navigate('/mywork');
  };

  return (
    <div className="relative z-10 flex min-h-[100dvh] flex-col">
      {/* แถบบน */}
      <div className="bg-header text-header-foreground shadow-panel pt-safe">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <BrandMark tone="white" className="h-[18px] sm:h-5" />
          <span className="h-7 w-px bg-white/30" aria-hidden />
          <span className="text-[13px] font-semibold tracking-wide">QC Audit Line</span>
          <div className="ml-auto flex h-8 items-center rounded-md border border-white/25 bg-white/10 p-0.5">
            {(['th', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`press focusable h-7 rounded-[4px] px-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${
                  lang === l ? 'bg-white text-brand' : 'text-white/80 hover:text-white'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="brand-bar h-[3px] w-full" />
      </div>

      <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-8 px-4 py-8 md:grid-cols-[1.1fr_.9fr] md:gap-12 md:py-16">
        {/* ฝั่งซ้าย: ข้อความหลัก */}
        <div className="stagger">
          <div className="mb-4 flex items-center gap-2">
            <span className="brand-bar h-[3px] w-12 rounded-full" />
            <span className="label-micro">{t('home.tagline')}</span>
          </div>
          <h1 className="text-[clamp(2.4rem,9vw,4.2rem)] font-bold leading-[0.95] tracking-tight">
            QC Audit
            <br />
            <span className="text-accent">Line</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">{t('home.lead')}</p>

          {/* ขั้นตอนการดำเนินการ 5 ขั้นที่โรงงานกำหนด — ชุดเดียวกับแถบขั้นตอนในใบแจ้ง */}
          <ol className="mt-7 grid max-w-lg grid-cols-5 gap-1.5">
            {STAGES.map((stage, i) => (
              <li key={stage} className="panel px-2 py-2.5">
                <span className="num text-[11px] font-semibold text-accent">0{i + 1}</span>
                <span className="mt-0.5 block text-[12px] font-medium leading-tight">{t(`stage.${stage}` as 'stage.found')}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* ฝั่งขวา: เข้าสู่ระบบ */}
        <div className="panel animate-fade-up overflow-hidden">
          <div className="brand-bar h-[3px] w-full" />
          <div className="p-5 sm:p-6">
            <div className="mb-1 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-accent" />
              <h2 className="text-base font-semibold">{t('auth.signIn')}</h2>
            </div>
            <p className="num mb-5 text-[11px] text-muted-foreground">
              {settings?.plant_name} · {formatDate(todayISO(), lang, { full: true })}
            </p>

            {/* เซสชันเดิมถูกตัด (หมดอายุ · ถูกล้าง PIN · ถูกถอนสิทธิ์) — บอกเหตุผลก่อนให้เข้าใหม่ */}
            {expired ? (
              <p role="status" className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px]">
                {t('auth.expired')}
              </p>
            ) : null}

            <SignInForm kind="employee" onSuccess={done} />

            <p className="mt-3 text-center text-[11px] text-muted-foreground">{t('auth.forgotPin')}</p>
            <Link
              to="/admin"
              className="focusable mt-2 flex items-center justify-center gap-1.5 rounded-md py-2 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <Shield className="h-3.5 w-3.5" />
              {t('home.adminCta')}
            </Link>
          </div>
        </div>
      </div>

      <footer className="border-t px-4 py-4 text-center">
        <p className="num text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {settings?.company_name ?? 'TENNECO'} · QC Audit Line
        </p>
      </footer>
    </div>
  );
}
