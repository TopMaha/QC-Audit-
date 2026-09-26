import { useEffect, useState } from 'react';
import { BellOff, BellRing, Loader2, Send, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/lib/i18n';
import {
  PushError,
  disablePush,
  enablePush,
  getPushState,
  refreshPushOwner,
  sendTestPush,
  type PushState,
} from '@/lib/push';
import { cn } from '@/lib/utils';

/**
 * การ์ดเปิดการแจ้งเตือนแบบเด้ง — แสดงในหน้างานของฉันให้คนที่มีงานเข้า
 * (หัวหน้าสาย/VSM รับปัญหาใหม่ · QC รับงานที่แก้เสร็จ)
 *
 * เบราว์เซอร์อนุญาตให้ขอสิทธิ์ได้เฉพาะตอนผู้ใช้กดปุ่มเท่านั้น จึงต้องมีปุ่มนี้
 * ถ้าเปิดแล้วจะย่อเหลือแถบเล็ก ๆ พร้อมปุ่มทดสอบ ไม่เกะกะหน้างาน
 */
export function PushCard({ audience }: { audience: 'line' | 'qc' }) {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getPushState()
      .then((s) => {
        if (!alive) return;
        setState(s);
        if (s === 'on') void refreshPushOwner();
      })
      .catch(() => alive && setState('unsupported'));
    return () => {
      alive = false;
    };
  }, []);

  if (!state || state === 'local') return null;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      setState(await getPushState());
      if (done) toast(done);
    } catch (e) {
      if (e instanceof PushError && e.reason === 'denied') setState('denied');
      else if (e instanceof PushError && e.reason === 'notConfigured') toast(t('push.notConfigured'));
      else toast(t('push.failed', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'on') {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-ok/30 bg-ok/10 px-3 py-2">
        <BellRing className="h-4 w-4 shrink-0 text-ok" />
        <span className="min-w-0 flex-1 text-[13px] font-medium">{t('push.enabled')}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run(sendTestPush, t('push.testSent'))}>
          <Send className="h-3.5 w-3.5" />
          {t('push.test')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(disablePush)}>
          <BellOff className="h-3.5 w-3.5" />
          {t('push.disable')}
        </Button>
      </div>
    );
  }

  const message =
    state === 'ios-install'
      ? t('push.iosHint')
      : state === 'unsupported'
        ? t('push.unsupported')
        : state === 'denied'
          ? t('push.denied')
          : audience === 'qc'
            ? t('push.hintQc')
            : t('push.hintLine');

  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-3',
        state === 'off' ? 'border-accent/40 bg-accent/10' : 'bg-muted/50',
      )}
    >
      {state === 'ios-install' ? (
        <Smartphone className="h-5 w-5 shrink-0 text-accent" />
      ) : (
        <BellRing className="h-5 w-5 shrink-0 text-accent" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{t('push.title')}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{message}</p>
      </div>
      {state === 'off' ? (
        <Button variant="accent" size="md" disabled={busy} onClick={() => run(enablePush, t('push.enabled'))}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          {t('push.enable')}
        </Button>
      ) : null}
    </div>
  );
}
