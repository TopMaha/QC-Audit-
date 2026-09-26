import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import * as api from '@/lib/api';
import { buildTree, fullPath as fullPathOf, vsmOfArea } from '@/lib/areaTree';
import { inboxFor, responsibleLines, sortByUrgency } from '@/lib/calc';
import { useI18n } from '@/lib/i18n';
import { getSession, isAdmin, subscribeSession, syncSession } from '@/lib/session';
import type { QcIssue, VsmLine } from '@/lib/types';

/** ── เซสชัน ─────────────────────────────────────────────── */
export function useSession() {
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);
  const admin = useSyncExternalStore(subscribeSession, isAdmin, () => false);

  /**
   * ผู้ดูแลระบบ — เข้าที่ /admin ตรง ๆ หรือล็อกอินเป็นพนักงานที่อยู่ในทะเบียนผู้ดูแลระบบ
   *
   * ต้องนับกรณีหลังด้วย เพราะผู้ดูแลระบบส่วนใหญ่สังกัดแผนกอื่น (เช่น VSM4)
   * บทบาทจากแผนกจึงไม่ใช่ 'qc' ถ้าดูแต่บทบาท คนกลุ่มนี้จะบันทึกอะไรไม่ได้เลย
   * ต้องออกจากระบบก่อนทุกครั้งที่จะลงบันทึกสักใบ ซึ่งไม่มีใครทำจริงหน้างาน
   */
  const superuser = admin || Boolean(session?.superuser);

  /**
   * ใครบันทึกผลตรวจและเปิดใบแจ้งได้ — QC ตามหน้าที่ และผู้ดูแลระบบ
   *
   * ฝั่ง Worker ไม่ได้จำกัดบทบาทของคนที่บันทึกรอบตรวจ/เปิดใบแจ้งอยู่แล้ว
   * ปุ่มที่เปิดเพิ่มตรงนี้จึงกดแล้วผ่านจริง ไม่ใช่ปุ่มที่กดแล้วได้ 403 กลับมา
   * (ต่างจากการตรวจรับ ซึ่ง Worker บังคับว่าต้องเป็น QC — ดู IssueDetail)
   */
  const canInspect = session?.role === 'qc' || superuser;

  return { session, admin, superuser, canInspect };
}

/** ── ข้อมูลหลัก ─────────────────────────────────────────── */
export const useEmployees = () => useQuery({ queryKey: ['employees'], queryFn: api.getEmployees });
export const useAreas = () => useQuery({ queryKey: ['areas'], queryFn: api.getAreas });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: api.getCategories });
export const useRounds = () => useQuery({ queryKey: ['rounds'], queryFn: api.getRounds });
export const useIssues = () => useQuery({ queryKey: ['issues'], queryFn: api.getIssues });
export const useFixes = () => useQuery({ queryKey: ['fixes'], queryFn: api.getFixes });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
export const useLineHeads = () => useQuery({ queryKey: ['lineHeads'], queryFn: api.getLineHeads });
export const useLoginHistory = () => useQuery({ queryKey: ['loginHistory'], queryFn: api.getLoginHistory });
export const useChangeHistory = (recordId?: string) =>
  useQuery({ queryKey: ['changes', recordId ?? 'all'], queryFn: () => api.getChangeHistory(recordId) });

/** โหลดข้อมูลชุดหลักพร้อมกัน — ใช้ในหน้าที่ต้องใช้หลายตาราง */
export function useCoreData() {
  const employees = useEmployees();
  const areas = useAreas();
  const categories = useCategories();
  const rounds = useRounds();
  const issues = useIssues();
  const fixes = useFixes();
  const { lang } = useI18n();

  const tree = useMemo(() => buildTree(areas.data ?? [], lang), [areas.data, lang]);
  const pathOf = useCallback((areaId: string) => fullPathOf(areas.data ?? [], areaId, lang), [areas.data, lang]);
  const lineOf = useCallback(
    (areaId: string): VsmLine | null => vsmOfArea(areas.data ?? [], areaId),
    [areas.data],
  );
  const activeEmployees = useMemo(() => (employees.data ?? []).filter((m) => m.is_active), [employees.data]);

  return {
    employees: employees.data ?? [],
    activeEmployees,
    areas: areas.data ?? [],
    categories: categories.data ?? [],
    rounds: rounds.data ?? [],
    issues: issues.data ?? [],
    fixes: fixes.data ?? [],
    tree,
    pathOf,
    lineOf,
    isLoading:
      employees.isLoading ||
      areas.isLoading ||
      categories.isLoading ||
      rounds.isLoading ||
      issues.isLoading ||
      fixes.isLoading,
  };
}

/** ใบแจ้งใบเดียวพร้อมงานแก้ไขทั้งหมดของมัน — ใช้ในหน้ารายละเอียด */
export function useIssueDetail(issueId: string | undefined) {
  const { issues, fixes, ...rest } = useCoreData();
  const issue = useMemo(() => issues.find((i) => i.id === issueId), [issues, issueId]);
  const issueFixes = useMemo(
    () => fixes.filter((f) => f.issue_id === issueId).sort((a, b) => a.attempt - b.attempt),
    [fixes, issueId],
  );
  return { issue, fixes: issueFixes, allIssues: issues, ...rest };
}

/**
 * งานที่ผู้ใช้ปัจจุบันต้องลงมือทำ — เรียงตามความเร่งด่วนแล้ว
 * ใช้ทั้งในหน้างานของฉันและตัวเลขบนเมนู จึงต้องคำนวณที่เดียวเพื่อไม่ให้ตัวเลขขัดกัน
 */
export function useInbox(): QcIssue[] {
  const { session } = useSession();
  const { data: issues } = useIssues();
  const { data: heads } = useLineHeads();

  return useMemo(() => {
    if (!session || !issues) return [];
    const rows = inboxFor(
      issues,
      { role: session.role, employee_id: session.employee_id, vsm_line: session.vsm_line },
      heads ?? [],
    );
    return sortByUrgency(rows);
  }, [issues, session, heads]);
}

/**
 * สายที่ผู้ใช้ปัจจุบันลงมือแก้ได้ — สายของตัวเองถ้าเป็น VSM + สายที่ถูกตั้งเป็นหัวหน้า
 * ใช้ตัดสินว่าจะโชว์ปุ่มรับทราบ/เริ่มแก้ไข/แก้ไขเสร็จหรือไม่ (Worker ตรวจซ้ำด้วยกติกาเดียวกัน)
 */
export function useMyLines(): VsmLine[] {
  const { session } = useSession();
  const { data: heads } = useLineHeads();
  return useMemo(
    () =>
      session
        ? responsibleLines(
            { role: session.role, employee_id: session.employee_id, vsm_line: session.vsm_line },
            heads ?? [],
          )
        : [],
    [session, heads],
  );
}

/** ── การเขียนข้อมูล ─────────────────────────────────────── */

function useActor() {
  const { session, admin } = useSession();
  return session?.full_name ?? (admin ? 'ผู้ดูแลระบบ' : 'ไม่ระบุ');
}

export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback((keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })), [qc]);
}

export function useCreateRound() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ round, issue }: { round: api.RoundInput; issue: Parameters<typeof api.createRound>[1] }) =>
      api.createRound(round, issue, actor),
    onSuccess: () => invalidate(['rounds', 'issues', 'changes']),
  });
}

export function useCreateIssue() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: api.IssueInput) => api.createIssue(input, actor),
    onSuccess: () => invalidate(['issues', 'changes']),
  });
}

export function useUpdateIssue() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<QcIssue> }) => api.updateIssue(id, patch, actor),
    onSuccess: () => invalidate(['issues', 'changes']),
  });
}

export function useAckIssue() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.ackIssue(id, actor),
    onSuccess: () => invalidate(['issues', 'changes']),
  });
}

export function useStartIssue() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.startIssue(id, actor),
    onSuccess: () => invalidate(['issues', 'changes']),
  });
}

export function useSaveLineHeads() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ line, ids }: { line: VsmLine; ids: string[] }) => api.saveLineHeads(line, ids, actor),
    onSuccess: () => invalidate(['lineHeads', 'employees', 'changes']),
  });
}

export function useCancelIssue() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.cancelIssue(id, actor),
    onSuccess: () => invalidate(['issues', 'changes']),
  });
}

export function useSubmitFix() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: api.FixInput) => api.submitFix(input, actor),
    onSuccess: () => invalidate(['fixes', 'issues', 'changes']),
  });
}

export function useVerifyFix() {
  const actor = useActor();
  const { session } = useSession();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ fixId, result, note }: { fixId: string; result: 'pass' | 'fail'; note: string }) =>
      api.verifyFix(fixId, result, note, session?.employee_id ?? '-', actor),
    onSuccess: () => invalidate(['fixes', 'issues', 'changes']),
  });
}

export function useSaveEmployee() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.saveEmployee>[0]) => api.saveEmployee(input, actor),
    onSuccess: () => invalidate(['employees', 'changes']),
  });
}

export function useSaveArea() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.saveArea>[0]) => api.saveArea(input, actor),
    onSuccess: () => invalidate(['areas', 'changes']),
  });
}

export function useSaveCategory() {
  const actor = useActor();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.saveCategory>[0]) => api.saveCategory(input, actor),
    onSuccess: () => invalidate(['categories', 'changes']),
  });
}

export function useSaveSettings() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: api.saveSettings, onSuccess: () => invalidate(['settings']) });
}

/**
 * Admin ปิดบัญชี/สิทธิ์/ย้ายสายแล้วต้องมีผลทันที
 * ตรวจสถานะผู้ใช้ทุกครั้งที่ข้อมูล employees ถูกโหลดใหม่
 */
export function useSessionGuard() {
  const { session } = useSession();
  const { data: employees } = useEmployees();

  useEffect(() => {
    // ทะเบียนว่าง = ยังดึงจากเซิร์ฟเวอร์ไม่เสร็จ (ไม่ได้ฝังไว้ในไฟล์เว็บแล้ว) ห้ามตีความว่าถูกลบออก
    if (!session || !employees?.length) return;
    syncSession(employees.find((e) => e.id === session.employee_id));
  }, [session, employees]);
}
