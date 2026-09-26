import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText, MapPin, Search } from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { RoundResultBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/field';
import { Avatar, EmptyState, SkeletonList } from '@/components/ui/misc';
import { FilterChip } from '@/pages/Issues';
import { useCoreData, useSession } from '@/hooks/useData';
import { personLabel, useI18n } from '@/lib/i18n';
import { formatDate, formatWeekday } from '@/lib/time';
import { VSM_LINES } from '@/lib/types';
import type { Employee, QcRound, VsmLine } from '@/lib/types';
import { cn } from '@/lib/utils';

/** ประวัติรอบตรวจทั้งหมด — รวมรอบที่ผ่าน ซึ่งไม่มีใบแจ้งให้ดูในทะเบียนปัญหา */
export default function Rounds() {
  const { t, lang } = useI18n();
  const { session } = useSession();
  const { rounds, issues, employees, pathOf, isLoading } = useCoreData();

  const [term, setTerm] = useState('');
  const [line, setLine] = useState<VsmLine | 'all'>('all');
  const [ngOnly, setNgOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rounds
      .filter((r) => (line === 'all' ? true : r.vsm_line === line))
      .filter((r) => (ngOnly ? r.result === 'ng' : true))
      .filter((r) => (mineOnly && session ? r.qc_id === session.employee_id : true))
      .filter((r) => (q ? `${r.round_no} ${r.note} ${pathOf(r.area_id)}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.round_date.localeCompare(a.round_date) || b.round_time.localeCompare(a.round_time));
  }, [rounds, line, ngOnly, mineOnly, session, term, pathOf]);

  const grouped = useMemo(() => {
    const map = new Map<string, QcRound[]>();
    filtered.forEach((r) => map.set(r.round_date, [...(map.get(r.round_date) ?? []), r]));
    return [...map.entries()];
  }, [filtered]);

  return (
    <div>
      <PageTitle title={t('round.title')} subtitle={t('round.subtitle')} />

      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('common.search')}
            className="pl-9"
          />
        </div>
        <div className="scroll-x no-scrollbar -mx-1 flex gap-1.5 px-1 pb-1">
          <FilterChip active={line === 'all'} onClick={() => setLine('all')}>
            {t('common.all')}
          </FilterChip>
          {VSM_LINES.map((l) => (
            <FilterChip key={l} active={line === l} onClick={() => setLine(l)}>
              <span className="num">{l}</span>
            </FilterChip>
          ))}
          <FilterChip active={ngOnly} onClick={() => setNgOnly((v) => !v)}>
            {t('status.ng')}
          </FilterChip>
          {session ? (
            <FilterChip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
              {t('issue.filterMine')}
            </FilterChip>
          ) : null}
        </div>
        <p className="num text-right text-[11px] text-muted-foreground">
          {filtered.length} {t('common.times')}
        </p>
      </div>

      {isLoading ? (
        <SkeletonList rows={5} />
      ) : grouped.length ? (
        <div className="space-y-5">
          {grouped.map(([date, list]) => (
            <section key={date}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[13px] font-semibold">
                  {formatWeekday(date, lang, true)} {formatDate(date, lang)}
                </h2>
                <span className="num text-[11px] text-muted-foreground">{list.length}</span>
              </div>
              <div className="space-y-2">
                {list.map((r) => {
                  const qc = employees.find((e) => e.id === r.qc_id);
                  const linked = issues.filter((i) => i.round_id === r.id);
                  return (
                    <article
                      key={r.id}
                      className={cn(
                        'panel animate-fade-up p-3.5',
                        'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[""]',
                        r.result === 'ng' ? 'before:bg-bad' : 'before:bg-ok',
                      )}
                    >
                      <div className="flex items-start gap-3 pl-1.5">
                        <Avatar
                          name={personLabel(qc, lang)}
                          src={qc?.avatar_url}
                          seed={r.qc_id}
                          size={34}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="num text-[13px] font-semibold">{r.round_time}</span>
                            <span className="num text-[11px] text-muted-foreground">{r.round_no}</span>
                            <Badge tone="accent">{r.vsm_line}</Badge>
                            <RoundResultBadge result={r.result} />
                          </div>
                          <p className="mt-1 flex items-center gap-1 truncate text-[12px] text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {pathOf(r.area_id)}
                          </p>
                          {r.qty_checked > 0 ? (
                            <p className="num mt-1 text-[11px] text-muted-foreground">
                              {t('inspect.qtyChecked')}: {r.qty_checked} {t('common.pieces')}
                            </p>
                          ) : null}

                          {/* บริบทการผลิต — โชว์เฉพาะช่องที่กรอกไว้จริง ไม่งั้นทุกการ์ดจะเต็มไปด้วย "—" */}
                          <ContextLine round={r} employees={employees} />
                          {r.note ? <p className="mt-1.5 text-[13px] leading-snug">{r.note}</p> : null}

                          {linked.length ? (
                            <div className="mt-2 space-y-1 border-t pt-2">
                              <div className="label-micro">{t('round.linkedIssues')}</div>
                              {linked.map((i) => (
                                <Link
                                  key={i.id}
                                  to={`/issues/${i.id}`}
                                  className="focusable press flex items-center gap-2 rounded-md border px-2 py-1.5 hover:bg-muted"
                                >
                                  <span className="num text-[12px] font-semibold">{i.issue_no}</span>
                                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                                    {i.description}
                                  </span>
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                </Link>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState icon={<FileText className="h-8 w-8" />} title={t('round.empty')} />
      )}
    </div>
  );
}

/**
 * บริบทการผลิตของรอบตรวจแบบย่อ — กะ · เครื่องจักร · รุ่นสินค้า · ผู้ปฏิบัติงาน
 * ทุกช่องไม่บังคับกรอก จึงแสดงเฉพาะที่มีค่า และไม่แสดงบรรทัดเลยถ้าไม่มีสักช่อง
 */
function ContextLine({ round, employees }: { round: QcRound; employees: Employee[] }) {
  const { t, lang } = useI18n();
  const operator = employees.find((e) => e.id === round.operator_id);

  const parts = [
    round.shift ? `${t('inspect.shift')} ${round.shift}` : null,
    round.machine_no || null,
    round.model_no || null,
    round.operator_id ? personLabel(operator, lang) : null,
  ].filter(Boolean) as string[];

  if (!parts.length) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {parts.map((p) => (
        <span key={p} className="rounded border bg-muted/50 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
          {p}
        </span>
      ))}
    </div>
  );
}
