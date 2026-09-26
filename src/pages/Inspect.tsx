import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronDown, ClipboardCheck, RotateCcw, Save, Send } from 'lucide-react';
import { AreaPicker } from '@/components/AreaPicker';
import { PageTitle } from '@/components/AppShell';
import { EmployeePicker } from '@/components/EmployeePicker';
import { CategoryPicker, SeverityPicker, ShiftPicker, VsmPicker } from '@/components/Pickers';
import { PhotoUploader } from '@/components/PhotoUploader';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { SwitchRow } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { useCoreData, useCreateIssue, useCreateRound, useSession, useSettings } from '@/hooks/useData';
import { dueDateFor, shiftOf } from '@/lib/calc';
import { clearDraft, draftAttachments, draftKey, hasContent, loadDraft, saveDraft } from '@/lib/drafts';
import { useI18n } from '@/lib/i18n';
import { deletePhoto } from '@/lib/photos';
import { formatDate, nowHHMM, todayISO } from '@/lib/time';
import type { Severity, Shift, VsmLine } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * บันทึกผลตรวจ — หน้าจอหลักของ QC
 *
 * โหมดปกติ: บันทึก "รอบตรวจ" หนึ่งรอบ ถ้าเปิดสวิตช์ว่าพบข้อบกพร่อง
 *   ระบบจะเปิดใบแจ้งให้ในการกดบันทึกครั้งเดียว ไม่ต้องกรอกสองรอบ
 *
 * โหมด adhoc (/issues/new): แจ้งปัญหานอกรอบ ไม่มีการบันทึกรอบตรวจ
 *   ใช้ตอนมีคนมาบอกว่าเจอของเสีย ทั้งที่ QC ไม่ได้กำลังเดินตรวจอยู่
 */
export default function Inspect({ adhoc = false }: { adhoc?: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { t, lang } = useI18n();
  const { session, canInspect } = useSession();
  const { areas, categories, activeEmployees, lineOf, issues, rounds } = useCoreData();
  const { data: settings } = useSettings();
  const createRound = useCreateRound();
  const createIssue = useCreateIssue();

  /**
   * ร่างที่ค้างไว้ — อ่านครั้งเดียวตอนสร้างหน้า แล้วใช้เป็นค่าตั้งต้นของทุกช่อง
   * อ่านใน initializer ของ useState (ไม่ใช่ใน useEffect) เพื่อไม่ให้หน้าจอกระพริบ
   * ค่าว่างหนึ่งเฟรมก่อนจะเด้งเป็นค่าที่กู้คืนมา
   */
  const key = draftKey(adhoc ? 'adhoc' : 'round', session?.employee_id);
  const [initial] = useState(() => loadDraft(key));

  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [time, setTime] = useState(initial?.time ?? nowHHMM());
  const [areaId, setAreaId] = useState<string | null>(initial?.areaId ?? null);
  const [vsm, setVsm] = useState<VsmLine | null>(initial?.vsm ?? null);
  const [qtyChecked, setQtyChecked] = useState(initial?.qtyChecked ?? '');
  const [foundIssue, setFoundIssue] = useState(adhoc || (initial?.foundIssue ?? false));
  const [note, setNote] = useState(initial?.note ?? '');

  /** บริบทการผลิต — ไม่บังคับกรอก แต่เป็นตัวที่ทำให้รายงานรายกะ/รายเครื่องเป็นไปได้ */
  const [shift, setShift] = useState<Shift | null>(initial?.shift ?? shiftOf(initial?.time ?? nowHHMM()));
  const [shiftTouched, setShiftTouched] = useState(initial?.shiftTouched ?? false);
  const [machineNo, setMachineNo] = useState(initial?.machineNo ?? '');
  const [modelNo, setModelNo] = useState(initial?.modelNo ?? '');
  const [operatorId, setOperatorId] = useState<string | null>(initial?.operatorId ?? null);

  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.categoryIds ?? []);
  const [severity, setSeverity] = useState<Severity>(initial?.severity ?? 'major');
  const [partNo, setPartNo] = useState(initial?.partNo ?? '');
  const [lotNo, setLotNo] = useState(initial?.lotNo ?? '');
  const [qtyDefect, setQtyDefect] = useState(initial?.qtyDefect ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [voice, setVoice] = useState<string | null>(initial?.voice ?? null);
  /** ผู้ใช้แก้กำหนดส่งเองแล้วหรือยัง — ถ้าแก้แล้วห้ามคำนวณทับ */
  const [dueTouched, setDueTouched] = useState(initial?.dueTouched ?? false);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [error, setError] = useState<string | null>(null);
  /** กู้ร่างคืนมาจริงหรือเปล่า — ใช้ตัดสินว่าจะขึ้นแถบแจ้งเตือนไหม */
  const [restored, setRestored] = useState(() => Boolean(initial && hasContent(initial)));

  /**
   * เลือกจุดตรวจแล้วเติมสายผู้รับผิดชอบให้อัตโนมัติ
   *
   * เทียบกับจุดตรวจครั้งก่อนแทนการดูแค่ว่ามีค่าไหม เพราะร่างที่กู้คืนมาก็มีจุดตรวจ
   * ตั้งแต่เฟรมแรก ถ้าไม่เทียบ สายที่ผู้ใช้เลือกเองไว้ก่อนปิดแอปจะถูกทับทุกครั้งที่กลับเข้ามา
   */
  const lastArea = useRef<string | null>(areaId);
  useEffect(() => {
    if (!areaId || areaId === lastArea.current) return;
    lastArea.current = areaId;
    const derived = lineOf(areaId);
    if (derived) setVsm(derived);
  }, [areaId, lineOf]);

  /**
   * เลือกสาย VSM ก่อน — จุดตรวจเดิมที่อยู่คนละสายถูกเปลี่ยนเป็นตัวสายเอง
   * QC จึงบันทึกได้ทันทีโดยไม่ต้องไล่หาสถานี (ระบุสถานีต่อได้ถ้าต้องการ)
   * จุดตรวจนอกสาย (คลัง/จุดรับเข้า) คงไว้ เพราะเป็นกรณีที่ต้องเลือกสายผู้รับผิดชอบเองอยู่แล้ว
   */
  const pickVsm = (line: VsmLine) => {
    setVsm(line);
    setError(null);
    const current = areaId ? lineOf(areaId) : null;
    if (areaId && (current === line || current === null)) return;
    const root = areas.find((a) => a.parent_id === null && a.vsm_line === line && a.is_active);
    if (root) {
      lastArea.current = root.id;
      setAreaId(root.id);
    }
  };

  /** เครื่องที่เคยบันทึกในสายนี้ ล่าสุดก่อน — ให้แตะเลือกแทนการพิมพ์ */
  const recentMachines = useMemo(() => {
    if (!vsm) return [];
    const seen = new Map<string, string>();
    [...issues.map((i) => ({ m: i.machine_no, at: i.created_at, line: i.vsm_line })),
     ...rounds.map((r) => ({ m: r.machine_no, at: r.created_at, line: r.vsm_line }))]
      .filter((x) => x.line === vsm && x.m && x.m.trim() !== '-')
      .sort((a, b) => b.at.localeCompare(a.at))
      .forEach((x) => {
        const key = x.m.trim().toUpperCase();
        if (!seen.has(key)) seen.set(key, x.m.trim());
      });
    return [...seen.values()].slice(0, 8);
  }, [issues, rounds, vsm]);

  /** กะเดาจากเวลาที่บันทึก จนกว่าผู้ใช้จะเลือกเอง */
  useEffect(() => {
    if (shiftTouched) return;
    setShift(shiftOf(time));
  }, [time, shiftTouched]);

  /** กำหนดส่งคำนวณจากความรุนแรง จนกว่าผู้ใช้จะแก้เอง */
  useEffect(() => {
    if (dueTouched || !settings) return;
    setDueDate(dueDateFor(date, severity, settings));
  }, [date, severity, settings, dueTouched]);

  /* ── ร่างอัตโนมัติ ────────────────────────────────────────────────────
     เก็บทุกอย่างที่กรอกค้างไว้ หน่วงครึ่งวินาทีเพื่อไม่ให้เขียน localStorage
     ทุกตัวอักษรที่พิมพ์ ร่างถูกลบทิ้งทันทีที่บันทึกสำเร็จหรือผู้ใช้กดเริ่มใหม่ */
  const draft = useMemo(
    () => ({
      date, time, areaId, vsm, qtyChecked, note,
      shift, shiftTouched, machineNo, modelNo, operatorId,
      foundIssue, categoryIds, severity, partNo, lotNo, qtyDefect, description,
      photos, voice, dueDate, dueTouched,
    }),
    [
      date, time, areaId, vsm, qtyChecked, note,
      shift, shiftTouched, machineNo, modelNo, operatorId,
      foundIssue, categoryIds, severity, partNo, lotNo, qtyDefect, description,
      photos, voice, dueDate, dueTouched,
    ],
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (hasContent({ ...draft, savedAt: '' })) saveDraft(key, draft);
      else clearDraft(key);
    }, 500);
    return () => window.clearTimeout(id);
  }, [draft, key]);

  /** ล้างทุกช่องแล้วเริ่มใหม่ พร้อมลบรูป/เสียงที่ไม่มีใบไหนอ้างถึงแล้วออกจากเครื่อง */
  const discardDraft = async () => {
    const orphans = draftAttachments({ ...draft, savedAt: '' });
    clearDraft(key);
    setRestored(false);
    const now = nowHHMM();
    setDate(todayISO());
    setTime(now);
    lastArea.current = null;
    setAreaId(null);
    setVsm(null);
    setQtyChecked('');
    setNote('');
    setShift(shiftOf(now));
    setShiftTouched(false);
    setMachineNo('');
    setModelNo('');
    setOperatorId(null);
    setFoundIssue(adhoc);
    resetIssueFields();
    setError(null);
    await Promise.all(orphans.map((k) => deletePhoto(k)));
  };

  const busy = createRound.isPending || createIssue.isPending;

  const checkedNum = Number(qtyChecked || 0);
  const defectNum = Number(qtyDefect || 0);

  const problems = useMemo(() => {
    if (!vsm) return t('inspect.needVsm');
    if (!areaId) return t('inspect.needArea');
    if (!foundIssue) return null;
    // VSM ต้องรู้ว่าไปแก้ที่เครื่องไหน — Worker ปฏิเสธใบที่ไม่มีหมายเลขเครื่องด้วย
    if (!machineNo.trim()) return t('inspect.needMachine');
    if (!description.trim()) return t('inspect.needDescription');
    if (!photos.length) return t('inspect.needPhoto');
    if (!categoryIds.length) return t('inspect.needCategory');
    // จำนวนเสียมากกว่าจำนวนที่ตรวจแปลว่ากรอกผิด ปล่อยผ่านไปจะทำให้รายงาน % ของเสียเกิน 100
    if (checkedNum > 0 && defectNum > checkedNum) return t('inspect.qtyDefectRange');
    return null;
  }, [areaId, vsm, foundIssue, machineNo, categoryIds, description, photos, checkedNum, defectNum, t]);

  const resetIssueFields = () => {
    setCategoryIds([]);
    setPartNo('');
    setLotNo('');
    setQtyDefect('');
    setDescription('');
    setPhotos([]);
    setVoice(null);
    setSeverity('major');
    setDueTouched(false);
  };

  const submit = async (again = false) => {
    if (!session || !settings) return;
    if (problems) {
      setError(problems);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setError(null);

    const issuePart = foundIssue
      ? {
          category_ids: categoryIds,
          severity,
          part_no: partNo.trim(),
          lot_no: lotNo.trim(),
          qty_defect: defectNum,
          description: description.trim(),
          photo_urls: photos,
          voice_url: voice,
          due_date: dueDate || dueDateFor(date, severity, settings),
        }
      : null;

    /** บริบทการผลิตติดไปกับทั้งรอบตรวจและใบแจ้ง — ดู ProductionContext ใน types.ts */
    const productionContext = {
      shift,
      machine_no: machineNo.trim(),
      model_no: modelNo.trim(),
      operator_id: operatorId,
    };

    if (adhoc) {
      await createIssue.mutateAsync({
        round_id: null,
        qc_id: session.employee_id,
        found_date: date,
        found_time: time,
        area_id: areaId!,
        vsm_line: vsm!,
        qty_checked: checkedNum,
        ...productionContext,
        ...issuePart!,
      });
    } else {
      await createRound.mutateAsync({
        round: {
          qc_id: session.employee_id,
          round_date: date,
          round_time: time,
          area_id: areaId!,
          vsm_line: vsm!,
          qty_checked: checkedNum,
          result: foundIssue ? 'ng' : 'pass',
          note: note.trim(),
          ...productionContext,
        },
        issue: issuePart,
      });
    }

    // บันทึกลงเครื่องเรียบร้อยแล้ว ร่างหมดหน้าที่ — ทิ้งทันทีเพื่อไม่ให้กลับมาซ้ำใบเดิม
    clearDraft(key);
    setRestored(false);

    toast(foundIssue ? t('inspect.savedNg', { vsm: vsm! }) : t('inspect.savedPass'));

    if (again) {
      // ตรวจต่อที่จุดเดิมได้ทันที เก็บจุดตรวจ/สาย/เวลาไว้ ล้างเฉพาะรายละเอียดข้อบกพร่อง
      resetIssueFields();
      setTime(nowHHMM());
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate(foundIssue ? '/issues' : '/rounds');
  };

  if (!canInspect) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle title={t('inspect.title')} />
        <Card>
          <CardBody className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div>
              <p className="text-[14px] font-medium">{t('verify.onlyQc')}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{t('admin.roleHint')}</p>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
        {t('common.back')}
      </Button>

      <PageTitle
        title={adhoc ? t('issue.newTitle') : t('inspect.title')}
        subtitle={adhoc ? undefined : t('inspect.subtitle')}
        right={<span className="num text-[11px] text-muted-foreground">{formatDate(date, lang)}</span>}
      />

      {/* กู้ร่างคืนแล้ว — ต้องบอกให้รู้ ไม่งั้นผู้ใช้จะงงว่าทำไมมีข้อมูลค้างอยู่ในช่อง
          และอาจกดบันทึกทับงานที่ตั้งใจจะเริ่มใหม่ */}
      {restored ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5">
          <Save className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-[12px]">
            {t('draft.restored')}
            {initial ? (
              <span className="num ml-1.5 text-[11px] text-muted-foreground">
                {new Date(initial.savedAt).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
                  timeZone: 'Asia/Bangkok',
                })}
              </span>
            ) : null}
          </span>
          <Button variant="outline" size="sm" onClick={discardDraft}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t('draft.discard')}
          </Button>
        </div>
      ) : null}

      <div className="space-y-4">
        <Card>
          <CardHeader title={adhoc ? t('issue.newTitle') : t('inspect.roundInfo')} />
          <CardBody className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('common.date')}>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => (setDate(e.target.value), setDueTouched(false))}
                />
              </Field>
              <Field label={t('common.time')}>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>

            {/* สี่อย่างที่ QC ต้องบอกให้ได้ตามลำดับ: พื้นที่ VSM › จุดไหน › เครื่องอะไร › ปัญหาอะไร (+รูป)
                เลือกสายก่อน เพราะสายคือคนที่ใบแจ้งจะเด้งไปหา */}
            <Field label={t('inspect.vsmArea')} hint={t('inspect.vsmAreaHint')} required>
              <VsmPicker value={vsm} onChange={pickVsm} />
            </Field>

            <Field label={t('inspect.station')} hint={t('inspect.stationHint')}>
              <AreaPicker areas={areas} value={areaId} onChange={setAreaId} />
            </Field>

            <Field
              label={t('inspect.machineNo')}
              hint={foundIssue ? t('inspect.machineHint') : t('common.optional')}
              required={foundIssue}
            >
              <Input
                value={machineNo}
                onChange={(e) => (setMachineNo(e.target.value), setError(null))}
                placeholder={t('inspect.machinePlaceholder')}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="num h-12 text-[16px] font-semibold uppercase"
              />
              {/* เครื่องที่เคยบันทึกในสายนี้ — แตะเดียวแทนการพิมพ์ด้วยถุงมือ */}
              {recentMachines.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recentMachines.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => (setMachineNo(m), setError(null))}
                      aria-pressed={machineNo.trim().toUpperCase() === m.toUpperCase()}
                      className={cn(
                        'press focusable num h-9 min-w-[44px] rounded-full border px-3 text-[12px] font-medium',
                        machineNo.trim().toUpperCase() === m.toUpperCase()
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'bg-card text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>

            {!adhoc ? (
              <div className="rounded-md border p-3">
                <SwitchRow
                  label={t('inspect.foundIssue')}
                  hint={t('inspect.foundIssueHint')}
                  checked={foundIssue}
                  onCheckedChange={(v) => (setFoundIssue(v), setError(null))}
                />
              </div>
            ) : null}

            {!adhoc && !foundIssue ? (
              <Field label={t('common.note')} hint={t('common.optional')}>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-[80px]"
                  placeholder={t('common.note')}
                />
              </Field>
            ) : null}

            {/* บริบทการผลิต — ไม่บังคับสักช่อง จึงพับไว้ไม่ให้เกะกะหน้าไลน์
                แต่ถ้ากรอกจะแยกตัวเลขรายกะ/รายรุ่นได้ในรายงาน */}
            <details className="group rounded-md border" open={Boolean(qtyChecked || modelNo || operatorId)}>
              <summary className="press flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-medium">
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                <span className="shrink-0">{t('inspect.moreDetails')}</span>
                <span className="ml-auto min-w-0 truncate text-[11px] font-normal text-muted-foreground">
                  {t('inspect.moreDetailsHint')}
                </span>
              </summary>
              <div className="space-y-3.5 border-t p-3">
                <Field label={t('inspect.qtyChecked')} hint={t('inspect.qtyCheckedHint')}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={qtyChecked}
                    onChange={(e) => setQtyChecked(e.target.value)}
                    placeholder="0"
                    className="num"
                  />
                </Field>
                <Field label={t('inspect.shift')} hint={shiftTouched ? undefined : t('inspect.shiftAuto')}>
                  <ShiftPicker value={shift} onChange={(s) => (setShift(s), setShiftTouched(true))} />
                </Field>
                <Field label={t('inspect.modelNo')} hint={t('common.optional')}>
                  <Input
                    value={modelNo}
                    onChange={(e) => setModelNo(e.target.value)}
                    placeholder={t('inspect.modelPlaceholder')}
                    className="num"
                  />
                </Field>
                <Field label={t('inspect.operator')} hint={t('common.optional')}>
                  <EmployeePicker employees={activeEmployees} value={operatorId} onChange={setOperatorId} />
                </Field>
              </div>
            </details>
          </CardBody>
        </Card>

        {foundIssue ? (
          <Card accent>
            <CardHeader
              title={t('inspect.issueDetail')}
              right={vsm ? <Badge tone="accent" size="md">{vsm}</Badge> : null}
            />
            <CardBody className="space-y-3.5">
              <Field label={t('inspect.description')} required>
                <Textarea
                  value={description}
                  onChange={(e) => (setDescription(e.target.value), setError(null))}
                  placeholder={t('inspect.descriptionPlaceholder')}
                  className="min-h-[120px]"
                />
              </Field>

              {/* ถ่ายจากกล้องหรือเลือกจากคลังรูปได้ทั้งคู่ — รูปขึ้น R2 เองเมื่อซิงก์ */}
              <Field label={t('inspect.photos')} required>
                <PhotoUploader
                  value={photos}
                  onChange={(v) => (setPhotos(v), setError(null))}
                  hint={t('inspect.photoHint')}
                />
              </Field>

              <Field label={t('inspect.pickCategory')} required>
                <CategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} />
              </Field>

              <Field label={t('severity.label')} required>
                <SeverityPicker value={severity} onChange={setSeverity} />
              </Field>

              <Field label={t('voice.label')} hint={t('common.optional')}>
                <VoiceRecorder value={voice} onChange={setVoice} />
              </Field>

              <details className="group rounded-md border" open={Boolean(partNo || lotNo || qtyDefect || dueTouched)}>
                <summary className="press flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-medium">
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  <span className="shrink-0">{t('inspect.moreDetails')}</span>
                  <span className="ml-auto text-[11px] font-normal text-muted-foreground">{t('common.optional')}</span>
                </summary>
                <div className="space-y-3.5 border-t p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label={t('inspect.partNo')}>
                      <Input value={partNo} onChange={(e) => setPartNo(e.target.value)} className="num" />
                    </Field>
                    <Field label={t('inspect.lotNo')}>
                      <Input value={lotNo} onChange={(e) => setLotNo(e.target.value)} className="num" />
                    </Field>
                    <Field label={t('inspect.qtyDefect')}>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={qtyDefect}
                        onChange={(e) => setQtyDefect(e.target.value)}
                        placeholder="0"
                        className="num"
                      />
                    </Field>
                  </div>
                  <Field label={t('inspect.dueDate')} hint={dueTouched ? undefined : t('inspect.dueAuto')}>
                    <Input
                      type="date"
                      value={dueDate}
                      min={date}
                      onChange={(e) => (setDueDate(e.target.value), setDueTouched(true))}
                    />
                  </Field>
                </div>
              </details>
            </CardBody>
          </Card>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-bad">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : null}

      {/* แถบบันทึกติดล่างจอ — มือถือถือด้วยมือเดียว ปุ่มต้องอยู่ในระยะนิ้วโป้งเสมอ */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+56px)] z-20 mt-5 space-y-2 md:bottom-4">
        <Button variant="accent" size="lg" className="w-full shadow-lift" onClick={() => submit(false)} disabled={busy}>
          <ClipboardCheck className="h-5 w-5" />
          {busy ? t('common.saving') : t('inspect.submit')}
        </Button>
        {foundIssue ? (
          <Button variant="outline" size="md" className="w-full" onClick={() => submit(true)} disabled={busy}>
            <Send className="h-4 w-4" />
            {t('inspect.addAnother')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
