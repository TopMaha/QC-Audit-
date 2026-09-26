import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Info } from 'lucide-react';
import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn, initials } from '@/lib/utils';
import { hueFrom } from '@/lib/theme';
import { bandOf } from '@/lib/calc';
import { photoUrl } from '@/lib/photos';

/** ── Tabs ─────────────────────────────────────────────── */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center gap-1 rounded-md border bg-muted/60 p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'press focusable rounded-[5px] px-3 py-1.5 text-[13px] font-medium text-muted-foreground',
        'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-panel',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

/** ── Switch ───────────────────────────────────────────── */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'focusable relative h-6 w-11 shrink-0 rounded-full border border-border bg-muted transition-colors',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-[1px] rounded-full bg-card shadow transition-transform data-[state=checked]:translate-x-[21px]" />
    </SwitchPrimitive.Root>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** ── ทูลทิปอธิบายที่มาของตัวเลข (แตะได้บนมือถือ) ───────── */
export function InfoHint({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        aria-label={label ?? 'คำอธิบาย'}
        className="focusable grid h-4 w-4 place-items-center rounded-full text-muted-foreground/70 hover:text-accent"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-[min(320px,88vw)] rounded-md border bg-card p-3 text-xs leading-relaxed text-foreground shadow-lift data-[state=open]:animate-slide-in"
        >
          {children}
          <PopoverPrimitive.Arrow className="fill-card" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          'z-50 rounded-md border bg-card p-2 shadow-lift data-[state=open]:animate-slide-in',
          className,
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/** ── Avatar ───────────────────────────────────────────── */

/** รูปโปรไฟล์ที่อัปโหลดเองถูกเก็บเป็นคีย์ 'local:…' ต้องแปลงเป็น URL ก่อนแสดง */
function useResolvedSrc(src?: string | null) {
  const [url, setUrl] = useState<string | null>(src && !src.startsWith('local:') ? src : null);

  useEffect(() => {
    let alive = true;
    if (!src) return setUrl(null);
    if (!src.startsWith('local:')) return setUrl(src);
    photoUrl(src).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [src]);

  return url;
}

export function Avatar({
  name,
  src,
  size = 36,
  seed,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  seed?: string;
  className?: string;
}) {
  const hue = hueFrom(seed ?? name);
  const resolved = useResolvedSrc(src);
  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-md border font-medium',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: resolved ? undefined : `hsl(${hue} 42% 88%)`,
        color: `hsl(${hue} 55% 24%)`,
        fontSize: Math.max(10, size * 0.36),
      }}
      title={name}
    >
      {resolved ? (
        <img src={resolved} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="uppercase">{initials(name)}</span>
      )}
    </span>
  );
}

/** ── แถบเปอร์เซ็นต์ (เขียว ≥80 / ส้ม 50–79 / แดง <50) ──── */
export function BandBar({ pct, className, showLabel }: { pct: number; className?: string; showLabel?: boolean }) {
  const band = bandOf(pct);
  const color = band === 'ok' ? 'bg-ok' : band === 'warn' ? 'bg-warn' : 'bg-bad';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full origin-left rounded-full animate-bar-grow', color)}
          style={{ width: `${Math.min(100, Math.max(pct, 2))}%` }}
        />
      </div>
      {showLabel ? (
        <span
          className={cn(
            'num w-11 text-right text-xs font-semibold',
            band === 'ok' ? 'text-ok' : band === 'warn' ? 'text-warn' : 'text-bad',
          )}
        >
          {pct}%
        </span>
      ) : null}
    </div>
  );
}

/** ── Skeleton ─────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-muted', className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-black/[0.06] to-transparent dark:via-white/[0.06]" />
    </div>
  );
}

export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[76px] w-full" />
      ))}
    </div>
  );
}

/** ── Empty state ──────────────────────────────────────── */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center', className)}>
      {icon ? <div className="mb-3 text-muted-foreground/60">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** ── Section heading ──────────────────────────────────── */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="h-3 w-[3px] rounded-full bg-accent" />
        {children}
      </h2>
      {right}
    </div>
  );
}
