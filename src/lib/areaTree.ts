import type { Area, VsmLine } from './types';
import type { Lang } from './time';

export interface AreaNode extends Area {
  children: AreaNode[];
  depth: number;
  path: string[]; // ชื่อพื้นที่ตั้งแต่ระดับบนสุดถึงตัวเอง
}

export function areaLabel(a: Pick<Area, 'area_name' | 'area_name_en'>, lang: Lang): string {
  return lang === 'en' ? a.area_name_en || a.area_name : a.area_name;
}

/** จัดพื้นที่เป็นโครงสร้างต้นไม้ Parent–Child */
export function buildTree(areas: Area[], lang: Lang = 'th'): AreaNode[] {
  const byId = new Map<string, AreaNode>();
  areas.forEach((a) => byId.set(a.id, { ...a, children: [], depth: 0, path: [] }));

  const roots: AreaNode[] = [];
  byId.forEach((node) => {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const walk = (node: AreaNode, depth: number, path: string[]) => {
    node.depth = depth;
    node.path = [...path, areaLabel(node, lang)];
    node.children.sort((a, b) => areaLabel(a, lang).localeCompare(areaLabel(b, lang), 'th'));
    node.children.forEach((c) => walk(c, depth + 1, node.path));
  };
  roots.sort((a, b) => areaLabel(a, lang).localeCompare(areaLabel(b, lang), 'th'));
  roots.forEach((r) => walk(r, 0, []));
  return roots;
}

export function flatten(nodes: AreaNode[]): AreaNode[] {
  const out: AreaNode[] = [];
  const walk = (list: AreaNode[]) => list.forEach((n) => (out.push(n), walk(n.children)));
  walk(nodes);
  return out;
}

/** เส้นทางเต็ม เช่น 'สายการผลิต VSM2 › เชื่อม' */
export function fullPath(areas: Area[], areaId: string, lang: Lang = 'th'): string {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const parts: string[] = [];
  let cur = byId.get(areaId);
  let guard = 0;
  while (cur && guard++ < 12) {
    parts.unshift(areaLabel(cur, lang));
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join(' › ');
}

export function areaName(areas: Area[], areaId: string, lang: Lang = 'th'): string {
  const a = areas.find((x) => x.id === areaId);
  return a ? areaLabel(a, lang) : '—';
}

/**
 * สายผู้รับผิดชอบของพื้นที่ — ไต่ขึ้นไปหาแม่จนกว่าจะเจอ
 *
 * สถานีย่อยมักตั้ง vsm_line ไว้อยู่แล้ว แต่ถ้าผู้ดูแลระบบเพิ่มสถานีใหม่แล้วลืมใส่
 * เราต้องยังเดาให้ถูกจากสายแม่ ไม่ใช่ปล่อยให้ QC เลือกเองทุกครั้ง
 */
export function vsmOfArea(areas: Area[], areaId: string): VsmLine | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let cur = byId.get(areaId);
  let guard = 0;
  while (cur && guard++ < 12) {
    if (cur.vsm_line) return cur.vsm_line;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}

/** ค้นหาได้ทุกระดับ คืนผลพร้อมเส้นทางเต็ม */
export function searchAreas(areas: Area[], term: string, lang: Lang = 'th'): { area: Area; path: string }[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  return areas
    .filter((a) => a.is_active)
    .filter((a) => `${a.area_name} ${a.area_name_en ?? ''}`.toLowerCase().includes(q))
    .slice(0, 40)
    .map((area) => ({ area, path: fullPath(areas, area.id, lang) }));
}

export function childrenOf(areas: Area[], parentId: string | null): Area[] {
  return areas.filter((a) => a.parent_id === parentId && a.is_active);
}

export function hasChildren(areas: Area[], id: string): boolean {
  return areas.some((a) => a.parent_id === id && a.is_active);
}

/** id ของตัวเองและลูกหลานทั้งหมด */
export function descendantIds(areas: Area[], id: string): string[] {
  const out = [id];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    areas.filter((a) => a.parent_id === cur).forEach((a) => (out.push(a.id), stack.push(a.id)));
  }
  return out;
}
