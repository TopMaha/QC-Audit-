import { Check, RotateCcw, XCircle } from 'lucide-react';
import { STATUS_LOOK } from '@/components/StatusBadge';
import { displayStatus, stageOf } from '@/lib/calc';
import { useI18n } from '@/lib/i18n';
import { STAGES } from '@/lib/types';
import type { IssueFix, QcIssue, Stage } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * แถบขั้นตอนการดำเนินการ 5 ขั้นที่โรงงานกำหนด
 *   QC พบปัญหา › VSM รับทราบ › กำลังแก้ไข › แก้ไขเสร็จแล้ว › QC ตรวจรับ
 *
 * ทุกคนที่เปิดใบต้องตอบได้ในหนึ่งสายตาว่า "งานอยู่ที่ใคร ตั้งแต่เมื่อไร"
 * จึงแสดงเวลาที่แต่ละขั้นเกิดขึ้นจริงไว้ใต้ขั้นนั้นด้วย
 */

/** เวลาที่แต่ละขั้นเกิดขึ้น (ISO) — null = ยังไม่ถึง */
export function stageTimes(issue: QcIssue, fixes: IssueFix[]): Record<Stage, string | null> {
  const sorted = [...fixes].sort((a, b) => a.attempt - b.attempt);
  const lastFix = sorted[sorted.length - 1];
  const reached = STAGES.indexOf(stageOf(issue) as Stage);
  return {
    // วันเวลาที่พบเก็บเป็นเวลาไทย จึงต้องต่อโซนเวลาก่อนแปลง
    found: `${issue.found_date}T${issue.found_time}:00+07:00`,
    acked: issue.acked_at,
    fixing: issue.started_at,
    // ใบที่ถูกตีกลับถอยกลับมาขั้นกำลังแก้ไข — เวลาส่งงานครั้งก่อนไม่ใช่ "แก้ไขเสร็จ" แล้ว
    fixed: reached >= 3 ? (lastFix?.fixed_at ?? null) : null,
    closed: issue.closed_at,
  };
}

function shortStamp(iso: string | null, lang: 'th' | 'en'): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** สีของขั้นปัจจุบัน — ตรงกับสีป้ายสถานะ (ดู STATUS_LOOK) */
const CURRENT_TONE: Record<string, string> = {
  bad: 'border-bad text-bad bg-bad/10',
  info: 'border-info text-info bg-info/10',
  warn: 'border-warn text-warn bg-warn/10',
  pending: 'border-pending text-pending bg-pending/10',
  ok: 'border-ok bg-ok text-white',
  neutral: 'border-border text-muted-foreground bg-muted',
};

export function IssueStepper({
  issue,
  fixes,
  className,
}: {
  issue: QcIssue;
  fixes: IssueFix[];
  className?: string;
}) {
  const { t, lang } = useI18n();
  const stage = stageOf(issue);

  if (stage === 'cancelled') {
    return (
      <div className={cn('flex items-center gap-2 rounded-md border bg-muted/60 px-3 py-2.5 text-[13px]', className)}>
        <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
        {t('stage.cancelled')}
      </div>
    );
  }

  const current = STAGES.indexOf(stage);
  const times = stageTimes(issue, fixes);
  const tone = STATUS_LOOK[displayStatus(issue)].tone;
  const rejected = issue.status === 'rejected';
  // ปิดงานแล้ว = ครบทุกขั้น ไม่มี "ขั้นปัจจุบัน" ให้รออีก
  const closed = stage === 'closed';

  return (
    <ol className={cn('grid grid-cols-5', className)} aria-label={t('stage.title')}>
      {STAGES.map((s, i) => {
        const done = i < current || closed;
        const now = i === current && !closed;
        const Icon = now ? (rejected ? RotateCcw : STATUS_LOOK[displayStatus(issue)].icon) : null;
        return (
          <li
            key={s}
            className="relative flex flex-col items-center text-center"
            aria-current={now ? 'step' : undefined}
          >
            {/* เส้นเชื่อมไปขั้นถัดไป — เต็มเมื่อขั้นนี้ผ่านแล้ว */}
            {i < STAGES.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute left-1/2 top-[15px] h-[3px] w-full rounded-full',
                  i < current || closed ? 'bg-accent' : 'bg-border',
                )}
              />
            ) : null}
            <span
              className={cn(
                'relative z-[1] grid h-8 w-8 place-items-center rounded-full border-2 text-[12px] font-semibold',
                done && 'border-accent bg-accent text-accent-foreground',
                now && CURRENT_TONE[tone],
                now && 'ring-4 ring-background',
                !done && !now && 'border-border bg-card text-muted-foreground',
              )}
            >
              {done ? <Check className="h-4 w-4" strokeWidth={3} /> : Icon ? <Icon className="h-4 w-4" /> : <span className="num">{i + 1}</span>}
            </span>
            <span
              className={cn(
                'mt-1.5 px-0.5 text-[11px] leading-tight',
                now ? 'font-semibold text-foreground' : done ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {t(`stage.${s}` as 'stage.found')}
            </span>
            <span className="num mt-0.5 min-h-[14px] text-[10px] leading-tight text-muted-foreground">
              {done || now ? shortStamp(times[s], lang) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * แถบความคืบหน้าแบบย่อสำหรับการ์ดในรายการ — 5 ช่องตามขั้นตอน
 * ขั้นที่ผ่านแล้วเป็นสีแบรนด์ ขั้นปัจจุบันเป็นสีของสถานะ
 */
export function StageBar({ issue, className }: { issue: QcIssue; className?: string }) {
  const { t } = useI18n();
  const stage = stageOf(issue);
  if (stage === 'cancelled') return null;
  const current = STAGES.indexOf(stage);
  const closed = stage === 'closed';
  const tone = STATUS_LOOK[displayStatus(issue)].tone;
  const fill: Record<string, string> = {
    bad: 'bg-bad',
    info: 'bg-info',
    warn: 'bg-warn',
    pending: 'bg-pending',
    ok: 'bg-ok',
    neutral: 'bg-muted-foreground',
  };
  return (
    <div
      className={cn('flex gap-1', className)}
      role="img"
      aria-label={`${t('stage.title')}: ${current + 1}/5 ${t(`stage.${stage}` as 'stage.found')}`}
    >
      {STAGES.map((s, i) => (
        <span
          key={s}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            closed ? 'bg-ok' : i < current ? 'bg-accent' : i === current ? fill[tone] : 'bg-muted',
          )}
        />
      ))}
    </div>
  );
}
