import { Link } from 'react-router-dom';
import { Camera, Cog, MapPin } from 'lucide-react';
import { CategoryTag } from '@/components/ui/badge';
import { StageBar } from '@/components/IssueStepper';
import { DueBadge, SeverityBadge, STATUS_BAR, StatusBadge, VsmBadge } from '@/components/StatusBadge';
import { Avatar } from '@/components/ui/misc';
import { displayStatus } from '@/lib/calc';
import { categoryLabel, personLabel, useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/time';
import type { DefectCategory, Employee, QcIssue } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * แถวหนึ่งใบแจ้งในรายการ — ใช้ร่วมกันทุกหน้าที่แสดงรายการ
 * ทั้งหน้างานของฉัน ทะเบียนปัญหา และหน้าสรุปราย VSM ต้องหน้าตาเหมือนกัน
 * เพื่อให้ผู้ใช้จำรูปแบบได้ครั้งเดียวแล้วอ่านออกทุกที่
 */
export function IssueCard({
  issue,
  employees,
  categories,
  pathOf,
  showQc = true,
  className,
}: {
  issue: QcIssue;
  employees: Employee[];
  categories: DefectCategory[];
  pathOf: (areaId: string) => string;
  showQc?: boolean;
  className?: string;
}) {
  const { t, lang } = useI18n();
  const qc = employees.find((e) => e.id === issue.qc_id);
  const shown = issue.category_ids.slice(0, 2);
  const rest = issue.category_ids.length - shown.length;

  return (
    <Link
      to={`/issues/${issue.id}`}
      className={cn(
        'panel press focusable animate-fade-up block w-full p-3.5 text-left',
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[""]',
        STATUS_BAR[displayStatus(issue)],
        className,
      )}
    >
      <div className="flex items-start gap-3 pl-1.5">
        {showQc ? (
          <Avatar
            name={personLabel(qc, lang)}
            src={qc?.avatar_url}
            seed={issue.qc_id}
            size={34}
            className="mt-0.5"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="num text-[12px] font-semibold">{issue.issue_no}</span>
            <VsmBadge line={issue.vsm_line} />
            <SeverityBadge severity={issue.severity} />
            <StatusBadge status={displayStatus(issue)} />
          </div>

          <p className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{pathOf(issue.area_id)}</span>
            {issue.machine_no ? (
              <span className="num ml-1 flex shrink-0 items-center gap-0.5 font-medium text-foreground">
                <Cog className="h-3 w-3" />
                {issue.machine_no}
              </span>
            ) : null}
          </p>

          <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug">{issue.description}</p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {shown.map((id) => (
              <CategoryTag key={id} name={categoryLabel(categories.find((c) => c.id === id), lang)} />
            ))}
            {rest > 0 ? <span className="num text-[10px] text-muted-foreground">+{rest}</span> : null}
            {issue.photo_urls.length ? (
              <span className="num flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Camera className="h-3 w-3" />
                {issue.photo_urls.length}
              </span>
            ) : null}
          </div>

          <StageBar issue={issue} className="mt-2.5" />

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
            <DueBadge issue={issue} />
            <span className="num text-[10px] text-muted-foreground">
              {t('issue.foundAt')} {formatDate(issue.found_date, lang)} {issue.found_time}
            </span>
            {issue.qty_defect > 0 ? (
              <span className="num ml-auto text-[10px] text-muted-foreground">
                {t('issue.qtyRatio', { defect: issue.qty_defect, checked: issue.qty_checked })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
