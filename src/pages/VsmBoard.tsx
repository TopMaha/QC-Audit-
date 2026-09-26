import { useMemo, useState } from 'react';
import { Medal } from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { IssueCard } from '@/components/IssueCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { BandBar, EmptyState, SkeletonList } from '@/components/ui/misc';
import { FilterChip } from '@/pages/Issues';
import { useCoreData } from '@/hooks/useData';
import { byVsm, isActive, sortByUrgency } from '@/lib/calc';
import { useI18n } from '@/lib/i18n';
import { VSM_LINES } from '@/lib/types';
import type { VsmLine } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * สรุปราย VSM — เทียบผลงานสี่สายเคียงกัน แล้วเจาะดูงานค้างของสายที่เลือกได้
 * ใช้ข้อมูลทั้งหมด ไม่จำกัดช่วงเวลา เพราะงานที่ค้างจากเดือนก่อนก็ยังค้างอยู่จริง
 */
export default function VsmBoard() {
  const { t } = useI18n();
  const { issues, employees, categories, pathOf, isLoading } = useCoreData();
  const [selected, setSelected] = useState<VsmLine>('VSM1');

  const rows = useMemo(() => byVsm(issues), [issues]);
  const lineIssues = useMemo(
    () => sortByUrgency(issues.filter((i) => i.vsm_line === selected && isActive(i.status))),
    [issues, selected],
  );

  if (isLoading) return <SkeletonList rows={5} />;

  return (
    <div>
      <PageTitle title={t('vsm.title')} subtitle={t('vsm.subtitle')} />

      <div className="stagger mb-4 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <Card
            key={row.vsm_line}
            className={cn('p-3.5', row.vsm_line === selected && 'ring-1 ring-accent')}
          >
            <div className="flex items-center gap-2">
              <Badge tone="accent" size="md">
                {row.vsm_line}
              </Badge>
              {row.rank === 1 ? (
                <Badge tone="ok">
                  <Medal className="h-3 w-3" />
                  {t('vsm.rank')} 1
                </Badge>
              ) : (
                <span className="num text-[11px] text-muted-foreground">
                  {t('vsm.rank')} {row.rank}
                </span>
              )}
              {row.critical ? (
                <Badge tone="bad" className="ml-auto normal-case tracking-normal">
                  {t('severity.critical')} {row.critical}
                </Badge>
              ) : null}
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Cell label={t('dash.openIssues')} value={row.active} tone={row.active ? 'warn' : 'ok'} />
              <Cell label={t('dash.overdue')} value={row.overdue} tone={row.overdue ? 'bad' : 'ok'} />
              <Cell label={t('dash.avgClose')} value={row.avgCloseDays} suffix={t('common.days')} />
            </div>

            <div className="mt-2.5">
              <div className="label-micro mb-1">{t('dash.onTime')}</div>
              <BandBar pct={row.onTimePct} showLabel />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title={t('vsm.detailOf', { vsm: selected })}
          hint={t('vsm.workload')}
          right={
            <div className="flex gap-1.5">
              {VSM_LINES.map((l) => (
                <FilterChip key={l} active={selected === l} onClick={() => setSelected(l)}>
                  <span className="num">{l}</span>
                </FilterChip>
              ))}
            </div>
          }
        />
        <CardBody className="space-y-2">
          {lineIssues.length ? (
            lineIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                employees={employees}
                categories={categories}
                pathOf={pathOf}
              />
            ))
          ) : (
            <EmptyState title={t('vsm.noIssues')} className="border-0 py-8" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Cell({
  label,
  value,
  suffix,
  tone = 'default',
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
}) {
  const toneClass = {
    default: 'text-foreground',
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
  }[tone];
  return (
    <div className="rounded-md border px-2.5 py-2">
      <div className="label-micro truncate">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={cn('num text-[19px] font-semibold leading-none', toneClass)}>{value}</span>
        {suffix ? <span className="num text-[10px] text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}
