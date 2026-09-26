import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Target } from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { ExcelExportButton } from '@/components/ExcelExportButton';
import { SeverityBadge, StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, StatBlock } from '@/components/ui/card';
import {
  Avatar,
  BandBar,
  EmptyState,
  InfoHint,
  SectionTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/misc';
import { useCoreData, useSession, useSettings } from '@/hooks/useData';
import { bandOf, byCategory, byQc, byVsm, displayStatus, issuesInRange, pctOf, roundsInRange, summarize } from '@/lib/calc';
import { categoryLabel, personLabel, useI18n } from '@/lib/i18n';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  formatDate,
  formatMonth,
  formatRange,
  monthKey,
  rangeDays,
  startOfMonth,
  startOfWeek,
  todayISO,
} from '@/lib/time';
import { SEVERITIES } from '@/lib/types';
import type { DisplayStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

type Scope = 'week' | 'month';

const STATUS_ORDER: DisplayStatus[] = ['open', 'acked', 'in_progress', 'fixed', 'rejected', 'verified', 'cancelled'];

export default function Dashboard() {
  const { t, lang } = useI18n();
  const { session, admin } = useSession();
  const { issues, rounds, fixes, categories, activeEmployees, isLoading } = useCoreData();
  const { data: settings } = useSettings();

  const [scope, setScope] = useState<Scope>('week');
  const [offset, setOffset] = useState(0);

  const today = todayISO();

  const { from, to, label } = useMemo(() => {
    if (scope === 'week') {
      const anchor = addDays(today, offset * 7);
      const s = startOfWeek(anchor);
      const e = endOfWeek(anchor);
      return { from: s, to: e, label: formatRange(s, e, lang) };
    }
    const anchor = addMonths(today, offset);
    const s = startOfMonth(anchor);
    return { from: s, to: endOfMonth(anchor), label: formatMonth(monthKey(anchor), lang, true) };
  }, [scope, offset, today, lang]);

  const scopedIssues = useMemo(() => issuesInRange(issues, from, to), [issues, from, to]);
  const scopedRounds = useMemo(() => roundsInRange(rounds, from, to), [rounds, from, to]);
  const stats = useMemo(() => summarize(scopedIssues, fixes), [scopedIssues, fixes]);
  const vsmRows = useMemo(() => byVsm(scopedIssues), [scopedIssues]);
  const categoryRows = useMemo(() => byCategory(scopedIssues, categories), [scopedIssues, categories]);
  const qcRows = useMemo(
    () => byQc(activeEmployees, scopedRounds, scopedIssues),
    [activeEmployees, scopedRounds, scopedIssues],
  );
  const days = useMemo(() => rangeDays(from, to), [from, to]);

  const ngRate = pctOf(scopedRounds.filter((r) => r.result === 'ng').length, scopedRounds.length);
  const target = settings?.target_ontime_pct ?? 90;

  if (!admin && session && !session.dashboard_enabled) {
    return (
      <div>
        <PageTitle title={t('dash.title')} />
        <EmptyState icon={<Lock className="h-8 w-8" />} title={t('dash.noAccess')} hint={t('dash.noAccessHint')} />
      </div>
    );
  }

  const maxPerDay = Math.max(1, ...days.map((d) => scopedIssues.filter((i) => i.found_date === d).length));

  return (
    <div>
      <PageTitle
        title={t('dash.title')}
        right={<ExcelExportButton from={from} to={to} size="sm" />}
      />

      {/* ตัวเลือกช่วงเวลา */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={scope} onValueChange={(v) => (setScope(v as Scope), setOffset(0))}>
          <TabsList>
            <TabsTrigger value="week">{t('common.week')}</TabsTrigger>
            <TabsTrigger value="month">{t('common.month')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-1 rounded-md border bg-card px-1 py-0.5">
          <Button variant="ghost" size="iconSm" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="num min-w-[130px] text-center text-[12px] font-medium">{label}</span>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset >= 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[86px]" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">{t('dash.tabOverview')}</TabsTrigger>
            <TabsTrigger value="vsm">{t('dash.tabVsm')}</TabsTrigger>
            <TabsTrigger value="category">{t('dash.tabCategory')}</TabsTrigger>
          </TabsList>

          {/* ── ภาพรวม ─────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatBlock
                label={t('dash.openIssues')}
                value={stats.active}
                tone={stats.active ? 'warn' : 'ok'}
                sub={`${t('dash.totalIssues')} ${stats.total}`}
              />
              <StatBlock
                label={t('dash.overdue')}
                value={stats.overdue}
                tone={stats.overdue ? 'bad' : 'ok'}
                sub={`${t('severity.critical')} ${scopedIssues.filter((i) => i.severity === 'critical').length}`}
              />
              <StatBlock
                label={t('dash.onTime')}
                value={stats.onTimePct}
                unit="%"
                tone={bandOf(stats.onTimePct)}
                sub={`${stats.closedOnTime}/${stats.verified}`}
                hint={
                  <InfoHint label={t('dash.onTime')}>
                    <p className="font-medium">{t('dash.onTime')}</p>
                    <p className="mt-1 text-muted-foreground">{t('dash.onTimeHint')}</p>
                    <p className="num mt-2">
                      {stats.closedOnTime} ÷ {stats.verified} × 100 = {stats.onTimePct}%
                    </p>
                    <p className="num mt-1 text-muted-foreground">
                      {t('dash.target')}: {target}%
                    </p>
                  </InfoHint>
                }
              />
              <StatBlock
                label={t('dash.avgClose')}
                value={stats.avgCloseDays}
                unit={t('common.days')}
                tone="accent"
                sub={`${t('dash.rework')} ${stats.reworkPct}%`}
                hint={
                  <InfoHint label={t('dash.avgClose')}>
                    <p className="font-medium">{t('dash.avgClose')}</p>
                    <p className="mt-1 text-muted-foreground">{t('dash.avgCloseHint')}</p>
                    <p className="mt-2 font-medium">{t('dash.rework')}</p>
                    <p className="mt-1 text-muted-foreground">{t('dash.reworkHint')}</p>
                  </InfoHint>
                }
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader
                  title={t('dash.statusMix')}
                  right={
                    <Badge tone="neutral" size="md">
                      {stats.total} {t('common.items')}
                    </Badge>
                  }
                />
                <CardBody className="space-y-2.5">
                  {STATUS_ORDER.map((s) => {
                    const n = scopedIssues.filter((i) => displayStatus(i) === s).length;
                    return (
                      <div key={s} className="flex items-center gap-3">
                        <span className="w-[130px] shrink-0">
                          <StatusBadge status={s} />
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full origin-left rounded-full bg-accent animate-bar-grow"
                            style={{ width: `${stats.total ? (n / stats.total) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="num w-8 text-right text-[12px] font-semibold">{n}</span>
                      </div>
                    );
                  })}
                  {!stats.total ? <EmptyState title={t('common.noData')} className="border-0 py-4" /> : null}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title={t('dash.totalRounds')}
                  hint={t('dash.ngRateHint')}
                  right={
                    <Badge tone={ngRate > 30 ? 'bad' : 'neutral'} size="md">
                      {t('dash.ngRate')} {ngRate}%
                    </Badge>
                  }
                />
                <CardBody className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-[34px] font-semibold leading-none">{scopedRounds.length}</span>
                    <span className="num text-sm text-muted-foreground">{t('common.times')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {SEVERITIES.map((s) => (
                      <div key={s} className="rounded-md border px-2.5 py-2">
                        <div className="mb-1">
                          <SeverityBadge severity={s} />
                        </div>
                        <div className="num text-[18px] font-semibold">
                          {scopedIssues.filter((i) => i.severity === s).length}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* แนวโน้มรายวัน — แท่งเรียบ ๆ พอให้เห็นว่าวันไหนเจอเยอะผิดปกติ */}
            <Card>
              <CardHeader title={t('dash.trend')} hint={t('dash.trendHint')} />
              <CardBody>
                <div className="scroll-x">
                  <div className="flex min-w-full items-end gap-1" style={{ height: 120 }}>
                    {days.map((d) => {
                      const n = scopedIssues.filter((i) => i.found_date === d).length;
                      return (
                        <div key={d} className="flex min-w-[16px] flex-1 flex-col items-center gap-1">
                          <div className="flex w-full flex-1 items-end">
                            <div
                              title={`${formatDate(d, lang)} · ${n}`}
                              className={cn(
                                'w-full rounded-t-[3px] transition-all',
                                n === 0 ? 'bg-muted' : 'bg-accent',
                              )}
                              style={{ height: `${Math.max(2, (n / maxPerDay) * 100)}%` }}
                            />
                          </div>
                          <span className="num text-[9px] text-muted-foreground">{Number(d.slice(8, 10))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('dash.qcActivity')} />
              <CardBody className="space-y-1.5">
                {qcRows.length ? (
                  qcRows.slice(0, 8).map((row) => (
                    <div
                      key={row.employee.id}
                      className={cn(
                        'flex items-center gap-3 rounded-md border px-3 py-2',
                        row.employee.id === session?.employee_id && 'border-accent bg-accent/10',
                      )}
                    >
                      <Avatar
                        name={personLabel(row.employee, lang)}
                        src={row.employee.avatar_url}
                        seed={row.employee.id}
                        size={28}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{personLabel(row.employee, lang)}</div>
                        <div className="num text-[10px] text-muted-foreground">{row.employee.emp_code}</div>
                      </div>
                      <div className="num text-right">
                        <div className="text-[13px] font-semibold">
                          {row.rounds} <span className="text-[10px] font-normal text-muted-foreground">{t('common.times')}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {t('dash.ngRate')} {row.ngRatePct}%
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title={t('common.noData')} className="border-0 py-6" />
                )}
              </CardBody>
            </Card>
          </TabsContent>

          {/* ── ราย VSM ────────────────────────────────── */}
          <TabsContent value="vsm" className="space-y-4">
            <Card>
              <CardHeader
                title={t('dash.vsmTable')}
                hint={t('dash.vsmHint')}
                right={
                  <Badge tone="accent" size="md">
                    <Target className="h-3 w-3" />
                    {target}%
                  </Badge>
                }
              />
              <div className="scroll-x">
                <table className="w-full min-w-[620px] border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="label-micro px-3 py-2 text-left">{t('vsm.rank')}</th>
                      <th className="label-micro px-3 py-2 text-left">{t('common.line')}</th>
                      <th className="label-micro px-2 py-2 text-right">{t('dash.totalIssues')}</th>
                      <th className="label-micro px-2 py-2 text-right">{t('dash.openIssues')}</th>
                      <th className="label-micro px-2 py-2 text-right">{t('dash.overdue')}</th>
                      <th className="label-micro px-2 py-2 text-right">{t('dash.avgClose')}</th>
                      <th className="label-micro px-3 py-2 text-right">{t('dash.onTime')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vsmRows.map((row) => (
                      <tr key={row.vsm_line} className="border-b last:border-0">
                        <td className="num px-3 py-2 text-[13px] font-semibold text-muted-foreground">{row.rank}</td>
                        <td className="px-3 py-2">
                          <Badge tone="accent" size="md">
                            {row.vsm_line}
                          </Badge>
                        </td>
                        <td className="num px-2 py-2 text-right text-[13px]">{row.total}</td>
                        <td className="num px-2 py-2 text-right text-[13px]">{row.active}</td>
                        <td
                          className={cn(
                            'num px-2 py-2 text-right text-[13px] font-semibold',
                            row.overdue ? 'text-bad' : 'text-muted-foreground',
                          )}
                        >
                          {row.overdue}
                        </td>
                        <td className="num px-2 py-2 text-right text-[13px]">{row.avgCloseDays}</td>
                        <td className="px-3 py-2">
                          <BandBar pct={row.onTimePct} showLabel className="min-w-[110px]" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ── ราย ประเภทข้อบกพร่อง ───────────────────── */}
          <TabsContent value="category" className="space-y-4">
            <Card>
              <CardHeader title={t('dash.topCategories')} hint={`${label} · ${stats.total} ${t('common.items')}`} />
              <CardBody className="space-y-3">
                {categoryRows.length ? (
                  categoryRows.map((row) => (
                    <div key={row.category.id}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {categoryLabel(row.category, lang)}
                        </span>
                        <span className="num shrink-0 text-[11px] font-semibold">
                          {row.count}
                          {row.qtyDefect > 0 ? (
                            <span className="ml-1 font-normal text-muted-foreground">
                              · {row.qtyDefect} {t('common.pieces')}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full origin-left rounded-full bg-accent animate-bar-grow"
                          style={{ width: `${Math.max(2, row.pct)}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title={t('common.noData')} className="border-0 py-6" />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('report.byLine')} />
              <CardBody className="space-y-3">
                {vsmRows.map((row) => (
                  <div key={row.vsm_line}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <SectionTitle>{row.vsm_line}</SectionTitle>
                      <span className="num text-[11px] text-muted-foreground">
                        {row.total} {t('common.items')}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {byCategory(
                        scopedIssues.filter((i) => i.vsm_line === row.vsm_line),
                        categories,
                      )
                        .slice(0, 4)
                        .map((c) => (
                          <span
                            key={c.category.id}
                            className="rounded-sm border bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground"
                          >
                            {categoryLabel(c.category, lang)}
                            <span className="num ml-1 font-semibold text-foreground">{c.count}</span>
                          </span>
                        ))}
                      {!row.total ? <span className="text-[11px] text-muted-foreground">{t('vsm.noIssues')}</span> : null}
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
