import { useMemo, useState } from 'react';
import { Check, ChevronRight, Search, UserRound, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Avatar, EmptyState } from '@/components/ui/misc';
import { personLabel, useI18n } from '@/lib/i18n';
import type { Employee } from '@/lib/types';
import { cn, normalizeCode } from '@/lib/utils';

/** ทะเบียนมีเกือบสี่ร้อยคน แสดงหมดตั้งแต่เปิดจะเลื่อนหาไม่ไหวบนมือถือ */
const PREVIEW_ROWS = 40;

/**
 * เลือกคนจากทะเบียนพนักงาน — ใช้ระบุผู้ปฏิบัติงานประจำเครื่องตอนบันทึกผลตรวจ
 *
 * ค้นได้ทั้งรหัสพนักงาน ชื่อไทย ชื่ออังกฤษ และแผนก เพราะ QC จำได้ไม่เหมือนกัน
 * บางคนจำรหัสที่ปักเสื้อ บางคนจำแต่ชื่อเล่นในแผนก
 *
 * รหัสพนักงานเทียบแบบตัดขีดกลางและตัวพิมพ์ออก (normalizeCode) เหมือนตอนเข้าระบบ
 * พิมพ์ 'q001' ก็ต้องเจอ 'Q-001' ไม่งั้นผู้ใช้จะคิดว่าไม่มีคนนี้ในทะเบียน
 */
export function EmployeePicker({
  employees,
  value,
  onChange,
  placeholder,
  title,
  allowNone = true,
}: {
  employees: Employee[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** หัวกล่องเลือก — ไม่ส่งมาใช้คำของช่องผู้ปฏิบัติงาน */
  title?: string;
  /** มีตัวเลือก "ไม่ระบุ" หรือไม่ (ช่องเลือกหัวหน้าสายไม่ต้องมี) */
  allowNone?: boolean;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');

  const selected = employees.find((e) => e.id === value) ?? null;

  const rows = useMemo(() => {
    const pool = employees.filter((e) => e.is_active || e.id === value);
    const q = term.trim();
    if (!q) return pool.slice(0, PREVIEW_ROWS);
    const lower = q.toLowerCase();
    const code = normalizeCode(q);
    return pool
      .filter(
        (e) =>
          (code.length > 0 && normalizeCode(e.emp_code).includes(code)) ||
          `${e.full_name} ${e.full_name_en ?? ''} ${e.department} ${e.position ?? ''}`
            .toLowerCase()
            .includes(lower),
      )
      .slice(0, 60);
  }, [employees, term, value]);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setTerm('');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || setTerm(''))}>
      {/* ปุ่มล้างค่าอยู่นอกปุ่มเปิดกล่อง ไม่ใช่ซ้อนข้างใน — ปุ่มซ้อนปุ่มเป็น HTML ที่ไม่ถูกต้อง
          และทำให้โปรแกรมอ่านหน้าจอสับสนว่ากำลังโฟกัสอะไรอยู่ */}
      <div className="flex items-stretch gap-1">
        <DialogTrigger asChild>
          <button
            type="button"
            className={cn(
              'press focusable flex min-w-0 flex-1 items-center gap-2.5 rounded-md border bg-card px-3 py-2.5 text-left',
              !selected && 'text-muted-foreground',
            )}
          >
            <UserRound className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              {selected ? (
                <>
                  <span className="block truncate text-sm font-medium text-foreground">
                    {personLabel(selected, lang)}
                  </span>
                  <span className="num block truncate text-[11px] text-muted-foreground">
                    {selected.emp_code} · {selected.department}
                  </span>
                </>
              ) : (
                <span className="text-sm">{placeholder ?? t('inspect.pickOperator')}</span>
              )}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DialogTrigger>
        {selected ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('common.clear')}
            className="press focusable grid w-11 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <DialogContent title={title ?? t('inspect.pickOperator')} description={t('inspect.operatorHint')}>
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-3 border-b bg-card px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('common.search')}
              className="pl-9"
            />
          </div>
        </div>

        <ul className="space-y-1">
          {allowNone ? (
            <li>
              <button
                onClick={() => pick(null)}
                className="press focusable flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
                {t('inspect.operatorNone')}
              </button>
            </li>
          ) : null}
          {rows.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => pick(e.id)}
                className={cn(
                  'press focusable flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left hover:bg-muted',
                  value === e.id && 'border-accent bg-accent/10',
                )}
              >
                <Avatar name={personLabel(e, lang)} src={e.avatar_url} seed={e.id} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{personLabel(e, lang)}</span>
                  <span className="num block truncate text-[11px] text-muted-foreground">
                    {e.emp_code} · {e.department}
                  </span>
                </span>
                {value === e.id ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
              </button>
            </li>
          ))}
        </ul>

        {!rows.length ? <EmptyState icon={<Search className="h-7 w-7" />} title={t('common.noData')} /> : null}
        {!term && employees.length > PREVIEW_ROWS ? (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">{t('inspect.operatorSearchHint')}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
