import { useMemo, useState } from 'react';
import { Check, ChevronRight, CornerDownLeft, MapPin, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/misc';
import { areaLabel, childrenOf, fullPath, hasChildren, searchAreas, vsmOfArea } from '@/lib/areaTree';
import { useI18n } from '@/lib/i18n';
import type { Area } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * เลือกจุดตรวจแบบลำดับชั้น (สายการผลิต › สถานี)
 *  - แตะชื่อ = เลือกจุดนั้น
 *  - แตะปุ่ม ›  = เข้าไปดูจุดย่อย
 *  - พิมพ์ค้นหา = ค้นได้ทุกระดับ พร้อมแสดงเส้นทางเต็ม
 *
 * แสดงสาย VSM ของทุกแถวไว้ด้วย เพราะการเลือกจุดตรวจคือการเลือกว่าใครต้องแก้
 * ถ้าไม่เห็นสายตอนเลือก QC จะรู้ตัวว่าส่งผิดสายก็ต่อเมื่อกดบันทึกไปแล้ว
 */
export function AreaPicker({
  areas,
  value,
  onChange,
  placeholder,
}: {
  areas: Area[];
  value: string | null;
  onChange: (areaId: string) => void;
  placeholder?: string;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  const selected = areas.find((a) => a.id === value);
  const rows = useMemo(() => childrenOf(areas, parent), [areas, parent]);
  const results = useMemo(() => searchAreas(areas, term, lang), [areas, term, lang]);

  const crumbs = useMemo(() => {
    const out: Area[] = [];
    let cur = parent ? areas.find((a) => a.id === parent) : undefined;
    let guard = 0;
    while (cur && guard++ < 10) {
      out.unshift(cur);
      cur = cur.parent_id ? areas.find((a) => a.id === cur!.parent_id) : undefined;
    }
    return out;
  }, [areas, parent]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setTerm('');
  };

  const lineOf = (id: string) => vsmOfArea(areas, id);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setParent(selected?.parent_id ?? null);
        else setTerm('');
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            'press focusable flex w-full items-center gap-2.5 rounded-md border bg-card px-3 py-2.5 text-left',
            !selected && 'text-muted-foreground',
          )}
        >
          <MapPin className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            {selected ? (
              <>
                <span className="block truncate text-sm font-medium text-foreground">{areaLabel(selected, lang)}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {fullPath(areas, selected.id, lang)}
                </span>
              </>
            ) : (
              <span className="text-sm">{placeholder ?? t('inspect.pickArea')}</span>
            )}
          </span>
          {selected && lineOf(selected.id) ? <Badge tone="accent">{lineOf(selected.id)}</Badge> : null}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DialogTrigger>

      <DialogContent title={t('inspect.pickArea')} description={t('admin.areaVsmHint')}>
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

          {!term ? (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <button
                onClick={() => setParent(null)}
                className={cn(
                  'focusable rounded px-1 py-0.5 hover:text-foreground',
                  !parent && 'font-semibold text-foreground',
                )}
              >
                {t('common.all')}
              </button>
              {crumbs.map((c) => (
                <span key={c.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  <button onClick={() => setParent(c.id)} className="focusable rounded px-1 py-0.5 hover:text-foreground">
                    {areaLabel(c, lang)}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {term ? (
          results.length ? (
            <ul className="space-y-1">
              {results.map(({ area, path }) => (
                <li key={area.id}>
                  <button
                    onClick={() => pick(area.id)}
                    className="press focusable flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{areaLabel(area, lang)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{path}</span>
                    </span>
                    {lineOf(area.id) ? <Badge tone="accent">{lineOf(area.id)}</Badge> : null}
                    {value === area.id ? <Check className="h-4 w-4 text-accent" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Search className="h-7 w-7" />} title={t('common.noData')} />
          )
        ) : (
          <ul className="space-y-1">
            {crumbs.length ? (
              <li>
                <button
                  onClick={() => pick(crumbs[crumbs.length - 1].id)}
                  className="press focusable flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted"
                >
                  <CornerDownLeft className="h-3.5 w-3.5" />
                  {t('common.select')} “{areaLabel(crumbs[crumbs.length - 1], lang)}”
                </button>
              </li>
            ) : null}
            {rows.map((area) => {
              const drillable = hasChildren(areas, area.id);
              const isSelected = value === area.id;
              const line = lineOf(area.id);
              return (
                <li key={area.id} className="flex items-stretch gap-1">
                  <button
                    onClick={() => pick(area.id)}
                    className={cn(
                      'press focusable flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2.5 text-left hover:bg-muted',
                      isSelected && 'border-accent bg-accent/10',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{areaLabel(area, lang)}</span>
                    {line ? <Badge tone="accent">{line}</Badge> : null}
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
                  </button>
                  {drillable ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-auto w-11 shrink-0"
                      onClick={() => setParent(area.id)}
                      aria-label={areaLabel(area, lang)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
