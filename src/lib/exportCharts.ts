/**
 * กราฟสำหรับฝังในไฟล์ Excel — วาดด้วย canvas แล้วส่งออกเป็น PNG
 *
 * ExcelJS สร้างกราฟของ Excel เองไม่ได้ จึงวาดเป็นรูปแทน ตัวเลขจริงอยู่ในตารางข้าง ๆ เสมอ
 * (กราฟเป็นภาพประกอบ ตารางคือข้อมูล — ผู้อ่านที่แยกสีไม่ได้ยังอ่านจากตารางได้ครบ)
 *
 * สเปกตามคู่มือ dataviz: แท่งบาง ปลายมน 4px ชิดฐาน · ช่องว่าง 2px สีพื้นระหว่างส่วนที่ซ้อนกัน
 * · ตัวเลขใช้สีหมึก ไม่ใช้สีของแท่ง · เส้นกริดจาง · มีคำอธิบายสีเมื่อมีมากกว่าหนึ่งชุด
 * ชุดสีขั้นตอนผ่าน scripts/validate_palette.js ของคู่มือแล้ว (โหมดสว่าง ทุกข้อ PASS)
 */

import type { Stage } from './types';

/** สีของขั้นตอน — ตรงกับโทเคน --bad/--info/--warn/--pending/--ok ใน src/index.css */
export const STAGE_HEX: Record<Stage, string> = {
  found: '#ca212c',
  acked: '#04809f',
  fixing: '#b05c07',
  fixed: '#6e3dc2',
  closed: '#1d7c50',
};

export const BRAND_HEX = '#253f94';
const INK = '#141a33';
const INK_MUTED = '#5a6275';
const GRID = '#e3e7ef';
const SURFACE = '#ffffff';
const FONT = '"IBM Plex Sans Thai", "Leelawadee UI", Tahoma, sans-serif';
/** วาดที่ 2 เท่าแล้วให้ Excel ย่อ — ตัวหนังสือจะคมบนจอความละเอียดสูง */
const SCALE = 2;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * SCALE;
  c.height = h * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  return { c, ctx };
}

/** แท่งที่มนเฉพาะมุมขวา (ปลายข้อมูล) — ด้านฐานตรงเสมอ */
function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, roundEnd: boolean) {
  if (w <= 0) return;
  const r = roundEnd ? Math.min(4, w, h / 2) : 0;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function gridX(ctx: CanvasRenderingContext2D, left: number, right: number, top: number, bottom: number, max: number) {
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const x = left + ((right - left) * i) / ticks;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
    ctx.stroke();
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(String(Math.round((max * i) / ticks)), x, bottom + 12);
  }
}

/**
 * แท่งซ้อนแนวนอน: หนึ่งแท่งต่อสาย แบ่งตามขั้นตอน 5 ขั้น
 * @returns data URL ของ PNG พร้อมขนาดที่ควรแสดง (px)
 */
export function stageChart(
  rows: { label: string; counts: Record<Stage, number> }[],
  stageLabels: Record<Stage, string>,
): { dataUrl: string; width: number; height: number } {
  const stages = Object.keys(STAGE_HEX) as Stage[];
  const width = 760;
  const legendH = 34;
  const rowH = 44;
  const top = legendH + 14;
  const height = top + rows.length * rowH + 30;
  const left = 70;
  const right = width - 56;
  const { c, ctx } = canvas(width, height);

  // คำอธิบายสี — บังคับเมื่อมีหลายชุด ตัวอักษรใช้สีหมึก สีอยู่ที่ช่องสี่เหลี่ยม
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = 'left';
  let lx = left;
  for (const s of stages) {
    ctx.fillStyle = STAGE_HEX[s];
    bar(ctx, lx, 12, 12, 12, true);
    ctx.fillStyle = INK;
    ctx.fillText(stageLabels[s], lx + 18, 18);
    lx += 18 + ctx.measureText(stageLabels[s]).width + 20;
  }

  const max = niceMax(Math.max(1, ...rows.map((r) => stages.reduce((n, s) => n + r.counts[s], 0))));
  const bottom = top + rows.length * rowH;
  gridX(ctx, left, right, top - 6, bottom, max);

  rows.forEach((r, i) => {
    const y = top + i * rowH + 10;
    const h = rowH - 20;
    ctx.fillStyle = INK;
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(r.label, left - 12, y + h / 2);

    const total = stages.reduce((n, s) => n + r.counts[s], 0);
    const lastStage = [...stages].reverse().find((s) => r.counts[s] > 0);
    let x = left;
    for (const s of stages) {
      const v = r.counts[s];
      if (!v) continue;
      const w = ((right - left) * v) / max;
      ctx.fillStyle = STAGE_HEX[s];
      // เว้น 2px สีพื้นระหว่างส่วน ให้แยกขั้นออกจากกันได้แม้สีใกล้กันในสายตาบางคน
      bar(ctx, x, y, Math.max(0, w - (s === lastStage ? 0 : 2)), h, s === lastStage);
      x += w;
    }
    ctx.fillStyle = INK;
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(String(total), x + 8, y + h / 2);
  });

  return { dataUrl: c.toDataURL('image/png'), width, height };
}

/** แท่งแนวนอนชุดเดียว (สีแบรนด์) — ใช้กับประเภทข้อบกพร่อง/เครื่องจักรที่พบบ่อย */
export function rankChart(
  rows: { label: string; value: number }[],
): { dataUrl: string; width: number; height: number } {
  const width = 560;
  const rowH = 30;
  const top = 12;
  const height = top + Math.max(1, rows.length) * rowH + 30;
  const left = 210;
  const right = width - 44;
  const { c, ctx } = canvas(width, height);
  const max = niceMax(Math.max(1, ...rows.map((r) => r.value)));
  const bottom = top + rows.length * rowH;
  gridX(ctx, left, right, top, bottom, max);

  rows.forEach((r, i) => {
    const y = top + i * rowH + 7;
    const h = rowH - 14;
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    let label = r.label;
    while (ctx.measureText(label).width > left - 16 && label.length > 4) label = `${label.slice(0, -2)}…`;
    ctx.fillText(label, left - 10, y + h / 2);

    const w = ((right - left) * r.value) / max;
    ctx.fillStyle = BRAND_HEX;
    bar(ctx, left, y, w, h, true);
    ctx.fillStyle = INK;
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(String(r.value), left + w + 6, y + h / 2);
  });

  return { dataUrl: c.toDataURL('image/png'), width, height };
}
