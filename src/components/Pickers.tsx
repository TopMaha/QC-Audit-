import { Check } from 'lucide-react';
import { categoryLabel, useI18n } from '@/lib/i18n';
import { SEVERITIES, SHIFTS, VSM_LINES } from '@/lib/types';
import type { DefectCategory, Severity, Shift, VsmLine } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * เลือกสายที่รับผิดชอบ — มีแค่สี่ค่า จึงวางเป็นปุ่มให้เห็นครบในครั้งเดียว
 * ดีกว่า dropdown เพราะกดด้วยนิ้วโป้งข้างเดียวได้ขณะยืนอยู่หน้าไลน์
 */
export function VsmPicker({
  value,
  onChange,
  className,
}: {
  value: VsmLine | null;
  onChange: (v: VsmLine) => void;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-4 gap-1.5', className)}>
      {VSM_LINES.map((line) => {
        const on = value === line;
        return (
          <button
            key={line}
            type="button"
            onClick={() => onChange(line)}
            aria-pressed={on}
            className={cn(
              'press focusable num h-11 rounded-md border text-[13px] font-semibold',
              on ? 'border-accent bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {line}
          </button>
        );
      })}
    </div>
  );
}

/**
 * เลือกกะ — สามค่าบวก "ไม่ระบุ" จึงวางเป็นปุ่มเรียงเดียวเหมือน VsmPicker
 * ระบบเติมกะให้จากเวลาที่บันทึกอยู่แล้ว ปุ่มพวกนี้มีไว้แก้ตอนที่มันเดาผิด
 * (บันทึกย้อนหลัง หรือรอบที่คร่อมเวลาเปลี่ยนกะ)
 */
export function ShiftPicker({
  value,
  onChange,
  className,
}: {
  value: Shift | null;
  onChange: (v: Shift | null) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn('grid grid-cols-4 gap-1.5', className)}>
      {SHIFTS.map((s) => {
        const on = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={on}
            className={cn(
              'press focusable h-11 rounded-md border text-[13px] font-semibold',
              on ? 'border-accent bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="num">{s}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          'press focusable h-11 rounded-md border text-[12px]',
          value === null
            ? 'border-accent bg-accent/15 font-medium'
            : 'bg-card text-muted-foreground hover:text-foreground',
        )}
      >
        {t('common.none')}
      </button>
    </div>
  );
}

/** ความรุนแรง — เรียงจากหนักไปเบา และใช้สีเดียวกับ SeverityBadge */
const SEVERITY_ON: Record<Severity, string> = {
  critical: 'border-bad bg-bad/15 text-bad',
  major: 'border-warn bg-warn/15 text-warn',
  minor: 'border-foreground/40 bg-muted text-foreground',
};

export function SeverityPicker({
  value,
  onChange,
  className,
}: {
  value: Severity;
  onChange: (v: Severity) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn('grid grid-cols-3 gap-1.5', className)}>
      {SEVERITIES.map((s) => {
        const on = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={on}
            className={cn(
              'press focusable h-11 rounded-md border text-[13px] font-medium',
              on ? SEVERITY_ON[s] : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`severity.${s}` as 'severity.critical')}
          </button>
        );
      })}
    </div>
  );
}

/**
 * เลือกประเภทข้อบกพร่องได้สูงสุด 3 รายการ
 * เกินสามแล้วปุ่มที่ยังไม่ถูกเลือกจะกดไม่ได้ ไม่ใช่เงียบ ๆ ไม่ทำอะไร
 * ผู้ใช้จะได้รู้ว่าติดเพดาน ไม่ใช่คิดว่าปุ่มเสีย
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  max = 3,
}: {
  categories: DefectCategory[];
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const { t, lang } = useI18n();
  const active = categories.filter((c) => c.is_active || value.includes(c.id));
  const full = value.length >= max;

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (!full) onChange([...value, id]);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {active.map((c) => {
          const on = value.includes(c.id);
          const name = categoryLabel(c, lang);
          const m = /^(\d+)[-.\s]\s*(.*)$/.exec(name);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              disabled={!on && full}
              aria-pressed={on}
              className={cn(
                'press focusable flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[12px]',
                on ? 'border-accent bg-accent/15 font-medium' : 'bg-card text-muted-foreground',
                !on && full && 'opacity-40',
              )}
            >
              {on ? <Check className="h-3 w-3 text-accent" /> : m ? <span className="num font-semibold text-accent">{m[1]}</span> : null}
              <span className="max-w-[190px] truncate">{m ? m[2] : name}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {t('inspect.pickCategoryHint')} · {value.length}/{max}
      </p>
    </div>
  );
}
