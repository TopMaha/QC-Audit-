import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, accent, ...props }: HTMLAttributes<HTMLDivElement> & { accent?: boolean }) {
  return (
    <div
      className={cn(
        'panel overflow-hidden',
        accent && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent before:content-[""]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  hint,
  right,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold leading-tight">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

/** บล็อกตัวเลขแบบหน้าปัดเครื่องมือวัด */
export function StatBlock({
  label,
  value,
  unit,
  sub,
  tone = 'default',
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'accent';
  hint?: ReactNode;
  className?: string;
}) {
  const toneClass = {
    default: 'text-foreground',
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
    accent: 'text-accent',
  }[tone];
  return (
    <div className={cn('panel px-3.5 py-3', className)}>
      <div className="flex items-center gap-1.5">
        <span className="label-micro">{label}</span>
        {hint}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn('num text-[26px] font-semibold leading-none', toneClass)}>{value}</span>
        {unit ? <span className="num text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
