/**
 * ส่งออกรายงานเป็นไฟล์ Excel (.xlsx) — สรุปราย VSM · ขั้นตอนการดำเนินการ · รูป BEFORE / AFTER
 *
 * สร้างในเบราว์เซอร์ทั้งหมด (ไม่ผ่าน Worker) เพราะรูปที่ยังไม่ได้ซิงก์ก็อยู่ในเครื่องนี้
 * และ Worker ไม่ต้องแบกไลบรารีขนาดใหญ่ ExcelJS ถูกโหลดเฉพาะตอนกดส่งออก (dynamic import)
 * หน้าแอปปกติจึงไม่หนักขึ้นเลย
 *
 * โครงไฟล์
 *   สรุปภาพรวม      ตัวเลขหลัก · ตารางราย VSM แยกตามขั้นตอน · กราฟ · ประเภท/เครื่องจักรที่พบบ่อย
 *   VSM1 … VSM4     ทุกใบของสายนั้น พร้อมการดำเนินการ การแก้ไข และรูปก่อน/หลังแก้ไข
 *   ข้อมูลทั้งหมด    ตารางแบนสำหรับกรอง/ทำ Pivot ต่อ
 */

import type { Workbook, Worksheet, Cell, Fill, Borders } from 'exceljs';
import { byCategory, byVsm, closedOnTime, isOverdue, issuesInRange, pctOf, stageOf } from './calc';
import { rankChart, stageChart, STAGE_HEX } from './exportCharts';
import type { TKey } from './i18n';
import { readPhotoBlob } from './photos';
import type { Lang } from './time';
import { STAGES, VSM_LINES } from './types';
import type { DefectCategory, Employee, IssueFix, QcIssue, Stage, VsmLine } from './types';

export interface ExcelInput {
  from: string;
  to: string;
  lang: Lang;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  issues: QcIssue[];
  fixes: IssueFix[];
  employees: Employee[];
  categories: DefectCategory[];
  pathOf: (areaId: string) => string;
  exportedBy: string;
  onProgress?: (message: string) => void;
}

/* ── หน้าตา ─────────────────────────────────────────────────────────────── */

const FONT = 'Tahoma'; // มีทุกเครื่องทั้ง Windows และ Mac และแสดงภาษาไทยได้
const BRAND = 'FF253F94';
const BRAND_TINT = 'FFE9EDF8';
const INK = 'FF141A33';
const MUTED = 'FF5A6275';
const LINE = 'FFD9DEE8';
const ZEBRA = 'FFF7F8FB';

const fill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin' as const, color: { argb: LINE } };
const box: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin };

/** สีจางของแต่ละขั้น — ใช้เป็นพื้นช่องตัวเลข/ช่องสถานะ (ตัวอักษรยังเป็นสีหมึก) */
const STAGE_TINT: Record<Stage, string> = {
  found: 'FFFBE8E9',
  acked: 'FFE3F3F7',
  fixing: 'FFFBF0E3',
  fixed: 'FFF0EBFA',
  closed: 'FFE5F3EC',
};
const argbOf = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

function style(cell: Cell, opts: { bold?: boolean; size?: number; color?: string; bg?: string; wrap?: boolean; align?: 'left' | 'center' | 'right'; border?: boolean } = {}) {
  cell.font = { name: FONT, size: opts.size ?? 10, bold: opts.bold, color: { argb: opts.color ?? INK } };
  if (opts.bg) cell.fill = fill(opts.bg);
  cell.alignment = { vertical: 'middle', horizontal: opts.align ?? 'left', wrapText: opts.wrap ?? false };
  if (opts.border) cell.border = box;
}

/** แถบหัวรายงานสีน้ำเงินแบรนด์ + บรรทัดรายละเอียดช่วงเวลา */
function banner(ws: Worksheet, lastCol: string, title: string, sub: string, logoId: number | null) {
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getRow(1).height = 40;
  const t = ws.getCell('A1');
  t.value = title;
  style(t, { bold: true, size: 16, color: 'FFFFFFFF', bg: BRAND });
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  // เติมสีทุกช่องในแถว เผื่อช่องที่อยู่นอกพื้นที่ผสาน
  ws.mergeCells(`A2:${lastCol}2`);
  ws.getRow(2).height = 22;
  const s = ws.getCell('A2');
  s.value = sub;
  style(s, { size: 10, color: INK, bg: BRAND_TINT });
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  if (logoId !== null) {
    // โลโก้สีขาวชิดขวาบนแถบน้ำเงิน — สัดส่วนเดิมของไฟล์โลโก้ (600×101)
    const cols = ws.columns.length;
    ws.addImage(logoId, { tl: { col: Math.max(0, cols - 2.6), row: 0.28 }, ext: { width: 150, height: 25 }, editAs: 'absolute' });
  }
}

function sectionTitle(ws: Worksheet, row: number, text: string, lastCol: string) {
  ws.mergeCells(`B${row}:${lastCol}${row}`);
  const c = ws.getCell(`B${row}`);
  c.value = text;
  style(c, { bold: true, size: 12, color: BRAND });
  c.border = { bottom: { style: 'medium', color: { argb: BRAND } } };
  ws.getRow(row).height = 22;
}

function headerRow(ws: Worksheet, row: number, startCol: number, labels: string[]) {
  labels.forEach((label, i) => {
    const c = ws.getRow(row).getCell(startCol + i);
    c.value = label;
    style(c, { bold: true, color: 'FFFFFFFF', bg: BRAND, wrap: true, align: 'center', border: true });
  });
  ws.getRow(row).height = 32;
}

/* ── เวลา/ข้อความ ───────────────────────────────────────────────────────── */

function stamp(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const foundIso = (i: QcIssue) => `${i.found_date}T${i.found_time}:00+07:00`;

/* ── รูป ───────────────────────────────────────────────────────────────── */

const THUMB_W = 176;
const THUMB_H = 128;

/** ย่อรูปให้พอดีกรอบในเซลล์ — ไฟล์ Excel จะไม่บวมเป็นหลายสิบ MB */
async function thumbnail(key: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  const blob = await readPhotoBlob(key).catch(() => null);
  if (!blob) return null;
  try {
    const bmp = await createImageBitmap(blob);
    // เก็บความละเอียด 2 เท่าของขนาดที่แสดง ซูมดูใน Excel แล้วยังชัด
    const scale = Math.min((THUMB_W * 2) / bmp.width, (THUMB_H * 2) / bmp.height, 1);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const fit = Math.min(THUMB_W / w, THUMB_H / h);
    return { dataUrl: c.toDataURL('image/jpeg', 0.8), w: Math.round(w * fit), h: Math.round(h * fit) };
  } catch {
    return null;
  }
}

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}brand/tenneco-logo-white.png`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ── หัวคอลัมน์สองภาษา ─────────────────────────────────────────────────── */

const L = {
  th: {
    title: 'QC Audit Line · รายงานสรุปปัญหาหน้าไลน์',
    period: 'ช่วงเวลา',
    exported: 'ออกรายงาน',
    by: 'โดย',
    summarySheet: 'สรุปภาพรวม',
    rawSheet: 'ข้อมูลทั้งหมด',
    overview: 'ภาพรวม',
    kpi: ['ใบแจ้งทั้งหมด', 'ยังไม่ปิด', 'เลยกำหนด', 'ปิดงานแล้ว', 'ปิดตรงกำหนด', 'เวลาปิดเฉลี่ย (วัน)'],
    byVsm: 'สรุปราย VSM ตามขั้นตอนการดำเนินการ',
    vsmCols: ['สาย', 'ทั้งหมด', 'QC พบปัญหา', 'VSM รับทราบ', 'กำลังแก้ไข', 'แก้ไขเสร็จ\n(รอตรวจรับ)', 'QC ตรวจรับ\n(ปิดงาน)', 'เลยกำหนด', 'ปิดตรงกำหนด %', 'เวลาปิดเฉลี่ย (วัน)', 'ถูกตีกลับ (ครั้ง)', 'ยกเลิก'],
    total: 'รวม',
    topCats: 'ประเภทข้อบกพร่องที่พบบ่อย',
    catCols: ['ประเภท', 'จำนวนใบ', '%'],
    topMachines: 'เครื่องจักรที่พบปัญหาบ่อย',
    machineCols: ['เครื่องจักร', 'สาย', 'จำนวนใบ', 'ยังไม่ปิด', 'พบล่าสุด'],
    lineTitle: '{vsm} · ปัญหาที่พบ การดำเนินการ และการแก้ไข',
    lineSub: '{n} ใบ · ปิดงานแล้ว {closed} · ยังไม่ปิด {open} · เลยกำหนด {overdue}',
    detailCols: ['ลำดับ', 'เลขที่ใบแจ้ง', 'วันที่พบ', 'จุดตรวจ', 'เครื่องจักร', 'ปัญหาที่พบ', 'ประเภท / ความรุนแรง', 'ขั้นตอนปัจจุบัน', 'การดำเนินการ', 'การแก้ไข', 'ผู้แก้ไข', 'BEFORE', 'AFTER'],
    none: 'ไม่มีใบแจ้งในช่วงนี้',
    tlFound: 'QC พบ',
    tlAck: 'VSM รับทราบ',
    tlStart: 'เริ่มแก้ไข',
    tlFixed: 'แก้ไขเสร็จ (ครั้งที่ {n})',
    tlReject: 'QC ตีกลับ ครั้งที่ {n}: {note}',
    tlClosed: 'QC ตรวจรับ ปิดงาน',
    rootCause: 'สาเหตุ',
    noPhoto: 'ไม่มีรูป',
    rawCols: ['เลขที่ใบแจ้ง', 'วันที่พบ', 'เวลา', 'สาย', 'จุดตรวจ', 'เครื่องจักร', 'รุ่นสินค้า', 'กะ', 'QC ผู้พบ', 'ประเภท', 'ความรุนแรง', 'ปัญหาที่พบ', 'ตรวจ (ชิ้น)', 'เสีย (ชิ้น)', 'ขั้นตอน', 'สถานะ', 'กำหนดแก้ไข', 'เลยกำหนด', 'VSM รับทราบ', 'เริ่มแก้ไข', 'แก้ไขเสร็จ', 'QC ตรวจรับ', 'ทันกำหนด', 'ครั้งที่แก้', 'การแก้ไขล่าสุด', 'ผู้แก้ไข', 'รูป BEFORE', 'รูป AFTER'],
    yes: 'ใช่',
    no: 'ไม่',
  },
  en: {
    title: 'QC Audit Line · Line issue summary',
    period: 'Period',
    exported: 'Exported',
    by: 'by',
    summarySheet: 'Summary',
    rawSheet: 'All data',
    overview: 'Overview',
    kpi: ['Total issues', 'Still open', 'Overdue', 'Closed', 'Closed on time', 'Avg days to close'],
    byVsm: 'Per-VSM summary by process step',
    vsmCols: ['Line', 'Total', 'QC found', 'VSM acknowledged', 'Fixing', 'Fix completed\n(awaiting QC)', 'QC verified\n(closed)', 'Overdue', 'On time %', 'Avg days to close', 'Returned (times)', 'Cancelled'],
    total: 'Total',
    topCats: 'Most frequent defect types',
    catCols: ['Defect type', 'Issues', '%'],
    topMachines: 'Machines with most issues',
    machineCols: ['Machine', 'Line', 'Issues', 'Open', 'Last found'],
    lineTitle: '{vsm} · Issues, actions and fixes',
    lineSub: '{n} issues · closed {closed} · open {open} · overdue {overdue}',
    detailCols: ['#', 'Issue no.', 'Found', 'Checkpoint', 'Machine', 'Problem', 'Type / severity', 'Current step', 'Actions', 'Fix', 'Fixed by', 'BEFORE', 'AFTER'],
    none: 'No issues in this period',
    tlFound: 'QC found',
    tlAck: 'VSM acknowledged',
    tlStart: 'Fix started',
    tlFixed: 'Fix completed (#{n})',
    tlReject: 'Returned by QC #{n}: {note}',
    tlClosed: 'QC verified, closed',
    rootCause: 'Cause',
    noPhoto: 'No photo',
    rawCols: ['Issue no.', 'Found date', 'Time', 'Line', 'Checkpoint', 'Machine', 'Model', 'Shift', 'Found by', 'Defect type', 'Severity', 'Problem', 'Checked', 'Defective', 'Step', 'Status', 'Due', 'Overdue', 'Acknowledged', 'Fix started', 'Fix completed', 'QC verified', 'On time', 'Fix attempts', 'Latest fix', 'Fixed by', 'BEFORE photos', 'AFTER photos'],
    yes: 'Yes',
    no: 'No',
  },
};

const fmt = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

/* ── ตัวสร้างไฟล์ ───────────────────────────────────────────────────────── */

export async function exportExcel(input: ExcelInput): Promise<void> {
  const { from, to, lang, t, fixes, employees, categories, pathOf } = input;
  const l = L[lang];
  const progress = input.onProgress ?? (() => {});
  progress(t('xls.preparing'));

  const { default: ExcelJS } = await import('exceljs');
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'QC Audit Line';
  wb.created = new Date();

  const inRange = issuesInRange(input.issues, from, to).sort(
    (a, b) => a.found_date.localeCompare(b.found_date) || a.found_time.localeCompare(b.found_time),
  );
  const live = inRange.filter((i) => i.status !== 'cancelled');
  const nameOf = (id: string | null | undefined) => {
    const e = employees.find((x) => x.id === id);
    return e ? (lang === 'en' && e.full_name_en ? e.full_name_en : e.full_name) : '';
  };
  const catName = (id: string) => {
    const c = categories.find((x) => x.id === id);
    return c ? (lang === 'en' && c.category_name_en ? c.category_name_en : c.category_name) : id;
  };
  const fixesOf = (id: string) => fixes.filter((f) => f.issue_id === id).sort((a, b) => a.attempt - b.attempt);
  const stageLabel = (s: Stage) => t(`stage.${s}` as 'stage.found');
  const stageLabels = Object.fromEntries(STAGES.map((s) => [s, stageLabel(s)])) as Record<Stage, string>;

  const logo = await loadLogo();
  const logoId = logo ? wb.addImage({ base64: logo, extension: 'png' }) : null;
  const sub = `${l.period} ${stamp(`${from}T00:00:00+07:00`, lang).slice(0, 10)} – ${stamp(`${to}T00:00:00+07:00`, lang).slice(0, 10)} · ${l.exported} ${stamp(new Date().toISOString(), lang)} ${l.by} ${input.exportedBy}`;

  /* ── ชีตสรุป ──────────────────────────────────────────────────────────── */
  const ws = wb.addWorksheet(l.summarySheet, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = [{ width: 2 }, ...Array.from({ length: 12 }, () => ({ width: 13 }))];
  banner(ws, 'M', l.title, sub, logoId);

  const closedList = live.filter((i) => i.status === 'verified');
  const onTime = closedList.filter((i) => closedOnTime(i) === true).length;
  const vsmRows = byVsm(live);
  const avgClose = closedList.length
    ? Math.round((vsmRows.reduce((s, r) => s + r.avgCloseDays * r.verified, 0) / closedList.length) * 10) / 10
    : 0;
  const overdue = live.filter((i) => isOverdue(i)).length;

  sectionTitle(ws, 4, l.overview, 'M');
  const kpis: [string, number, string, string?][] = [
    [l.kpi[0], live.length, BRAND],
    [l.kpi[1], live.length - closedList.length, BRAND],
    [l.kpi[2], overdue, overdue ? argbOf(STAGE_HEX.found) : BRAND],
    [l.kpi[3], closedList.length, argbOf(STAGE_HEX.closed)],
    [l.kpi[4], pctOf(onTime, closedList.length) / 100, BRAND, '0%'],
    [l.kpi[5], avgClose, BRAND],
  ];
  kpis.forEach(([label, value, color, numFmt], i) => {
    const c0 = 2 + i * 2;
    ws.mergeCells(5, c0, 5, c0 + 1);
    ws.mergeCells(6, c0, 6, c0 + 1);
    const lc = ws.getRow(5).getCell(c0);
    lc.value = label;
    style(lc, { size: 9, color: MUTED, bg: ZEBRA, align: 'center' });
    const vc = ws.getRow(6).getCell(c0);
    vc.value = value;
    style(vc, { size: 20, bold: true, color, bg: ZEBRA, align: 'center' });
    if (numFmt) vc.numFmt = numFmt;
    for (const r of [5, 6]) for (const c of [c0, c0 + 1]) ws.getRow(r).getCell(c).border = box;
  });
  ws.getRow(5).height = 20;
  ws.getRow(6).height = 36;

  // ตารางราย VSM
  sectionTitle(ws, 8, l.byVsm, 'M');
  headerRow(ws, 9, 2, l.vsmCols);
  const stageCount = (rows: QcIssue[], s: Stage) => rows.filter((i) => stageOf(i) === s).length;
  const rejectsOf = (rows: QcIssue[]) =>
    fixes.filter((f) => f.verify_result === 'fail' && rows.some((i) => i.id === f.issue_id)).length;

  const tableRows: (string | number)[][] = VSM_LINES.map((line) => {
    const rows = live.filter((i) => i.vsm_line === line);
    const v = vsmRows.find((r) => r.vsm_line === line)!;
    return [
      line,
      rows.length,
      ...STAGES.map((s) => stageCount(rows, s)),
      v.overdue,
      v.verified ? v.onTimePct : '–',
      v.verified ? v.avgCloseDays : '–',
      rejectsOf(rows),
      inRange.filter((i) => i.vsm_line === line && i.status === 'cancelled').length,
    ];
  });
  tableRows.push([
    l.total,
    live.length,
    ...STAGES.map((s) => stageCount(live, s)),
    overdue,
    closedList.length ? pctOf(onTime, closedList.length) : '–',
    closedList.length ? avgClose : '–',
    rejectsOf(live),
    inRange.filter((i) => i.status === 'cancelled').length,
  ]);
  tableRows.forEach((vals, ri) => {
    const row = ws.getRow(10 + ri);
    const isTotal = ri === tableRows.length - 1;
    vals.forEach((v, ci) => {
      const c = row.getCell(2 + ci);
      c.value = v;
      const stage = ci >= 2 && ci <= 6 ? STAGES[ci - 2] : null;
      const bg = stage && typeof v === 'number' && v > 0 ? STAGE_TINT[stage] : isTotal ? BRAND_TINT : ri % 2 ? ZEBRA : 'FFFFFFFF';
      const color = ci === 7 && typeof v === 'number' && v > 0 ? argbOf(STAGE_HEX.found) : INK;
      style(c, { bold: isTotal || ci === 0, bg, align: ci === 0 ? 'left' : 'center', border: true, color });
    });
    row.height = 22;
  });

  // กราฟแท่งซ้อนราย VSM — วางใต้ตาราง
  let cursor = 10 + tableRows.length + 1;
  const chart1 = stageChart(
    VSM_LINES.map((line) => {
      const rows = live.filter((i) => i.vsm_line === line);
      return { label: line, counts: Object.fromEntries(STAGES.map((s) => [s, stageCount(rows, s)])) as Record<Stage, number> };
    }),
    stageLabels,
  );
  ws.addImage(wb.addImage({ base64: chart1.dataUrl, extension: 'png' }), {
    tl: { col: 1, row: cursor },
    ext: { width: chart1.width, height: chart1.height },
  });
  cursor += Math.ceil(chart1.height / 20) + 2;

  // ประเภทข้อบกพร่อง (ตารางซ้าย กราฟขวา)
  sectionTitle(ws, cursor, l.topCats, 'M');
  cursor += 1;
  const cats = byCategory(live, categories).slice(0, 10);
  ws.mergeCells(cursor, 2, cursor, 4);
  headerRow(ws, cursor, 2, [l.catCols[0]]);
  headerRow(ws, cursor, 5, l.catCols.slice(1));
  const catTop = cursor;
  cats.forEach((r, i) => {
    const rr = cursor + 1 + i;
    ws.mergeCells(rr, 2, rr, 4);
    const row = ws.getRow(rr);
    const name = row.getCell(2);
    name.value = catName(r.category.id);
    style(name, { bg: i % 2 ? ZEBRA : 'FFFFFFFF', border: true });
    [r.count, `${r.pct}%`].forEach((v, k) => {
      const c = row.getCell(5 + k);
      c.value = v;
      style(c, { bg: i % 2 ? ZEBRA : 'FFFFFFFF', align: 'center', border: true });
    });
  });
  if (cats.length) {
    const chart2 = rankChart(cats.map((r) => ({ label: catName(r.category.id), value: r.count })));
    ws.addImage(wb.addImage({ base64: chart2.dataUrl, extension: 'png' }), {
      tl: { col: 7.3, row: catTop - 1 },
      ext: { width: chart2.width, height: chart2.height },
    });
    cursor = Math.max(cursor + cats.length + 2, catTop + Math.ceil(chart2.height / 20) + 1);
  } else {
    const c = ws.getRow(cursor + 1).getCell(2);
    c.value = l.none;
    style(c, { color: MUTED });
    cursor += 3;
  }

  // เครื่องจักรที่พบบ่อย
  sectionTitle(ws, cursor, l.topMachines, 'M');
  cursor += 1;
  headerRow(ws, cursor, 2, l.machineCols);
  const machines = new Map<string, { label: string; line: VsmLine; n: number; open: number; last: string }>();
  for (const i of live) {
    const m = i.machine_no.trim();
    if (!m || m === '-') continue;
    const key = `${i.vsm_line}|${m.toUpperCase()}`;
    const cur = machines.get(key) ?? { label: m, line: i.vsm_line, n: 0, open: 0, last: '' };
    cur.n += 1;
    if (i.status !== 'verified') cur.open += 1;
    if (i.found_date > cur.last) cur.last = i.found_date;
    machines.set(key, cur);
  }
  const topMachines = [...machines.values()].sort((a, b) => b.n - a.n || b.open - a.open).slice(0, 10);
  topMachines.forEach((m, i) => {
    const row = ws.getRow(cursor + 1 + i);
    [m.label, m.line, m.n, m.open, stamp(`${m.last}T00:00:00+07:00`, lang).slice(0, 10)].forEach((v, k) => {
      const c = row.getCell(2 + k);
      c.value = v;
      style(c, { bg: i % 2 ? ZEBRA : 'FFFFFFFF', align: k >= 2 ? 'center' : 'left', border: true, bold: k === 0 });
    });
  });
  if (!topMachines.length) {
    const c = ws.getRow(cursor + 1).getCell(2);
    c.value = l.none;
    style(c, { color: MUTED });
  }

  /* ── ชีตราย VSM พร้อมรูป BEFORE / AFTER ──────────────────────────────── */
  // รวบรวมรูปที่ต้องใช้ก่อน แล้วโหลดทีละไม่กี่รูปพร้อมกัน — มือถือหน่วยความจำน้อย
  const pairs = live.map((i) => {
    const withPhotos = fixesOf(i.id).filter((f) => f.photo_urls.length);
    return { issue: i, before: i.photo_urls[0] ?? null, after: withPhotos[withPhotos.length - 1]?.photo_urls[0] ?? null };
  });
  const keys = [...new Set(pairs.flatMap((p) => [p.before, p.after]).filter((k): k is string => Boolean(k)))];
  const thumbs = new Map<string, Awaited<ReturnType<typeof thumbnail>>>();
  let done = 0;
  const queue = [...keys];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const k = queue.shift()!;
        thumbs.set(k, await thumbnail(k));
        done += 1;
        progress(t('xls.photos', { n: done, total: keys.length }));
      }
    }),
  );
  progress(t('xls.preparing'));

  for (const line of VSM_LINES) {
    const sheet = wb.addWorksheet(line, {
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    sheet.columns = [8, 16, 13, 20, 13, 34, 20, 16, 36, 34, 18, 26, 26].map((width) => ({ width }));
    const rows = pairs.filter((p) => p.issue.vsm_line === line);
    const closed = rows.filter((p) => p.issue.status === 'verified').length;
    banner(
      sheet,
      'M',
      fmt(l.lineTitle, { vsm: line }),
      `${sub} · ${fmt(l.lineSub, {
        n: rows.length,
        closed,
        open: rows.length - closed,
        overdue: rows.filter((p) => isOverdue(p.issue)).length,
      })}`,
      logoId,
    );
    headerRow(sheet, 4, 1, l.detailCols);
    // หัวคอลัมน์รูปใช้สีบอกก่อน/หลัง ให้จับคู่ได้ทันที
    style(sheet.getRow(4).getCell(12), { bold: true, color: 'FFFFFFFF', bg: argbOf(STAGE_HEX.found), align: 'center', border: true });
    style(sheet.getRow(4).getCell(13), { bold: true, color: 'FFFFFFFF', bg: argbOf(STAGE_HEX.closed), align: 'center', border: true });

    if (!rows.length) {
      sheet.mergeCells('A5:M5');
      const c = sheet.getCell('A5');
      c.value = l.none;
      style(c, { color: MUTED, align: 'center' });
      sheet.getRow(5).height = 28;
      continue;
    }

    rows.forEach(({ issue: i, before, after }, idx) => {
      const r = 5 + idx;
      const its = fixesOf(i.id);
      const last = its[its.length - 1];
      const stage = stageOf(i) as Stage;
      const timeline = [
        `${l.tlFound}: ${stamp(foundIso(i), lang)}`,
        i.acked_at ? `${l.tlAck}: ${stamp(i.acked_at, lang)}` : null,
        i.started_at ? `${l.tlStart}: ${stamp(i.started_at, lang)}` : null,
        ...its.flatMap((f) => [
          `${fmt(l.tlFixed, { n: f.attempt })}: ${stamp(f.fixed_at, lang)}`,
          f.verify_result === 'fail' ? fmt(l.tlReject, { n: f.attempt, note: f.verify_note }) : null,
        ]),
        i.closed_at ? `${l.tlClosed}: ${stamp(i.closed_at, lang)}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      const fixText = last
        ? [last.action_taken, last.root_cause ? `${l.rootCause}: ${last.root_cause}` : null].filter(Boolean).join('\n')
        : '';

      const values: (string | number)[] = [
        idx + 1,
        i.issue_no,
        `${stamp(foundIso(i), lang)}`,
        pathOf(i.area_id),
        i.machine_no || '-',
        i.description,
        `${i.category_ids.map(catName).join(', ')}\n(${t(`severity.${i.severity}` as 'severity.critical')})`,
        stageLabel(stage),
        timeline,
        fixText,
        last ? nameOf(last.responder_id) : '',
        before ? '' : l.noPhoto,
        after ? '' : l.noPhoto,
      ];
      const row = sheet.getRow(r);
      values.forEach((v, k) => {
        const c = row.getCell(k + 1);
        c.value = v;
        style(c, {
          wrap: true,
          border: true,
          align: k === 0 || k >= 11 ? 'center' : 'left',
          bold: k === 1 || k === 4,
          bg: k === 7 ? STAGE_TINT[stage] : idx % 2 ? ZEBRA : 'FFFFFFFF',
          color: k >= 11 ? MUTED : INK,
          size: k === 8 ? 9 : 10,
        });
        c.alignment = { ...c.alignment, vertical: 'top' };
      });
      // สถานะเลยกำหนดต้องเห็นเป็นตัวแดงในตาราง (ไม่ใช่สีพื้นอย่างเดียว)
      if (isOverdue(i)) row.getCell(8).font = { name: FONT, size: 10, bold: true, color: { argb: argbOf(STAGE_HEX.found) } };

      const hasPhoto = Boolean((before && thumbs.get(before)) || (after && thumbs.get(after)));
      // ความสูงแถวตามข้อความที่ยาวที่สุด (ลำดับเหตุการณ์มักยาวสุด) หรือความสูงรูป แล้วแต่อันไหนสูงกว่า
      const lines = Math.max(
        timeline.split('\n').length,
        Math.ceil(i.description.length / 30),
        Math.ceil(fixText.length / 30) + fixText.split('\n').length - 1,
      );
      row.height = Math.max(hasPhoto ? 104 : 40, lines * 12.5 + 10);
      ([[before, 11], [after, 12]] as const).forEach(([key, col]) => {
        const th = key ? thumbs.get(key) : null;
        if (!th) return;
        const id = wb.addImage({ base64: th.dataUrl, extension: 'jpeg' });
        // จัดกลางเซลล์: คอลัมน์กว้าง 26 ≈ 187px · แถวสูง 104pt ≈ 139px
        const cellW = 187;
        const cellH = 139;
        sheet.addImage(id, {
          tl: { col: col + (cellW - th.w) / 2 / cellW, row: r - 1 + (cellH - th.h) / 2 / cellH },
          ext: { width: th.w, height: th.h },
          editAs: 'oneCell',
        });
      });
    });
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: 11 } };
  }

  /* ── ชีตข้อมูลแบน ─────────────────────────────────────────────────────── */
  const raw = wb.addWorksheet(l.rawSheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  raw.columns = l.rawCols.map((header, i) => ({
    header,
    width: [15, 12, 7, 7, 22, 12, 12, 5, 22, 28, 10, 40, 8, 8, 16, 16, 12, 8, 17, 17, 17, 17, 8, 8, 40, 20, 8, 8][i] ?? 14,
  }));
  raw.getRow(1).eachCell((c) => style(c, { bold: true, color: 'FFFFFFFF', bg: BRAND, wrap: true, align: 'center', border: true }));
  raw.getRow(1).height = 30;
  for (const i of inRange) {
    const its = fixesOf(i.id);
    const last = its[its.length - 1];
    const ot = closedOnTime(i);
    const stage = stageOf(i);
    const row = raw.addRow([
      i.issue_no,
      i.found_date,
      i.found_time,
      i.vsm_line,
      pathOf(i.area_id),
      i.machine_no,
      i.model_no,
      i.shift ?? '',
      nameOf(i.qc_id),
      i.category_ids.map(catName).join(', '),
      t(`severity.${i.severity}` as 'severity.critical'),
      i.description,
      i.qty_checked,
      i.qty_defect,
      stage === 'cancelled' ? t('status.cancelled') : stageLabel(stage),
      t(`status.${i.status}` as 'status.open'),
      i.due_date,
      isOverdue(i) ? l.yes : '',
      stamp(i.acked_at, lang),
      stamp(i.started_at, lang),
      stamp(last?.fixed_at, lang),
      stamp(i.closed_at, lang),
      ot === null ? '' : ot ? l.yes : l.no,
      its.length,
      last?.action_taken ?? '',
      last ? nameOf(last.responder_id) : '',
      i.photo_urls.length,
      last?.photo_urls.length ?? 0,
    ]);
    row.eachCell((c) => {
      c.font = { name: FONT, size: 10, color: { argb: INK } };
      c.alignment = { vertical: 'top', wrapText: false };
    });
  }
  raw.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + inRange.length, column: l.rawCols.length } };

  /* ── ดาวน์โหลด ────────────────────────────────────────────────────────── */
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `QC-Audit-Line_${from}_${to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
