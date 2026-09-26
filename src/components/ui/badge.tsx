import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] leading-none whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        ok: 'border-ok/30 bg-ok/12 text-ok',
        warn: 'border-warn/35 bg-warn/12 text-warn',
        bad: 'border-bad/30 bg-bad/12 text-bad',
        accent: 'border-accent/40 bg-accent/15 text-accent',
        steel: 'border-steel/35 bg-steel/12 text-steel',
        info: 'border-info/35 bg-info/12 text-info',
        pending: 'border-pending/35 bg-pending/12 text-pending',
        solid: 'border-primary bg-primary text-primary-foreground',
      },
      size: { sm: 'h-[18px]', md: 'h-[22px] px-2 text-[11px]' },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export function Badge({
  className,
  tone,
  size,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/**
 * แท็กประเภทข้อบกพร่อง — ตัวเลขนำหน้าเป็น mono, ชื่อเป็นตัวอักษรปกติ (รองรับภาษาไทย)
 * ชื่อประเภทตั้งต้นขึ้นต้นด้วยเลขลำดับ เช่น "2-รอยเชื่อมบกพร่อง" จึงแยกสองส่วนให้อ่านง่าย
 */
export function CategoryTag({
  name,
  highlight,
  className,
}: {
  name: string;
  highlight?: boolean;
  className?: string;
}) {
  const m = /^(\d+)[-.\s]\s*(.*)$/.exec(name);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-[3px] text-[11px] leading-tight',
        highlight ? 'border-accent/50 bg-accent/12 text-foreground' : 'border-border bg-muted/60 text-muted-foreground',
        className,
      )}
      title={name}
    >
      {m ? <span className="num font-semibold text-accent">{m[1]}</span> : null}
      <span className="truncate">{m ? m[2] : name}</span>
    </span>
  );
}
