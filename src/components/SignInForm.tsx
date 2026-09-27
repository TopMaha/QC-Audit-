import { useState } from 'react';
import { ArrowRight, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { loginAdmin, loginEmployee, type LoginResult } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * ฟอร์มเข้าสู่ระบบ: รหัสพนักงานอย่างเดียว — ใช้ทั้งหน้าแรกและ /admin
 *
 * ไม่มีตัวอย่างรหัสในช่องโดยตั้งใจ — ตัวอย่างที่เป็นรหัสจริงคือการบอกรหัสให้คนนอกไปใช้
 */
export function SignInForm({ kind, onSuccess }: { kind: 'employee' | 'admin'; onSuccess: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = kind === 'admin' ? loginAdmin : loginEmployee;

  const explain = (r: LoginResult): string | null => {
    switch (r.error) {
      case undefined:
        return null;
      case 'inactive':
        return t('auth.inactive');
      case 'no_access':
        return t('auth.noAccess');
      case 'offline':
        return t('auth.offline');
      default:
        return kind === 'admin' ? t('auth.adminWrong') : t('auth.wrongCode');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await login(code);
    setBusy(false);
    const msg = explain(r);
    if (msg) return setError(msg);
    onSuccess();
  };

  return (
    <form onSubmit={submit}>
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
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-bad">
          {error}
        </p>
      ) : null}

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
