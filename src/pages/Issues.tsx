import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, Clock, ListChecks, Plus, Search } from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { IssueCard } from '@/components/IssueCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { EmptyState, SkeletonList } from '@/components/ui/misc';
import { useCoreData, useSession } from '@/hooks/useData';
import { isActive, isOverdue, sortByUrgency } from '@/lib/calc';
import { categoryLabel, useI18n } from '@/lib/i18n';
import { VSM_LINES } from '@/lib/types';
import type { VsmLine } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function Issues() {
  const { t, lang } = useI18n();
  const { session, canInspect } = useSession();
  const { issues, employees, categories, pathOf, isLoading } = useCoreData();

  const [term, setTerm] = useState('');
  const [line, setLine] = useState<VsmLine | 'all'>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    const rows = issues
      .filter((i) => (line === 'all' ? true : i.vsm_line === line))
      .filter((i) => (activeOnly ? isActive(i.status) : true))
      .filter((i) => (overdueOnly ? isOverdue(i) : true))
      .filter((i) => (criticalOnly ? i.severity === 'critical' : true))
      .filter((i) => (mineOnly && session ? i.qc_id === session.employee_id : true))
      .filter((i) => {
        if (!q) return true;
        const cats = i.category_ids
          .map((id) => categoryLabel(categories.find((c) => c.id === id), lang))
          .join(' ');
        return `${i.issue_no} ${i.description} ${i.part_no} ${i.lot_no} ${pathOf(i.area_id)} ${cats}`
          .toLowerCase()
          .includes(q);
      });
    return sortByUrgency(rows);
  }, [issues, line, activeOnly, overdueOnly, criticalOnly, mineOnly, session, term, categories, lang, pathOf]);

  const counts = useMemo(
    () => ({
      overdue: issues.filter((i) => isOverdue(i)).length,
      critical: issues.filter((i) => i.severity === 'critical' && isActive(i.status)).length,
    }),
    [issues],
  );

  return (
    <div>
      <PageTitle
        title={t('issue.title')}
        subtitle={t('issue.subtitle')}
        right={
          canInspect ? (
            <Button variant="accent" size="sm" asChild>
              <Link to="/issues/new">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t('issue.newTitle')}</span>
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('issue.searchPlaceholder')}
            className="pl-9"
          />
        </div>

        {/* กรองตามสาย — สี่สายจึงวางเรียงให้เห็นครบพร้อมกัน */}
        <div className="scroll-x no-scrollbar -mx-1 flex gap-1.5 px-1 pb-1">
          <FilterChip active={line === 'all'} onClick={() => setLine('all')}>
            {t('common.all')}
          </FilterChip>
          {VSM_LINES.map((l) => (
            <FilterChip key={l} active={line === l} onClick={() => setLine(l)}>
              <span className="num">{l}</span>
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={activeOnly} onClick={() => setActiveOnly((v) => !v)}>
            {t('issue.filterActive')}
          </FilterChip>
          <FilterChip active={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
            <Clock className="h-3.5 w-3.5" />
            {t('issue.filterOverdue')}
            {counts.overdue ? <span className="num">{counts.overdue}</span> : null}
          </FilterChip>
          <FilterChip active={criticalOnly} onClick={() => setCriticalOnly((v) => !v)}>
            <AlertOctagon className="h-3.5 w-3.5" />
            {t('issue.filterCritical')}
            {counts.critical ? <span className="num">{counts.critical}</span> : null}
          </FilterChip>
          {session ? (
            <FilterChip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
              {t('issue.filterMine')}
            </FilterChip>
          ) : null}
          <span className="num ml-auto self-center text-[11px] text-muted-foreground">
            {filtered.length} {t('common.items')}
          </span>
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={5} />
      ) : filtered.length ? (
        <div className="space-y-2">
          {filtered.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              employees={employees}
              categories={categories}
              pathOf={pathOf}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={<ListChecks className="h-8 w-8" />} title={t('issue.empty')} hint={t('issue.emptyHint')} />
      )}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'press focusable flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium',
        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
