import { ACTIVE_STATUSES, VSM_ACTION_STATUSES, VSM_LINES } from './types';
import type {
  AppSettings,
  DefectCategory,
  DisplayStatus,
  Employee,
  IssueFix,
  IssueStatus,
  LineHead,
  QcIssue,
  QcRound,
  Role,
  Severity,
  Shift,
  Stage,
  VsmLine,
} from './types';
import { addDays, diffDays, inRange, todayISO, type ISODate } from './time';

/* ══════════════════════════════════════════════════════════════════════════
   กติกาการนับที่ใช้ร่วมกันทั้งแอปและฝั่ง Worker (worker/src/lib/dashboard.js)
   ถ้าแก้ที่นี่ต้องแก้ที่นั่นด้วย ไม่งั้นตัวเลขบนแดชบอร์ดจะไม่ตรงกับหน้าจอ
   ══════════════════════════════════════════════════════════════════════════ */

/** เปอร์เซ็นต์แบบปัดลง — 17/30 = 56% ไม่ใช่ 57% */
export const pctOf = (a: number, b: number): number => (b > 0 ? Math.floor((a / b) * 100) : 0);

export function bandOf(pct: number): 'ok' | 'warn' | 'bad' {
  if (pct >= 80) return 'ok';
  if (pct >= 50) return 'warn';
  return 'bad';
}

/**
 * ขั้นตอน 5 ขั้นที่ผู้ใช้เห็น — ดู STAGES ใน types.ts
 * ใบที่ถูกตีกลับกลับไปอยู่ขั้น "กำลังแก้ไข" เพราะงานกลับมาอยู่ในมือ VSM อีกครั้ง
 */
export function stageOf(issue: Pick<QcIssue, 'status' | 'started_at'>): Stage | 'cancelled' {
  switch (issue.status) {
    case 'open':
      return 'found';
    case 'in_progress':
      return issue.started_at ? 'fixing' : 'acked';
    case 'rejected':
      return 'fixing';
    case 'fixed':
      return 'fixed';
    case 'verified':
      return 'closed';
    default:
      return 'cancelled';
  }
}

/** สถานะที่แสดงบนป้าย — แยก "รับทราบแล้ว" ออกจาก "กำลังแก้ไข" */
export function displayStatus(issue: Pick<QcIssue, 'status' | 'started_at'>): DisplayStatus {
  return issue.status === 'in_progress' && !issue.started_at ? 'acked' : issue.status;
}

/** ยังต้องมีคนทำอะไรต่อไหม */
export const isActive = (s: IssueStatus) => ACTIVE_STATUSES.includes(s);
/** งานอยู่ในมือ VSM หรือเปล่า */
export const needsVsmAction = (s: IssueStatus) => VSM_ACTION_STATUSES.includes(s);
/** รอ QC ตรวจรับอยู่หรือเปล่า */
export const needsQcVerify = (s: IssueStatus) => s === 'fixed';

/**
 * ช่วงเวลาของแต่ละกะ — A 08:00–15:59 · B 16:00–23:59 · C 00:00–07:59
 *
 * ถ้าโรงงานเปลี่ยนเวลาเข้ากะ แก้ที่นี่ที่เดียว (ค่านี้ใช้แค่เติมให้อัตโนมัติ
 * ผู้ใช้แก้เองได้เสมอ ค่าที่บันทึกจึงไม่ผูกกับตารางกะที่ตั้งไว้ตรงนี้)
 */
const SHIFT_START_A = 8;
const SHIFT_START_B = 16;

/** เดากะจากเวลา HH:mm — ใช้เติมให้ตอนบันทึก ไม่ใช่ตัวตัดสินสุดท้าย */
export function shiftOf(time: string): Shift {
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return 'A';
  if (hour >= SHIFT_START_A && hour < SHIFT_START_B) return 'A';
  if (hour >= SHIFT_START_B) return 'B';
  return 'C';
}

/** กำหนดแก้ไข = วันที่พบ + จำนวนวันตามความรุนแรง */
export function dueDateFor(foundDate: ISODate, severity: Severity, settings: AppSettings): ISODate {
  const days =
    severity === 'critical'
      ? settings.due_days_critical
      : severity === 'major'
        ? settings.due_days_major
        : settings.due_days_minor;
  return addDays(foundDate, Math.max(0, days));
}

/**
 * เลยกำหนดหรือยัง — งานที่ปิดแล้วไม่นับว่าเลยกำหนดในวันนี้
 * (จะปิดทันกำหนดหรือไม่ ดูที่ closedOnTime แทน)
 */
export function isOverdue(issue: QcIssue, asOf: ISODate = todayISO()): boolean {
  return isActive(issue.status) && issue.due_date < asOf;
}

/** จำนวนวันที่ค้างอยู่ — งานที่ปิดแล้วนับถึงวันปิด */
export function ageDays(issue: QcIssue, asOf: ISODate = todayISO()): number {
  const end = issue.closed_at ? issue.closed_at.slice(0, 10) : asOf;
  return Math.max(0, diffDays(issue.found_date, end));
}

/** ปิดงานทันกำหนดไหม — ใช้ได้เฉพาะงานที่ตรวจรับผ่านแล้ว */
export function closedOnTime(issue: QcIssue): boolean | null {
  if (issue.status !== 'verified' || !issue.closed_at) return null;
  return issue.closed_at.slice(0, 10) <= issue.due_date;
}

/* ── สรุปภาพรวม ─────────────────────────────────────────────────────────── */

export interface IssueSummary {
  total: number;
  open: number;
  /** VSM รับทราบแล้ว ยังไม่เริ่มลงมือ */
  acked: number;
  /** กำลังแก้ไข (เริ่มลงมือแล้ว ไม่รวมใบที่ถูกตีกลับ) */
  inProgress: number;
  awaitingVerify: number;
  rejected: number;
  verified: number;
  cancelled: number;
  overdue: number;
  /** งานที่ยังไม่ปิด (ทุกสถานะที่ยังต้องทำต่อ) */
  active: number;
  closedOnTime: number;
  /** ปิดทันกำหนด ÷ ปิดทั้งหมด */
  onTimePct: number;
  /** วันเฉลี่ยตั้งแต่พบจนปิด (เฉพาะงานที่ปิดแล้ว) */
  avgCloseDays: number;
  /** สัดส่วนงานที่ถูกตีกลับอย่างน้อยหนึ่งครั้ง */
  reworkPct: number;
}

export function summarize(issues: QcIssue[], fixes: IssueFix[], asOf: ISODate = todayISO()): IssueSummary {
  const count = (s: IssueStatus) => issues.filter((i) => i.status === s).length;
  const verifiedList = issues.filter((i) => i.status === 'verified');
  const onTime = verifiedList.filter((i) => closedOnTime(i) === true).length;
  const closeDays = verifiedList.map((i) => ageDays(i, asOf));
  const reworked = new Set(fixes.filter((f) => f.verify_result === 'fail').map((f) => f.issue_id));
  const scopedRework = issues.filter((i) => reworked.has(i.id)).length;

  return {
    total: issues.length,
    open: count('open'),
    acked: issues.filter((i) => displayStatus(i) === 'acked').length,
    inProgress: issues.filter((i) => displayStatus(i) === 'in_progress').length,
    awaitingVerify: count('fixed'),
    rejected: count('rejected'),
    verified: verifiedList.length,
    cancelled: count('cancelled'),
    overdue: issues.filter((i) => isOverdue(i, asOf)).length,
    active: issues.filter((i) => isActive(i.status)).length,
    closedOnTime: onTime,
    onTimePct: pctOf(onTime, verifiedList.length),
    avgCloseDays: closeDays.length
      ? Math.round((closeDays.reduce((a, b) => a + b, 0) / closeDays.length) * 10) / 10
      : 0,
    reworkPct: pctOf(scopedRework, issues.length),
  };
}

/* ── ราย VSM ────────────────────────────────────────────────────────────── */

export interface VsmRow {
  vsm_line: VsmLine;
  total: number;
  active: number;
  overdue: number;
  verified: number;
  onTimePct: number;
  avgCloseDays: number;
  critical: number;
  rank: number;
}

/**
 * เรียงอันดับสาย — ดีที่สุดคือปิดตรงเวลาสูงและไม่มีของค้างเลยกำหนด
 *
 * ไม่ได้เรียงตามจำนวนปัญหาที่พบ เพราะสายที่ถูกตรวจถี่กว่าย่อมเจอมากกว่าโดยธรรมชาติ
 * ถ้าเอาจำนวนมาจัดอันดับ จะกลายเป็นการลงโทษสายที่ถูกตรวจบ่อย
 * แล้วทุกคนจะเริ่มกดดันให้ QC ตรวจน้อยลง ซึ่งตรงข้ามกับที่ระบบนี้ต้องการ
 */
export function byVsm(issues: QcIssue[], asOf: ISODate = todayISO()): VsmRow[] {
  const rows = VSM_LINES.map((line) => {
    const scope = issues.filter((i) => i.vsm_line === line);
    const verified = scope.filter((i) => i.status === 'verified');
    const onTime = verified.filter((i) => closedOnTime(i) === true).length;
    const days = verified.map((i) => ageDays(i, asOf));
    return {
      vsm_line: line,
      total: scope.length,
      active: scope.filter((i) => isActive(i.status)).length,
      overdue: scope.filter((i) => isOverdue(i, asOf)).length,
      verified: verified.length,
      onTimePct: pctOf(onTime, verified.length),
      avgCloseDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : 0,
      critical: scope.filter((i) => i.severity === 'critical' && isActive(i.status)).length,
      rank: 0,
    };
  });

  rows.sort((a, b) => b.onTimePct - a.onTimePct || a.overdue - b.overdue || a.avgCloseDays - b.avgCloseDays);
  let lastScore = Number.NaN;
  let lastRank = 0;
  rows.forEach((r, i) => {
    const score = r.onTimePct * 1000 - r.overdue;
    if (score !== lastScore) {
      lastRank = i + 1;
      lastScore = score;
    }
    r.rank = lastRank;
  });
  return rows;
}

/* ── รายประเภทข้อบกพร่อง ───────────────────────────────────────────────── */

export interface CategoryRow {
  category: DefectCategory;
  count: number;
  qtyDefect: number;
  pct: number;
}

/** เรียงจากที่พบบ่อยสุด — ใช้เลือกหัวข้อทำ Kaizen รอบถัดไป */
export function byCategory(issues: QcIssue[], categories: DefectCategory[]): CategoryRow[] {
  const total = issues.length;
  return categories
    .map((category) => {
      const scope = issues.filter((i) => i.category_ids.includes(category.id));
      return {
        category,
        count: scope.length,
        qtyDefect: scope.reduce((s, i) => s + i.qty_defect, 0),
        pct: pctOf(scope.length, total),
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.category.category_name.localeCompare(b.category.category_name, 'th'));
}

/* ── ราย QC ─────────────────────────────────────────────────────────────── */

export interface QcRow {
  employee: Employee;
  rounds: number;
  issues: number;
  verified: number;
  /** สัดส่วนรอบตรวจที่พบข้อบกพร่อง */
  ngRatePct: number;
}

/**
 * ผลงานรายคนของผู้ที่ลงบันทึกไว้
 *
 * รับทะเบียนพนักงานทั้งหมด ไม่ใช่เฉพาะคนที่บทบาทเป็น 'qc' เพราะผู้ดูแลระบบ
 * ที่สังกัดแผนกอื่นก็บันทึกผลตรวจได้ (ดู canInspect ใน useSession)
 * ถ้ากรองด้วยบทบาท รอบตรวจของคนกลุ่มนี้จะหายไปจากตาราง ทั้งที่ถูกนับในยอดรวม
 * ตัวกรองท้ายฟังก์ชันคัดเหลือเฉพาะคนที่มีผลงานจริงอยู่แล้ว
 */
export function byQc(people: Employee[], rounds: QcRound[], issues: QcIssue[]): QcRow[] {
  return people
    .map((employee) => {
      const rs = rounds.filter((r) => r.qc_id === employee.id);
      const is = issues.filter((i) => i.qc_id === employee.id);
      return {
        employee,
        rounds: rs.length,
        issues: is.length,
        verified: is.filter((i) => i.status === 'verified').length,
        ngRatePct: pctOf(rs.filter((r) => r.result === 'ng').length, rs.length),
      };
    })
    .filter((r) => r.rounds > 0 || r.issues > 0)
    .sort((a, b) => b.rounds - a.rounds || b.issues - a.issues);
}

/* ── ตัวช่วยกรองและจัดลำดับ ─────────────────────────────────────────────── */

export function issuesInRange(issues: QcIssue[], from: ISODate, to: ISODate): QcIssue[] {
  return issues.filter((i) => inRange(i.found_date, from, to));
}

export function roundsInRange(rounds: QcRound[], from: ISODate, to: ISODate): QcRound[] {
  return rounds.filter((r) => inRange(r.round_date, from, to));
}

/** ยิ่งรุนแรงยิ่งต้องขึ้นก่อน */
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

/**
 * ลำดับความเร่งด่วน — เลยกำหนดขึ้นก่อน แล้วรุนแรงก่อน แล้วครบกำหนดเร็วก่อน
 * ใช้ทั้งหน้างานของฉันและทะเบียนปัญหา เพื่อให้ลำดับที่เห็นตรงกันเสมอ
 */
export function sortByUrgency(issues: QcIssue[], asOf: ISODate = todayISO()): QcIssue[] {
  return [...issues].sort((a, b) => {
    const ao = isOverdue(a, asOf) ? 0 : 1;
    const bo = isOverdue(b, asOf) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const sw = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    if (sw !== 0) return sw;
    return a.due_date.localeCompare(b.due_date) || a.found_date.localeCompare(b.found_date);
  });
}

/**
 * สายที่คนนี้ต้องรับผิดชอบแก้ไข — สายของตัวเอง (ถ้าเป็น VSM) + สายที่ถูกตั้งเป็นหัวหน้า
 * หัวหน้าสายไม่จำเป็นต้องมีบทบาท VSM (เช่น ผู้จัดการฝ่ายผลิตที่ดูแลหลายสาย)
 */
export function responsibleLines(
  who: { role: Role; employee_id: string; vsm_line: VsmLine | null },
  heads: LineHead[],
): VsmLine[] {
  const lines = new Set<VsmLine>(heads.filter((h) => h.employee_id === who.employee_id).map((h) => h.vsm_line));
  // VSM ที่ไม่ได้ผูกสาย = ไม่มีงานเข้า ดีกว่าเห็นงานของทุกสายแล้วแก้ผิดใบ
  if (who.role === 'vsm' && who.vsm_line) lines.add(who.vsm_line);
  return VSM_LINES.filter((l) => lines.has(l));
}

/** งานที่ผู้ใช้คนนี้ต้องลงมือทำต่อ — หัวใจของหน้างานของฉัน */
export function inboxFor(
  issues: QcIssue[],
  who: { role: Role; employee_id: string; vsm_line: VsmLine | null },
  heads: LineHead[] = [],
): QcIssue[] {
  const lines = responsibleLines(who, heads);
  return issues.filter(
    (i) =>
      (lines.includes(i.vsm_line) && needsVsmAction(i.status)) ||
      // QC เห็นทุกใบที่รอตรวจรับ ไม่ใช่เฉพาะใบที่ตัวเองเปิด
      // เพราะกะที่รับช่วงต่อต้องตรวจรับแทนคนที่ออกเวรไปแล้วได้
      (who.role === 'qc' && needsQcVerify(i.status)),
  );
}

/** งานของฉันที่ยังค้าง — สำหรับ QC คือใบที่ตัวเองเปิดแล้วยังไม่ปิด */
export function myOpenIssues(issues: QcIssue[], employeeId: string): QcIssue[] {
  return issues.filter((i) => i.qc_id === employeeId && isActive(i.status));
}
