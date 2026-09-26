/**
 * สรุปผลสำหรับแดชบอร์ด — คำนวณที่ฝั่งเซิร์ฟเวอร์ทั้งหมด
 *
 * ⚠️ ห้ามรับตัวเลขสรุปจาก client มาใช้เด็ดขาด ทุกค่าคำนวณใหม่จากข้อมูลดิบที่นี่
 *
 * สูตรตรงกับ src/lib/calc.ts ของ frontend
 *   On-time %   = ใบที่ปิดภายในกำหนด ÷ ใบที่ปิดแล้วทั้งหมด × 100
 *   NG rate %   = รอบตรวจที่พบข้อบกพร่อง ÷ รอบตรวจทั้งหมด × 100
 *   Rework %    = ใบที่ถูกตีกลับอย่างน้อยหนึ่งครั้ง ÷ ใบทั้งหมด × 100
 *   ทุกเปอร์เซ็นต์ปัดลง (floor) — 17/30 = 56%
 *
 * งานที่ยกเลิกไม่ถูกนับในตัวหารของทุกสูตร เพราะเป็นใบที่บันทึกผิดหรือซ้ำ
 * ถ้านับด้วยจะทำให้ตัวเลขคุณภาพเพี้ยนตามจำนวนครั้งที่คนกรอกผิด
 */

import { todayBangkok, VSM_LINES } from './http.js';

const pct = (a, b) => (b > 0 ? Math.floor((a / b) * 100) : 0);

/** สถานะที่ยังต้องมีคนทำอะไรต่อ */
const ACTIVE_SQL = `('open', 'in_progress', 'fixed', 'rejected')`;

export async function buildSummary(db, from, to) {
  const asOf = todayBangkok();

  const [issueRow, roundRow, statusRows, lineRows, categoryRows, reworkRow, closeRow] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ${ACTIVE_SQL} THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status IN ${ACTIVE_SQL} AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
                SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN status = 'verified' AND substr(closed_at, 1, 10) <= due_date THEN 1 ELSE 0 END) AS on_time,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
                SUM(qty_defect) AS qty_defect
           FROM qc_issues
          WHERE found_date BETWEEN ? AND ? AND status <> 'cancelled'`,
      )
      .bind(asOf, from, to)
      .first(),

    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN result = 'ng' THEN 1 ELSE 0 END) AS ng,
                COUNT(DISTINCT qc_id) AS inspectors,
                SUM(qty_checked) AS qty_checked
           FROM qc_rounds
          WHERE round_date BETWEEN ? AND ?`,
      )
      .bind(from, to)
      .first(),

    db
      .prepare(
        `SELECT status, COUNT(*) AS n
           FROM qc_issues
          WHERE found_date BETWEEN ? AND ?
          GROUP BY status`,
      )
      .bind(from, to)
      .all(),

    // ผลงานรายสาย — คิดทั้งงานค้าง เวลาปิดเฉลี่ย และอัตราปิดตรงกำหนด
    db
      .prepare(
        `SELECT vsm_line,
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ${ACTIVE_SQL} THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status IN ${ACTIVE_SQL} AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
                SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN status = 'verified' AND substr(closed_at, 1, 10) <= due_date THEN 1 ELSE 0 END) AS on_time,
                AVG(CASE WHEN status = 'verified'
                         THEN julianday(substr(closed_at, 1, 10)) - julianday(found_date) END) AS avg_days,
                SUM(CASE WHEN severity = 'critical' AND status IN ${ACTIVE_SQL} THEN 1 ELSE 0 END) AS critical
           FROM qc_issues
          WHERE found_date BETWEEN ? AND ? AND status <> 'cancelled'
          GROUP BY vsm_line`,
      )
      .bind(asOf, from, to)
      .all(),

    db
      .prepare(
        `SELECT c.id, c.category_name, c.category_name_en,
                COUNT(*) AS n,
                SUM(i.qty_defect) AS qty_defect
           FROM qc_issues i
           JOIN issue_categories ic ON ic.issue_id = i.id
           JOIN defect_categories c ON c.id = ic.category_id
          WHERE i.found_date BETWEEN ? AND ? AND i.status <> 'cancelled'
          GROUP BY c.id
          ORDER BY n DESC, c.id
          LIMIT 10`,
      )
      .bind(from, to)
      .all(),

    // ใบที่ถูกตีกลับอย่างน้อยหนึ่งครั้ง — นับ "ใบ" ไม่ใช่ "จำนวนครั้งที่ถูกตีกลับ"
    db
      .prepare(
        `SELECT COUNT(DISTINCT f.issue_id) AS n
           FROM issue_fixes f
           JOIN qc_issues i ON i.id = f.issue_id
          WHERE f.verify_result = 'fail'
            AND i.found_date BETWEEN ? AND ? AND i.status <> 'cancelled'`,
      )
      .bind(from, to)
      .first(),

    db
      .prepare(
        `SELECT AVG(julianday(substr(closed_at, 1, 10)) - julianday(found_date)) AS avg_days
           FROM qc_issues
          WHERE status = 'verified' AND closed_at IS NOT NULL AND found_date BETWEEN ? AND ?`,
      )
      .bind(from, to)
      .first(),
  ]);

  const total = issueRow?.total ?? 0;
  const verified = issueRow?.verified ?? 0;
  const onTime = issueRow?.on_time ?? 0;
  const rounds = roundRow?.total ?? 0;

  const byLine = new Map(lineRows.results.map((r) => [r.vsm_line, r]));
  const lines = VSM_LINES.map((line) => {
    const r = byLine.get(line);
    const lineVerified = r?.verified ?? 0;
    return {
      vsm_line: line,
      total: r?.total ?? 0,
      active: r?.active ?? 0,
      overdue: r?.overdue ?? 0,
      verified: lineVerified,
      critical: r?.critical ?? 0,
      on_time_pct: pct(r?.on_time ?? 0, lineVerified),
      avg_close_days: r?.avg_days == null ? 0 : Math.round(r.avg_days * 10) / 10,
    };
  });
  // เรียงเหมือน byVsm() ของ frontend: ปิดตรงเวลาสูงสุดก่อน แล้วของค้างน้อยสุด
  lines.sort((a, b) => b.on_time_pct - a.on_time_pct || a.overdue - b.overdue || a.avg_close_days - b.avg_close_days);
  lines.forEach((l, i) => (l.rank = i + 1));

  return {
    range: { from, to, as_of: asOf },

    issues: {
      total,
      active: issueRow?.active ?? 0,
      overdue: issueRow?.overdue ?? 0,
      verified,
      critical: issueRow?.critical ?? 0,
      qty_defect: issueRow?.qty_defect ?? 0,
      closed_on_time: onTime,
      on_time_pct: pct(onTime, verified),
      avg_close_days: closeRow?.avg_days == null ? 0 : Math.round(closeRow.avg_days * 10) / 10,
      rework_pct: pct(reworkRow?.n ?? 0, total),
    },

    rounds: {
      total: rounds,
      ng: roundRow?.ng ?? 0,
      ng_rate_pct: pct(roundRow?.ng ?? 0, rounds),
      inspectors: roundRow?.inspectors ?? 0,
      qty_checked: roundRow?.qty_checked ?? 0,
    },

    status_mix: Object.fromEntries(statusRows.results.map((r) => [r.status, r.n])),

    by_line: lines,

    top_categories: categoryRows.results.map((r) => ({
      category_id: r.id,
      category_name: r.category_name,
      category_name_en: r.category_name_en ?? undefined,
      count: r.n,
      qty_defect: r.qty_defect ?? 0,
      pct: pct(r.n, total),
    })),
  };
}

/* ── ส่งออก CSV ─────────────────────────────────────────────────────────── */

/** หุ้มค่าตามกติกา CSV — ใส่เครื่องหมายคำพูดเมื่อมีอักขระพิเศษ */
function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /["',\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function buildCsv(db, from, to) {
  const { results } = await db
    .prepare(
      `SELECT i.issue_no, i.found_date, i.found_time,
              q.emp_code AS qc_code, q.full_name AS qc_name,
              a.area_name, i.vsm_line, i.severity,
              (SELECT group_concat(c.category_name, ' | ' ORDER BY ic.sort_order)
                 FROM issue_categories ic JOIN defect_categories c ON c.id = ic.category_id
                WHERE ic.issue_id = i.id) AS categories,
              i.part_no, i.lot_no, i.qty_checked, i.qty_defect, i.description,
              i.shift, i.machine_no, i.model_no, op.full_name AS operator_name,
              CASE WHEN i.voice_key IS NULL OR i.voice_key = '' THEN 0 ELSE 1 END AS has_voice,
              i.due_date, i.status, i.closed_at,
              CASE WHEN i.status = 'verified' AND substr(i.closed_at, 1, 10) <= i.due_date THEN 1
                   WHEN i.status = 'verified' THEN 0 END AS on_time,
              (SELECT COUNT(*) FROM issue_fixes f WHERE f.issue_id = i.id) AS attempts,
              (SELECT COUNT(*) FROM issue_photos p WHERE p.issue_id = i.id) AS photos,
              CASE WHEN i.round_id IS NULL THEN 'นอกรอบ' ELSE 'ในรอบตรวจ' END AS source
         FROM qc_issues i
         JOIN employees q ON q.id = i.qc_id
         JOIN areas a ON a.id = i.area_id
         -- LEFT JOIN เพราะผู้ปฏิบัติงานไม่บังคับกรอก ถ้าใช้ JOIN ธรรมดา
         -- ใบที่ไม่ได้ระบุจะหายไปจากรายงานทั้งใบ
         LEFT JOIN employees op ON op.id = i.operator_id
        WHERE i.found_date BETWEEN ? AND ?
        ORDER BY i.found_date DESC, i.found_time DESC`,
    )
    .bind(from, to)
    .all();

  const SEVERITY_TH = { critical: 'วิกฤต', major: 'รุนแรง', minor: 'เล็กน้อย' };
  const STATUS_TH = {
    open: 'รอรับเรื่อง',
    in_progress: 'กำลังแก้ไข',
    fixed: 'รอตรวจรับ',
    rejected: 'ตีกลับ',
    verified: 'ปิดงานแล้ว',
    cancelled: 'ยกเลิก',
  };

  const header = [
    'เลขที่ใบแจ้ง', 'วันที่พบ', 'เวลา', 'รหัส QC', 'ชื่อ QC', 'จุดตรวจ', 'สาย VSM',
    'ประเภทข้อบกพร่อง', 'ความรุนแรง', 'รหัสชิ้นงาน', 'เลขที่ล็อต', 'ตรวจ (ชิ้น)', 'เสีย (ชิ้น)',
    'รายละเอียด', 'กะ', 'เครื่องจักร', 'รุ่นสินค้า', 'ผู้ปฏิบัติงาน', 'มีบันทึกเสียง',
    'กำหนดแก้ไข', 'สถานะ', 'วันที่ปิด', 'ทันกำหนด', 'ครั้งที่แก้ไข', 'จำนวนรูป', 'ที่มา',
  ];

  const lines = [header.map(cell).join(',')];
  for (const r of results) {
    lines.push(
      [
        r.issue_no, r.found_date, r.found_time, r.qc_code, r.qc_name, r.area_name, r.vsm_line,
        r.categories ?? '', SEVERITY_TH[r.severity] ?? r.severity,
        r.part_no, r.lot_no, r.qty_checked, r.qty_defect, r.description,
        r.shift ?? '', r.machine_no ?? '', r.model_no ?? '', r.operator_name ?? '',
        r.has_voice ? 'ใช่' : '',
        r.due_date, STATUS_TH[r.status] ?? r.status,
        r.closed_at ? r.closed_at.slice(0, 10) : '',
        r.on_time === null || r.on_time === undefined ? '' : r.on_time ? 'ใช่' : 'ไม่',
        r.attempts, r.photos, r.source,
      ]
        .map(cell)
        .join(','),
    );
  }

  // BOM ข้างหน้า เพื่อให้ Excel เปิดแล้วอ่านภาษาไทยถูก (ตรงกับ downloadText ใน csv.ts)
  return '﻿' + lines.join('\r\n');
}
