import { AlertOctagon, BellRing, CheckCircle2, ClipboardCheck, Clock, RotateCcw, Wrench, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import { isOverdue } from '@/lib/calc';
import { diffDays, todayISO, type ISODate } from '@/lib/time';
import type { DisplayStatus, QcIssue, Severity, VsmLine } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   สีของสถานะและความรุนแรง — นิยามไว้ที่เดียว
   ทุกหน้าจอต้องใช้สีชุดเดียวกัน ไม่งั้นผู้ใช้จะตีความสีผิดเมื่อสลับหน้า
   ══════════════════════════════════════════════════════════════════════════ */

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent' | 'steel' | 'info' | 'pending';

/**
 * หน้าตาของแต่ละสถานะ — สีตามขั้นตอน 5 ขั้น (ดู src/index.css) และมีไอคอนกำกับทุกสถานะ
 * คนตาบอดสีจึงยังแยกได้จากไอคอนและข้อความ ไม่ต้องพึ่งสีอย่างเดียว
 */
export const STATUS_LOOK: Record<DisplayStatus, { tone: Tone; icon: ComponentType<{ className?: string }> }> = {
  open: { tone: 'bad', icon: AlertOctagon },
  acked: { tone: 'info', icon: BellRing },
  in_progress: { tone: 'warn', icon: Wrench },
  fixed: { tone: 'pending', icon: ClipboardCheck },
  rejected: { tone: 'bad', icon: RotateCcw },
  verified: { tone: 'ok', icon: CheckCircle2 },
  cancelled: { tone: 'neutral', icon: XCircle },
};

/** สีเส้นซ้ายของการ์ด — ใช้ให้สแกนรายการยาว ๆ ได้ด้วยหางตา */
export const STATUS_BAR: Record<DisplayStatus, string> = {
  open: 'before:bg-bad',
  acked: 'before:bg-info',
  in_progress: 'before:bg-warn',
  fixed: 'before:bg-pending',
  rejected: 'before:bg-bad',
  verified: 'before:bg-ok',
  cancelled: 'before:bg-border',
};

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: 'bad',
  major: 'warn',
  minor: 'neutral',
};

export function StatusBadge({ status, size }: { status: DisplayStatus; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const look = STATUS_LOOK[status];
  const Icon = look.icon;
  return (
    <Badge tone={look.tone} size={size} className="normal-case tracking-normal">
      <Icon className="h-3 w-3" />
      {t(`status.${status}` as 'status.open')}
    </Badge>
  );
}

export function SeverityBadge({ severity, size }: { severity: Severity; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  return (
    <Badge tone={SEVERITY_TONE[severity]} size={size} className="normal-case tracking-normal">
      {t(`severity.${severity}` as 'severity.critical')}
    </Badge>
  );
}

/** ป้ายสายการผลิต — เป็นตัวเลข/ตัวย่อจึงคง mono ไว้ให้อ่านเป็นรหัส */
export function VsmBadge({ line, size }: { line: VsmLine; size?: 'sm' | 'md' }) {
  return (
    <Badge tone="accent" size={size}>
      {line}
    </Badge>
  );
}

/**
 * ป้ายกำหนดส่ง — เลยกำหนดเป็นแดง ครบวันนี้เป็นส้ม เหลือเวลาเป็นสีปกติ
 * ใบที่ปิดหรือยกเลิกแล้วไม่ต้องเร่ง จึงไม่แสดงป้าย
 */
export function DueBadge({ issue, className }: { issue: QcIssue; className?: string }) {
  const { t } = useI18n();
  const today = todayISO();
  if (issue.status === 'verified' || issue.status === 'cancelled') return null;

  const left = diffDays(today, issue.due_date);
  if (isOverdue(issue, today)) {
    return (
      <Badge tone="bad" className={cn('normal-case tracking-normal', className)}>
        <Clock className="h-3 w-3" />
        {t('issue.overdueBy', { n: -left })}
      </Badge>
    );
  }
  if (left === 0) {
    return (
      <Badge tone="warn" className={cn('normal-case tracking-normal', className)}>
        <Clock className="h-3 w-3" />
        {t('status.dueToday')}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" className={cn('normal-case tracking-normal', className)}>
      <Clock className="h-3 w-3" />
      {t('issue.dueIn', { n: left })}
    </Badge>
  );
}

/** ป้ายผลรอบตรวจ — ผ่าน/พบข้อบกพร่อง */
export function RoundResultBadge({ result }: { result: 'pass' | 'ng' }) {
  const { t } = useI18n();
  return (
    <Badge tone={result === 'pass' ? 'ok' : 'bad'} className="normal-case tracking-normal">
      {result === 'pass' ? <CheckCircle2 className="h-3 w-3" /> : <AlertOctagon className="h-3 w-3" />}
      {t(result === 'pass' ? 'status.pass' : 'status.ng')}
    </Badge>
  );
}

export function formatDueLabel(due: ISODate, lang: 'th' | 'en'): string {
  const left = diffDays(todayISO(), due);
  if (left < 0) return lang === 'th' ? `เลย ${-left} วัน` : `${-left}d late`;
  if (left === 0) return lang === 'th' ? 'วันนี้' : 'today';
  return lang === 'th' ? `อีก ${left} วัน` : `${left}d left`;
}
