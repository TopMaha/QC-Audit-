import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Cog,
  History,
  MapPin,
  Package,
  Pencil,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { EmployeePicker } from '@/components/EmployeePicker';
import { IssueStepper } from '@/components/IssueStepper';
import { CategoryPicker, SeverityPicker, ShiftPicker } from '@/components/Pickers';
import { PhotoGrid, PhotoUploader } from '@/components/PhotoUploader';
import { VoicePlayer, VoiceRecorder } from '@/components/VoiceRecorder';
import { DueBadge, SeverityBadge, StatusBadge, VsmBadge } from '@/components/StatusBadge';
import { Badge, CategoryTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Avatar, EmptyState, SectionTitle, SkeletonList } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import {
  useAckIssue,
  useCancelIssue,
  useChangeHistory,
  useIssueDetail,
  useLineHeads,
  useMyLines,
  useSession,
  useStartIssue,
  useSubmitFix,
  useUpdateIssue,
  useVerifyFix,
} from '@/hooks/useData';
import { fieldLabel } from '@/lib/auditLabels';
import { ageDays, displayStatus, stageOf } from '@/lib/calc';
import { categoryLabel, personLabel, useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/time';
import type { IssueFix, QcIssue, Severity, Shift } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function IssueDetail() {
  const { issueId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { session, admin, canInspect } = useSession();
  const { issue, fixes, employees, categories, pathOf, isLoading } = useIssueDetail(issueId);
  const { data: changes } = useChangeHistory(issueId);

  const ackIssue = useAckIssue();
  const startIssue = useStartIssue();
  const cancelIssue = useCancelIssue();
  const myLines = useMyLines();
  const { data: heads = [] } = useLineHeads();
  const [fixOpen, setFixOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) return <SkeletonList rows={4} />;

  if (!issue) {
    return (
      <EmptyState
        title={t('common.noData')}
        hint={t('issue.emptyHint')}
        action={
          <Button variant="outline" onClick={() => navigate('/issues')}>
            {t('issue.title')}
          </Button>
        }
      />
    );
  }

  const qc = employees.find((e) => e.id === issue.qc_id);

  /* ── ใครทำอะไรได้ ─────────────────────────────────────────────────────
     บังคับที่หน้าจอเป็นด่านแรก และฝั่ง Worker ตรวจซ้ำอีกชั้น
     เพราะโทเคนของแอปเป็นโทเคนร่วม ใครที่เปิดหน้าเว็บได้ก็ยิง API ตรงได้

     ⚠️ สิทธิ์ผู้ดูแลระบบ "แบบข้ามทุกด่าน" ใช้ได้เฉพาะตอนที่ไม่ได้ล็อกอินเป็นพนักงานอยู่ด้วย
     เพราะทุกคำขอจะแนบรหัสพนักงานของเซสชันไปเสมอ (ดู headers() ใน src/lib/net.ts)
     ฝั่ง Worker จึงตัดสินสิทธิ์จากบทบาทของพนักงานคนนั้น ไม่ใช่จากโหมดผู้ดูแล
     ถ้าปุ่มบนหน้าจอไม่คิดแบบเดียวกัน ผู้ใช้จะเห็นปุ่มที่กดแล้วได้ 403 กลับมา

     ข้อยกเว้นคือการแก้ใบแจ้ง (PUT /api/issues/:id) ซึ่ง Worker ไม่ได้จำกัดบทบาท
     ผู้ดูแลระบบที่ล็อกอินเป็นพนักงานจึงแก้ใบที่ตัวเองเปิดไว้ได้ — คนที่เปิดใบได้
     ต้องแก้คำผิดในใบของตัวเองได้ ส่วนการตรวจรับยังเป็นของ QC เท่านั้นตามกติกา
     "คนแก้กับคนตรวจต้องไม่ใช่คนเดียวกัน" (Worker บังคับที่ /api/fixes/:id/verify) */
  const adminOnly = admin && !session;
  // สายของตัวเอง (VSM) หรือสายที่ถูกตั้งเป็นหัวหน้า — Worker ตัดสินด้วยกติกาเดียวกัน (canWorkLine)
  const lineCrew = myLines.includes(issue.vsm_line) || adminOnly;

  /* ขั้นตอนไหลทางเดียวตามที่โรงงานกำหนด: รับทราบ › เริ่มแก้ไข › แก้ไขเสร็จแล้ว (รูป + คำอธิบาย)
     แต่ละขั้นมีปุ่มเดียวให้กด ผู้ใช้จึงไม่ต้องเดาว่าต้องทำอะไรต่อ */
  const stage = stageOf(issue);
  const canAck = lineCrew && stage === 'found';
  const canStart = lineCrew && stage === 'acked';
  const canFix = lineCrew && stage === 'fixing';
  const canVerify = (session?.role === 'qc' || adminOnly) && issue.status === 'fixed';

  const lineHeads = heads
    .filter((h) => h.vsm_line === issue.vsm_line)
    .map((h) => employees.find((e) => e.id === h.employee_id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const lastFix = fixes.length ? fixes[fixes.length - 1] : null;
  const stageMessage =
    stage === 'found'
      ? t('stage.waitAck', { vsm: issue.vsm_line })
      : stage === 'acked'
        ? t('stage.waitStart')
        : stage === 'fixing'
          ? issue.status === 'rejected' && lastFix?.verify_note
            ? t('stage.rejected', { note: lastFix.verify_note })
            : t('stage.waitFix')
          : stage === 'fixed'
            ? t('stage.waitQc')
            : stage === 'closed'
              ? t('stage.done')
              : null;
  const canEdit =
    (adminOnly || (canInspect && session?.employee_id === issue.qc_id)) &&
    !['verified', 'cancelled'].includes(issue.status);

  /** งานแก้ไขล่าสุดที่ยังไม่ถูกตรวจรับ — คือใบที่ QC ต้องตัดสิน */
  const pendingFix = [...fixes].reverse().find((f) => f.verify_result === 'pending') ?? null;

  const doAck = async () => {
    await ackIssue.mutateAsync(issue.id);
    toast(t('fix.acked'));
  };

  const doStart = async () => {
    await startIssue.mutateAsync(issue.id);
    toast(t('flow.started'));
  };

  const doCancel = async () => {
    if (!confirm(t('issue.cancelConfirm'))) return;
    await cancelIssue.mutateAsync(issue.id);
    toast(t('issue.cancelled'));
  };

  const operator = employees.find((e) => e.id === issue.operator_id);

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
        {t('common.back')}
      </Button>

      <PageTitle
        title={issue.issue_no}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={displayStatus(issue)} />
            <SeverityBadge severity={issue.severity} />
            <VsmBadge line={issue.vsm_line} />
            <DueBadge issue={issue} />
          </span>
        }
        right={
          canEdit ? (
            <div className="flex gap-1.5">
              <Button variant="outline" size="iconSm" onClick={() => setEditOpen(true)} aria-label={t('common.edit')}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="iconSm" onClick={doCancel} aria-label={t('issue.cancel')}>
                <XCircle className="h-4 w-4 text-bad" />
              </Button>
            </div>
          ) : null
        }
      />

      <div className="space-y-4">
        {/* ── ขั้นตอนการดำเนินการ + ปุ่มของขั้นถัดไป ──────────────
            วางบนสุดเพราะคำถามแรกของทุกคนที่เปิดใบคือ "งานอยู่ขั้นไหน รอใคร" */}
        <Card>
          <CardHeader title={t('stage.title')} />
          <CardBody className="space-y-3">
            <IssueStepper issue={issue} fixes={fixes} />

            {stageMessage ? (
              <p
                className={cn(
                  'rounded-md border px-3 py-2 text-[13px]',
                  issue.status === 'rejected' ? 'border-bad/40 bg-bad/10' : 'bg-muted/50',
                )}
              >
                {stageMessage}
              </p>
            ) : null}

            {canAck || canStart || canFix || (canVerify && pendingFix) ? (
              <div className="flex flex-wrap gap-2">
                {canAck ? (
                  <Button variant="accent" size="lg" className="flex-1" onClick={doAck} disabled={ackIssue.isPending}>
                    <BellRing className="h-5 w-5" />
                    {t('fix.ack')}
                  </Button>
                ) : null}
                {canStart ? (
                  <Button
                    variant="accent"
                    size="lg"
                    className="flex-1"
                    onClick={doStart}
                    disabled={startIssue.isPending}
                  >
                    <Play className="h-5 w-5" />
                    {t('flow.start')}
                  </Button>
                ) : null}
                {canFix ? (
                  <Button variant="accent" size="lg" className="flex-1" onClick={() => setFixOpen(true)}>
                    <Send className="h-5 w-5" />
                    {t('fix.submit')}
                  </Button>
                ) : null}
                {canVerify && pendingFix ? (
                  <Button variant="accent" size="lg" className="flex-1" onClick={() => setVerifyOpen(true)}>
                    <ShieldCheck className="h-5 w-5" />
                    {t('verify.title')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t pt-2.5 text-[12px]">
              <span className="label-micro flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {t('flow.heads')} · {issue.vsm_line}
              </span>
              {lineHeads.length ? (
                lineHeads.map((h) => (
                  <span key={h.id} className="rounded-full border bg-card px-2 py-0.5">
                    {personLabel(h, lang)}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">{t('flow.noHeads')}</span>
              )}
            </div>
          </CardBody>
        </Card>

        {/* ── ข้อมูลใบแจ้ง ──────────────────────────────────── */}
        <Card accent>
          <CardHeader
            title={t('issue.detail')}
            right={
              <span className="num text-[11px] text-muted-foreground">
                {t('issue.age')} {ageDays(issue)} {t('common.days')}
              </span>
            }
          />
          <CardBody className="space-y-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <Avatar name={personLabel(qc, lang)} src={qc?.avatar_url} seed={issue.qc_id} size={36} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{personLabel(qc, lang)}</div>
                <div className="num text-[11px] text-muted-foreground">
                  {t('issue.foundAt')} {formatDate(issue.found_date, lang, { full: true })} · {issue.found_time}
                </div>
              </div>
            </div>

            <dl className="grid gap-2 sm:grid-cols-2">
              {/* หมายเลขเครื่องจักรขึ้นก่อน — เป็นสิ่งแรกที่ VSM ต้องรู้ก่อนเดินไปแก้ */}
              <Meta
                icon={<Cog className="h-3.5 w-3.5" />}
                label={t('inspect.machineNo')}
                value={issue.machine_no || t('common.none')}
                mono
              />
              <Meta icon={<MapPin className="h-3.5 w-3.5" />} label={t('common.area')} value={pathOf(issue.area_id)} />
              <Meta
                icon={<Package className="h-3.5 w-3.5" />}
                label={t('inspect.partNo')}
                value={issue.part_no || t('common.none')}
                mono
              />
              <Meta label={t('inspect.lotNo')} value={issue.lot_no || t('common.none')} mono />
              <Meta
                label={t('inspect.qtyDefect')}
                value={t('issue.qtyRatio', { defect: issue.qty_defect, checked: issue.qty_checked })}
                mono
              />
              <Meta label={t('issue.due')} value={formatDate(issue.due_date, lang)} mono />
              <Meta label={t('issue.responsible')} value={issue.vsm_line} mono />
              <Meta label={t('inspect.shift')} value={issue.shift ?? t('common.none')} mono />
              <Meta label={t('inspect.modelNo')} value={issue.model_no || t('common.none')} mono />
              <Meta
                icon={<UserRound className="h-3.5 w-3.5" />}
                label={t('inspect.operator')}
                value={issue.operator_id ? personLabel(operator, lang) : t('common.none')}
              />
            </dl>

            <div className="flex flex-wrap gap-1.5">
              {issue.category_ids.map((id) => (
                <CategoryTag key={id} name={categoryLabel(categories.find((c) => c.id === id), lang)} highlight />
              ))}
            </div>

            <div>
              <SectionTitle>{t('inspect.description')}</SectionTitle>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-[13px] leading-relaxed">
                {issue.description}
              </p>
            </div>

            {issue.voice_url ? (
              <div>
                <SectionTitle>{t('voice.label')}</SectionTitle>
                <VoicePlayer audioKey={issue.voice_url} />
              </div>
            ) : null}

            {issue.photo_urls.length ? (
              <div>
                <SectionTitle>{t('inspect.photos')}</SectionTitle>
                <PhotoGrid keys={issue.photo_urls} />
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* ── เทียบก่อน/หลังแก้ไข (ครั้งล่าสุด) ─────────────────── */}
        {lastFix && lastFix.photo_urls.length ? (
          <Card>
            <CardHeader title="BEFORE / AFTER" hint={t('fix.attempt', { n: lastFix.attempt })} />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 inline-flex rounded-sm bg-bad/12 px-1.5 py-0.5 text-[11px] font-semibold text-bad">
                  BEFORE
                </span>
                <PhotoGrid keys={issue.photo_urls} className="grid-cols-2 sm:grid-cols-2" />
              </div>
              <div>
                <span className="mb-1.5 inline-flex rounded-sm bg-ok/12 px-1.5 py-0.5 text-[11px] font-semibold text-ok">
                  AFTER
                </span>
                <PhotoGrid keys={lastFix.photo_urls} className="grid-cols-2 sm:grid-cols-2" />
              </div>
            </CardBody>
          </Card>
        ) : null}

        {/* ── ประวัติงานแก้ไข ───────────────────────────────── */}
        <Card>
          <CardHeader title={t('fix.title')} hint={fixes.length ? undefined : t('fix.noFixYet')} />
          <CardBody className="space-y-3">
            {fixes.length ? (
              fixes.map((fix) => (
                <FixBlock key={fix.id} fix={fix} employees={employees} />
              ))
            ) : (
              <p className="py-3 text-center text-[12px] text-muted-foreground">{t('fix.noFixYet')}</p>
            )}
          </CardBody>
        </Card>

        {/* ── ร่องรอยการแก้ไขข้อมูล ─────────────────────────── */}
        <Card>
          <CardHeader title={t('issue.timeline')} right={<History className="h-4 w-4 text-muted-foreground" />} />
          <CardBody className="space-y-1">
            {(changes ?? []).length ? (
              (changes ?? []).map((c) => (
                <div key={c.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b py-1.5 last:border-0">
                  <span className="text-[12px] font-medium">
                    {fieldLabel(c.field, lang) || t('issue.createdEvent')}
                  </span>
                  {c.action_type === 'update' ? (
                    <span className="num text-[11px] text-muted-foreground">
                      {c.old_value ?? '—'} → {c.new_value ?? '—'}
                    </span>
                  ) : null}
                  <span className="num ml-auto text-[10px] text-muted-foreground">
                    {c.changed_by} ·{' '}
                    {new Date(c.changed_at).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
                      timeZone: 'Asia/Bangkok',
                    })}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-3 text-center text-[12px] text-muted-foreground">{t('common.noData')}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <FixDialog issue={issue} open={fixOpen} onOpenChange={setFixOpen} />
      <VerifyDialog fix={pendingFix} open={verifyOpen} onOpenChange={setVerifyOpen} />
      <EditDialog issue={issue} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function Meta({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <dt className="label-micro flex items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd className={cn('mt-0.5 truncate text-[13px]', mono && 'num')} title={value}>
        {value}
      </dd>
    </div>
  );
}

/** งานแก้ไขหนึ่งครั้ง พร้อมผลการตรวจรับ */
function FixBlock({ fix, employees }: { fix: IssueFix; employees: { id: string; full_name: string; full_name_en?: string; avatar_url?: string | null }[] }) {
  const { t, lang } = useI18n();
  const responder = employees.find((e) => e.id === fix.responder_id);
  const verifier = employees.find((e) => e.id === fix.verified_by);

  const tone =
    fix.verify_result === 'pass' ? 'border-ok/40' : fix.verify_result === 'fail' ? 'border-bad/40' : 'border-steel/40';

  return (
    <div className={cn('rounded-md border-l-[3px] border bg-muted/30 p-3', tone)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" className="normal-case tracking-normal">
          {t('fix.attempt', { n: fix.attempt })}
        </Badge>
        {fix.verify_result === 'pass' ? (
          <Badge tone="ok" className="normal-case tracking-normal">
            <CheckCircle2 className="h-3 w-3" />
            {t('verify.pass')}
          </Badge>
        ) : fix.verify_result === 'fail' ? (
          <Badge tone="bad" className="normal-case tracking-normal">
            <RotateCcw className="h-3 w-3" />
            {t('verify.fail')}
          </Badge>
        ) : (
          <Badge tone="steel" className="normal-case tracking-normal">
            {t('status.fixed')}
          </Badge>
        )}
        <span className="num ml-auto text-[10px] text-muted-foreground">
          {new Date(fix.fixed_at).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok' })}
        </span>
      </div>

      <div className="mt-2 space-y-2">
        <Line label={t('fix.submittedBy')} value={personLabel(responder, lang)} />
        <Line label={t('fix.rootCause')} value={fix.root_cause} />
        <Line label={t('fix.actionTaken')} value={fix.action_taken} />
      </div>

      {fix.photo_urls.length ? (
        <div className="mt-2.5">
          <div className="label-micro mb-1.5">{t('fix.proofPhotos')}</div>
          <PhotoGrid keys={fix.photo_urls} />
        </div>
      ) : null}

      {fix.verify_result !== 'pending' ? (
        <div className="mt-2.5 border-t pt-2">
          <div className="label-micro">{t('verify.verifiedBy')}</div>
          <div className="mt-0.5 text-[12px]">
            {personLabel(verifier, lang)}
            {fix.verified_at ? (
              <span className="num ml-2 text-[10px] text-muted-foreground">
                {new Date(fix.verified_at).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
                  timeZone: 'Asia/Bangkok',
                })}
              </span>
            ) : null}
          </div>
          {fix.verify_note ? (
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
              {fix.verify_note}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="label-micro">{label}</div>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{value}</p>
    </div>
  );
}

/* ── VSM ส่งงานแก้ไข ─────────────────────────────────────────────────── */

function FixDialog({
  issue,
  open,
  onOpenChange,
}: {
  issue: QcIssue;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { session } = useSession();
  const submitFix = useSubmitFix();
  const [action, setAction] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAction('');
      setPhotos([]);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!session) return;
    // ปิดงานบังคับแค่สองอย่างตามที่โรงงานกำหนด: รูปหลังแก้ไข + คำอธิบาย
    // รูปคือหัวใจของระบบนี้ — QC ตรวจรับจากรูป ไม่ใช่จากคำบอกเล่า
    if (!photos.length) return setError(t('fix.needPhoto'));
    if (!action.trim()) return setError(t('fix.needAction'));

    await submitFix.mutateAsync({
      issue_id: issue.id,
      responder_id: session.employee_id,
      action_taken: action.trim(),
      photo_urls: photos,
    });
    toast(t('fix.submitted'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('fix.submitTitle')}
        description={`${issue.issue_no} · ${issue.vsm_line}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" onClick={submit} disabled={submitFix.isPending}>
              <Send className="h-4 w-4" />
              {submitFix.isPending ? t('common.saving') : t('fix.submit')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label={t('fix.proofPhotos')} required>
            <PhotoUploader
              value={photos}
              onChange={(v) => (setPhotos(v), setError(null))}
              hint={t('fix.proofHint')}
            />
          </Field>
          <Field label={t('fix.actionTaken')} required>
            <Textarea
              value={action}
              onChange={(e) => (setAction(e.target.value), setError(null))}
              placeholder={t('fix.actionPlaceholder')}
              className="min-h-[120px]"
            />
          </Field>
          {error ? <p className="text-[12px] text-bad">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── QC ตรวจรับ ──────────────────────────────────────────────────────── */

function VerifyDialog({
  fix,
  open,
  onOpenChange,
}: {
  fix: IssueFix | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const verifyFix = useVerifyFix();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setNote('');
      setError(null);
    }
  }, [open]);

  if (!fix) return null;

  const decide = async (result: 'pass' | 'fail') => {
    // ตีกลับโดยไม่บอกเหตุผลทำให้ VSM ต้องเดา แล้ววนกลับมาถูกตีกลับซ้ำอีก
    if (result === 'fail' && !note.trim()) return setError(t('verify.needNote'));
    await verifyFix.mutateAsync({ fixId: fix.id, result, note: note.trim() });
    toast(result === 'pass' ? t('verify.passed') : t('verify.failed'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('verify.title')}
        description={t('fix.attempt', { n: fix.attempt })}
        footer={
          <>
            <Button variant="danger" onClick={() => decide('fail')} disabled={verifyFix.isPending}>
              <RotateCcw className="h-4 w-4" />
              {t('verify.fail')}
            </Button>
            <Button variant="accent" onClick={() => decide('pass')} disabled={verifyFix.isPending}>
              <CheckCircle2 className="h-4 w-4" />
              {t('verify.pass')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="rounded-md border bg-muted/30 p-3">
            <Line label={t('fix.rootCause')} value={fix.root_cause} />
            <div className="mt-2">
              <Line label={t('fix.actionTaken')} value={fix.action_taken} />
            </div>
          </div>
          <div>
            <div className="label-micro mb-1.5">{t('fix.proofPhotos')}</div>
            <PhotoGrid keys={fix.photo_urls} />
          </div>
          <Field label={t('verify.note')} hint={t('common.optional')}>
            <Textarea
              value={note}
              onChange={(e) => (setNote(e.target.value), setError(null))}
              placeholder={t('verify.notePlaceholder')}
              className="min-h-[90px]"
            />
          </Field>
          {error ? <p className="text-[12px] text-bad">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── QC แก้ไขใบแจ้งย้อนหลัง ──────────────────────────────────────────── */

function EditDialog({
  issue,
  open,
  onOpenChange,
}: {
  issue: QcIssue;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { categories, activeEmployees } = useIssueDetail(issue.id);
  const updateIssue = useUpdateIssue();
  const [draft, setDraft] = useState<Partial<QcIssue>>({});

  useEffect(() => {
    if (open) setDraft({ ...issue });
  }, [open, issue]);

  const value = { ...issue, ...draft } as QcIssue;

  const save = async () => {
    await updateIssue.mutateAsync({
      id: issue.id,
      patch: {
        description: value.description,
        severity: value.severity,
        category_ids: value.category_ids,
        part_no: value.part_no,
        lot_no: value.lot_no,
        qty_defect: value.qty_defect,
        due_date: value.due_date,
        shift: value.shift,
        machine_no: value.machine_no,
        model_no: value.model_no,
        operator_id: value.operator_id,
        voice_url: value.voice_url,
      },
    });
    toast(t('issue.saved'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('issue.editTitle')}
        description={t('issue.editHint')}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" onClick={save} disabled={updateIssue.isPending}>
              {updateIssue.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label={t('inspect.pickCategory')}>
            <CategoryPicker
              categories={categories}
              value={value.category_ids}
              onChange={(ids) => setDraft((d) => ({ ...d, category_ids: ids }))}
            />
          </Field>
          <Field label={t('severity.label')}>
            <SeverityPicker
              value={value.severity}
              onChange={(s: Severity) => setDraft((d) => ({ ...d, severity: s }))}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('inspect.partNo')}>
              <Input
                className="num"
                value={value.part_no}
                onChange={(e) => setDraft((d) => ({ ...d, part_no: e.target.value }))}
              />
            </Field>
            <Field label={t('inspect.lotNo')}>
              <Input
                className="num"
                value={value.lot_no}
                onChange={(e) => setDraft((d) => ({ ...d, lot_no: e.target.value }))}
              />
            </Field>
            <Field label={t('inspect.qtyDefect')}>
              <Input
                type="number"
                min={0}
                className="num"
                value={value.qty_defect}
                onChange={(e) => setDraft((d) => ({ ...d, qty_defect: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Field label={t('inspect.dueDate')}>
            <Input
              type="date"
              value={value.due_date}
              onChange={(e) => setDraft((d) => ({ ...d, due_date: e.target.value }))}
            />
          </Field>
          <Field label={t('inspect.description')}>
            <Textarea
              className="min-h-[120px]"
              value={value.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>

          <Field label={t('voice.label')} hint={t('common.optional')}>
            <VoiceRecorder
              value={value.voice_url}
              onChange={(voice_url) => setDraft((d) => ({ ...d, voice_url }))}
            />
          </Field>

          <div className="space-y-3.5 rounded-md border border-dashed p-3">
            <div className="label-micro">{t('inspect.contextTitle')}</div>
            <Field label={t('inspect.shift')}>
              <ShiftPicker value={value.shift} onChange={(shift: Shift | null) => setDraft((d) => ({ ...d, shift }))} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('inspect.machineNo')}>
                <Input
                  className="num"
                  value={value.machine_no}
                  onChange={(e) => setDraft((d) => ({ ...d, machine_no: e.target.value }))}
                />
              </Field>
              <Field label={t('inspect.modelNo')}>
                <Input
                  className="num"
                  value={value.model_no}
                  onChange={(e) => setDraft((d) => ({ ...d, model_no: e.target.value }))}
                />
              </Field>
            </div>
            <Field label={t('inspect.operator')}>
              <EmployeePicker
                employees={activeEmployees}
                value={value.operator_id}
                onChange={(operator_id) => setDraft((d) => ({ ...d, operator_id }))}
              />
            </Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
