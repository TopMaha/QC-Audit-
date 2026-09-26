import { useState } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { loginAdmin, loginEmployee, type LoginResult } from '@/lib/api';
import { ONLINE_MODE } from '@/lib/config';
import { useI18n } from '@/lib/i18n';

/**
 * ฟอร์มเข้าสู่ระบบ: รหัสพนักงาน + PIN 6 หลัก — ใช้ทั้งหน้าแรกและ /admin
 *
 * เข้าครั้งแรกยังไม่มี PIN → เว้นช่อง PIN แล้วกดเข้า เซิร์ฟเวอร์ตอบ pin_setup
 * ฟอร์มจะเปลี่ยนเป็นขั้น "ตั้ง PIN" (กรอกสองครั้ง) แล้วเข้าระบบให้ทันทีที่ตั้งเสร็จ
 *
 * ไม่มีตัวอย่างรหัสในช่องโดยตั้งใจ — ตัวอย่างที่เป็นรหัสจริงคือการบอกรหัสให้คนนอกไปใช้
 * โหมดในเครื่อง (ไม่มีเซิร์ฟเวอร์) ไม่มี PIN ให้กรอก
 */
export function SignInForm({ kind, onSuccess }: { kind: 'employee' | 'admin'; onSuccess: () => void }) {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<'login' | 'setup'>('login');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = kind === 'admin' ? loginAdmin : loginEmployee;

  const explain = (r: LoginResult): string | null => {
    switch (r.error) {
      case undefined:
        return null;
      case 'pin_required':
        return t('auth.pinRequired');
      case 'weak_pin':
        return r.message ?? t('auth.pinFormat');
      case 'locked': {
        const until = r.lockedUntil
          ? new Date(r.lockedUntil).toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-GB', {
              timeZone: 'Asia/Bangkok',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';
        return t('auth.locked', { time: until });
      }
      case 'inactive':
        return t('auth.inactive');
      case 'no_access':
        return t('auth.noAccess');
      case 'offline':
        return t('auth.offline');
      default:
        return r.attemptsLeft !== undefined
          ? `${t('auth.invalid')} · ${t('auth.attemptsLeft', { n: r.attemptsLeft })}`
          : t('auth.invalid');
    }
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await login(code, pin);
    setBusy(false);
    if (r.error === 'pin_setup') {
      setStep('setup');
      return;
    }
    const msg = explain(r);
    if (msg) {
      setPin('');
      return setError(msg);
    }
    onSuccess();
  };

  const submitSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(newPin)) return setError(t('auth.pinFormat'));
    if (newPin !== confirm) return setError(t('auth.pinMismatch'));
    setBusy(true);
    setError(null);
    const r = await login(code, '', newPin);
    setBusy(false);
    const msg = explain(r);
    if (msg) return setError(msg);
    onSuccess();
  };

  const pinInput = (value: string, set: (v: string) => void, autoComplete: string, autoFocus = false) => (
    <Input
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => (set(e.target.value.replace(/\D/g, '').slice(0, 6)), setError(null))}
      className="num h-14 text-center text-2xl font-semibold tracking-[0.5em]"
    />
  );

  const errorLine = error ? (
    <p role="alert" className="mt-2 text-[12px] text-bad">
      {error}
    </p>
  ) : null;

  if (step === 'setup') {
    return (
      <form onSubmit={submitSetup}>
        <div className="mb-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <KeyRound className="h-4 w-4 text-accent" />
            {t('auth.setupTitle')}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t('auth.setupHint')}</p>
        </div>

        <label className="mb-1.5 block text-[13px] font-medium">{t('auth.newPin')}</label>
        {pinInput(newPin, setNewPin, 'new-password', true)}
        <label className="mb-1.5 mt-3 block text-[13px] font-medium">{t('auth.confirmPin')}</label>
        {pinInput(confirm, setConfirm, 'new-password')}
        {errorLine}

        <Button type="submit" variant="accent" size="lg" className="mt-4 w-full" disabled={busy || !newPin || !confirm}>
          {busy ? t('common.loading') : t('auth.setPin')}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => (setStep('login'), setNewPin(''), setConfirm(''), setError(null))}
        >
          <ArrowLeft className="h-4 w-4" />
          {t('common.back')}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitLogin}>
      <label className="mb-1.5 block text-[13px] font-medium">
        {kind === 'admin' ? t('auth.adminCode') : t('auth.empCode')}
      </label>
      <Input
        autoFocus
        value={code}
        // รหัสพนักงานมีทั้งตัวอักษรและขีดกลาง จึงเป็นแป้นตัวอักษร
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="username"
        onChange={(e) => (setCode(e.target.value), setError(null))}
        className="num h-14 text-center text-2xl font-semibold uppercase tracking-[0.18em]"
      />
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{t('auth.codeHint')}</p>

      {ONLINE_MODE ? (
        <>
          <label className="mb-1.5 mt-3 block text-[13px] font-medium">PIN</label>
          {pinInput(pin, setPin, 'current-password')}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{t('auth.pinHint')}</p>
        </>
      ) : null}
      {errorLine}

      <Button
        type="submit"
        variant={kind === 'admin' ? 'primary' : 'accent'}
        size="lg"
        className="mt-4 w-full"
        disabled={busy || !code}
      >
        {kind === 'admin' ? <Shield className="h-4 w-4" /> : null}
        {busy ? t('common.loading') : t('auth.signIn')}
        {kind === 'admin' ? null : <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  );
}
