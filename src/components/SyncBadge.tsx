import { useSyncExternalStore } from 'react';
import { AlertTriangle, Check, CloudOff, RefreshCw, UploadCloud } from 'lucide-react';
import { ONLINE_MODE } from '@/lib/config';
import { useI18n, type TKey } from '@/lib/i18n';
import { getSyncStatus, subscribeSync, syncNow, type SyncState } from '@/lib/sync';
import { cn } from '@/lib/utils';

/**
 * ป้ายบอกสถานะการซิงก์ — สำคัญมากสำหรับงานหน้างาน
 * ผู้ใช้ต้องรู้ทันทีว่างานที่เพิ่งบันทึกขึ้นเซิร์ฟเวอร์แล้วหรือยัง
 * ไม่งั้นจะไม่กล้าปิดแอปหรือบันทึกซ้ำโดยไม่จำเป็น
 */

const LOOK: Record<SyncState, { icon: typeof Check; key: TKey; className: string }> = {
  idle: { icon: Check, key: 'sync.idle', className: 'text-ok' },
  syncing: { icon: RefreshCw, key: 'sync.syncing', className: 'text-muted-foreground' },
  pending: { icon: UploadCloud, key: 'sync.pending', className: 'text-warn' },
  offline: { icon: CloudOff, key: 'sync.offline', className: 'text-warn' },
  error: { icon: AlertTriangle, key: 'sync.error', className: 'text-bad' },
};

export function SyncBadge() {
  const { t, lang } = useI18n();
  const status = useSyncExternalStore(subscribeSync, getSyncStatus, getSyncStatus);

  // โหมดในเครื่องล้วน (ยังไม่ได้ตั้ง VITE_API_URL) ไม่มีอะไรให้ซิงก์
  if (!ONLINE_MODE) return null;

  const look = LOOK[status.state];
  const Icon = look.icon;
  const label = t(look.key);
  const canRetry = status.state === 'error' || status.state === 'offline' || status.pending > 0;

  const title = [
    `${t('common.status')}: ${label}`,
    status.pending > 0 ? t('sync.queued', { n: status.pending }) : null,
    status.lastSyncedAt
      ? `${t('sync.lastSync')} ${new Date(status.lastSyncedAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
          timeZone: 'Asia/Bangkok',
        })}`
      : null,
    status.lastError,
    canRetry ? t('sync.retry') : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={status.state === 'syncing'}
      title={title}
      aria-label={title}
      className={cn(
        'focusable press flex h-8 items-center gap-1.5 rounded-md border bg-card px-2 text-[11px] font-medium',
        look.className,
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', status.state === 'syncing' && 'animate-spin')} />
      <span className="hidden sm:inline">{label}</span>
      {status.pending > 0 ? (
        <span className="num rounded bg-warn/15 px-1 text-[10px] tabular-nums">{status.pending}</span>
      ) : null}
    </button>
  );
}
