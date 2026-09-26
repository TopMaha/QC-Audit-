import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { ExcelExportButton } from '@/components/ExcelExportButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, StatBlock } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { BandBar } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { useChangeHistory, useCoreData, useSession } from '@/hooks/useData';
import { ageDays, bandOf, byCategory, byVsm, closedOnTime, issuesInRange, roundsInRange, summarize } from '@/lib/calc';
import { downloadText, toCsv } from '@/lib/csv';
import { areaLabelOf, categoryLabel, personLabel, useI18n } from '@/lib/i18n';
import { addDays, todayISO } from '@/lib/time';

/** ส่งออกข้อมูลสำหรับผู้ตรวจสอบ — CSV ใส่ BOM ไว้แล้ว เปิดใน Excel อ่านภาษาไทยได้ */
export default function Report() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { admin } = useSession();
  const { issues, rounds, fixes, employees, areas, categories, pathOf } = useCoreData();
  const { data: changes = [] } = useChangeHistory();

  const [from, setFrom] = useState(addDays(todayISO(), -29));
  const [to, setTo] = useState(todayISO());

  const scopedIssues = useMemo(() => issuesInRange(issues, from, to), [issues, from, to]);
  const scopedRounds = useMemo(() => roundsInRange(rounds, from, to), [rounds, from, to]);
  const stats = useMemo(() => summarize(scopedIssues, fixes), [scopedIssues, fixes]);
  const vsmRows = useMemo(() => byVsm(scopedIssues), [scopedIssues]);
  const categoryRows = useMemo(() => byCategory(scopedIssues, categories), [scopedIssues, categories]);

  if (!admin) return <Navigate to="/admin" replace />;

  const nameOf = (id: string) => personLabel(employees.find((e) => e.id === id), lang);
  const codeOf = (id: string) => employees.find((e) => e.id === id)?.emp_code ?? '';

  const exportIssues = () => {
    const header = [
      'เลขที่ใบแจ้ง', 'วันที่พบ', 'เวลา', 'รหัส QC', 'ชื่อ QC', 'จุดตรวจ', 'สาย VSM',
      'ประเภทข้อบกพร่อง', 'ความรุนแรง', 'รหัสชิ้นงาน', 'เลขที่ล็อต', 'ตรวจ (ชิ้น)', 'เสีย (ชิ้น)',
      'รายละเอียด', 'กะ', 'เครื่องจักร', 'รุ่นสินค้า', 'ผู้ปฏิบัติงาน', 'มีบันทึกเสียง',
      'กำหนดแก้ไข', 'สถานะ', 'วันที่ปิด', 'ทันกำหนด', 'จำนวนวัน', 'ครั้งที่แก้ไข', 'จำนวนรูป',
    ];
    const rows = scopedIssues.map((i) => {
      const myFixes = fixes.filter((f) => f.issue_id === i.id);
      const onTime = closedOnTime(i);
      return [
        i.issue_no,
        i.found_date,
        i.found_time,
        codeOf(i.qc_id),
        nameOf(i.qc_id),
        pathOf(i.area_id),
        i.vsm_line,
        i.category_ids.map((c) => categoryLabel(categories.find((x) => x.id === c), lang)).join(' | '),
        t(`severity.${i.severity}` as 'severity.critical'),
        i.part_no,
        i.lot_no,
        i.qty_checked,
        i.qty_defect,
        i.description,
        i.shift ?? '',
        i.machine_no,
        i.model_no,
        i.operator_id ? nameOf(i.operator_id) : '',
        i.voice_url ? 'ใช่' : '',
        i.due_date,
        t(`status.${i.status}` as 'status.open'),
        i.closed_at ? i.closed_at.slice(0, 10) : '',
        onTime === null ? '' : onTime ? 'ใช่' : 'ไม่',
        ageDays(i),
        myFixes.length,
        i.photo_urls.length,
      ];
    });
    downloadText(`qc-issues-${from}-to-${to}.csv`, toCsv([header, ...rows]));
    toast(t('report.exported'));
  };

  const exportRounds = () => {
    const header = [
      'รอบที่', 'วันที่', 'เวลา', 'รหัส QC', 'ชื่อ QC', 'จุดตรวจ', 'สาย VSM', 'ตรวจ (ชิ้น)',
      'กะ', 'เครื่องจักร', 'รุ่นสินค้า', 'ผู้ปฏิบัติงาน', 'ผล', 'หมายเหตุ', 'ใบแจ้งที่เปิด',
    ];
    const rows = scopedRounds.map((r) => [
      r.round_no,
      r.round_date,
      r.round_time,
      codeOf(r.qc_id),
      nameOf(r.qc_id),
      pathOf(r.area_id),
      r.vsm_line,
      r.qty_checked,
      r.shift ?? '',
      r.machine_no,
      r.model_no,
      r.operator_id ? nameOf(r.operator_id) : '',
      r.result === 'ng' ? 'พบข้อบกพร่อง' : 'ผ่าน',
      r.note,
      issues.filter((i) => i.round_id === r.id).map((i) => i.issue_no).join(' | '),
    ]);
    downloadText(`qc-rounds-${from}-to-${to}.csv`, toCsv([header, ...rows]));
    toast(t('report.exported'));
  };

  const exportAudit = () => {
    const header = ['เวลา', 'ตาราง', 'รหัสรายการ', 'การกระทำ', 'ฟิลด์', 'ค่าเดิม', 'ค่าใหม่', 'ผู้แก้ไข'];
    const rows = changes.map((c) => [
      c.changed_at,
      c.table_name,
      c.record_id,
      c.action_type,
      c.field ?? '',
      c.old_value ?? '',
      c.new_value ?? '',
      c.changed_by,
    ]);
    downloadText(`qc-audit-${from}-to-${to}.csv`, toCsv([header, ...rows]));
    toast(t('report.exported'));
  };

  return (
    <div>
      <PageTitle title={t('report.title')} subtitle={t('report.subtitle')} />

      <Card className="mb-4">
        <CardHeader title={t('report.range')} />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('report.from')}>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('report.to')}>
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExcelExportButton from={from} to={to} />
            <Button variant="outline" onClick={exportIssues}>
              <Download className="h-4 w-4" />
              {t('report.exportIssues')}
            </Button>
            <Button variant="outline" onClick={exportRounds}>
              <Download className="h-4 w-4" />
              {t('report.exportRounds')}
            </Button>
            <Button variant="outline" onClick={exportAudit}>
              <Download className="h-4 w-4" />
              {t('report.exportAudit')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="stagger mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBlock label={t('dash.totalIssues')} value={stats.total} />
        <StatBlock label={t('dash.totalRounds')} value={scopedRounds.length} />
        <StatBlock label={t('dash.overdue')} value={stats.overdue} tone={stats.overdue ? 'bad' : 'ok'} />
        <StatBlock label={t('dash.onTime')} value={stats.onTimePct} unit="%" tone={bandOf(stats.onTimePct)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={t('report.byLine')} />
          <CardBody className="space-y-3">
            {vsmRows.map((row) => (
              <div key={row.vsm_line}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge tone="accent">{row.vsm_line}</Badge>
                  <span className="num text-[11px] text-muted-foreground">
                    {row.total} {t('common.items')} · {t('dash.overdue')} {row.overdue}
                  </span>
                </div>
                <BandBar pct={row.onTimePct} showLabel />
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('report.byCategory')} />
          <CardBody className="space-y-2">
            {categoryRows.length ? (
              categoryRows.map((row) => (
                <div key={row.category.id} className="flex items-center gap-2 border-b py-1.5 last:border-0">
                  <span className="min-w-0 flex-1 truncate text-[12px]">{categoryLabel(row.category, lang)}</span>
                  <span className="num text-[12px] font-semibold">{row.count}</span>
                  <span className="num w-12 text-right text-[10px] text-muted-foreground">{row.pct}%</span>
                </div>
              ))
            ) : (
              <p className="py-3 text-center text-[12px] text-muted-foreground">{t('common.noData')}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('common.area')} hint={`${areas.filter((a) => a.is_active).length} ${t('common.items')}`} />
        <CardBody className="space-y-1">
          {areas
            .filter((a) => a.is_active)
            .map((a) => ({ area: a, n: scopedIssues.filter((i) => i.area_id === a.id).length }))
            .filter((r) => r.n > 0)
            .sort((a, b) => b.n - a.n)
            .slice(0, 12)
            .map(({ area, n }) => (
              <div key={area.id} className="flex items-center gap-2 border-b py-1.5 last:border-0">
                <span className="min-w-0 flex-1 truncate text-[12px]">{areaLabelOf(area, lang)}</span>
                {area.vsm_line ? <Badge tone="accent">{area.vsm_line}</Badge> : null}
                <span className="num text-[12px] font-semibold">{n}</span>
              </div>
            ))}
        </CardBody>
      </Card>
    </div>
  );
}
