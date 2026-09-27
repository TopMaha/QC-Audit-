import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  BellRing, Database, Download, History, Layers, MapPin, Pencil, Plus, RefreshCw, Trash2, Upload, Users, X,
} from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { EmployeePicker } from '@/components/EmployeePicker';
import { VsmPicker } from '@/components/Pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Avatar, SkeletonList, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { FilterChip } from '@/pages/Issues';
import {
  useChangeHistory,
  useCoreData,
  useLineHeads,
  useLoginHistory,
  useSaveArea,
  useSaveCategory,
  useSaveEmployee,
  useSaveLineHeads,
  useSaveSettings,
  useSession,
  useSettings,
} from '@/hooks/useData';
import { areaLabel, descendantIds } from '@/lib/areaTree';
import { AUDIT_TABLES, fieldLabel, tableLabel } from '@/lib/auditLabels';
import { clearTransactions, exportDb, resetDb } from '@/lib/db';
import { categoryLabel, personLabel, useI18n } from '@/lib/i18n';
import { savePhoto } from '@/lib/photos';
import { todayISO } from '@/lib/time';
import { VSM_LINES } from '@/lib/types';
import type { Area, ChangeHistory, DefectCategory, Employee, Role, VsmLine } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { t } = useI18n();
  const { admin } = useSession();
  if (!admin) return <Navigate to="/admin" replace />;

  return (
    <div>
      <PageTitle title={t('nav.settings')} subtitle={t('admin.title')} />
      <Tabs defaultValue="users">
        <div className="scroll-x no-scrollbar -mx-3 mb-4 px-3">
          <TabsList>
            <TabsTrigger value="users">{t('admin.tabUsers')}</TabsTrigger>
            <TabsTrigger value="heads">{t('heads.tab')}</TabsTrigger>
            <TabsTrigger value="areas">{t('admin.tabAreas')}</TabsTrigger>
            <TabsTrigger value="categories">{t('admin.tabCategories')}</TabsTrigger>
            <TabsTrigger value="system">{t('admin.tabSystem')}</TabsTrigger>
            <TabsTrigger value="audit">{t('admin.tabAudit')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="heads"><HeadsTab /></TabsContent>
        <TabsContent value="areas"><AreasTab /></TabsContent>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
        <TabsContent value="system"><SystemTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ── หัวหน้าสาย VSM ────────────────────────────────────────────────────
   ใบแจ้งใหม่ของแต่ละสายเด้งไปหาคนเหล่านี้ และพวกเขาลงมือกับใบของสายนั้นได้
   (รับทราบ · เริ่มแก้ไข · แก้ไขเสร็จ) แม้บทบาทหรือแผนกของตัวเองจะไม่ใช่ VSM สายนั้น */
function HeadsTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { employees } = useCoreData();
  const { data: heads = [] } = useLineHeads();
  const save = useSaveLineHeads();

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
        <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        {t('heads.hint')}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {VSM_LINES.map((line) => {
          const ids = heads.filter((h) => h.vsm_line === line).map((h) => h.employee_id);
          const people = ids
            .map((id) => employees.find((e) => e.id === id))
            .filter((e): e is Employee => Boolean(e));
          // VSM ของสายที่เข้าระบบได้ก็ได้รับแจ้งอยู่แล้ว — บอกให้รู้ว่าไม่ได้มีแค่หัวหน้าที่เห็นงาน
          const members = employees.filter(
            (e) => e.role === 'vsm' && e.vsm_line === line && e.is_active && e.can_login && !ids.includes(e.id),
          ).length;

          const commit = async (next: string[]) => {
            await save.mutateAsync({ line, ids: next });
            toast(t('heads.saved', { vsm: line }));
          };

          return (
            <Card key={line}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Badge tone="accent" size="md">{line}</Badge>
                    {t('heads.title')}
                  </span>
                }
                right={<span className="num text-[12px] text-muted-foreground">{people.length}</span>}
              />
              <CardBody className="space-y-2.5">
                {people.length ? (
                  <ul className="space-y-1.5">
                    {people.map((p) => (
                      <li key={p.id} className="flex items-center gap-2.5 rounded-md border px-2.5 py-2">
                        <Avatar name={personLabel(p, lang)} src={p.avatar_url} seed={p.id} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{personLabel(p, lang)}</span>
                          <span className="num block truncate text-[11px] text-muted-foreground">
                            {p.emp_code} · {p.department}
                          </span>
                        </span>
                        {!p.can_login ? <Badge tone="warn">{t('admin.noLoginBadge')}</Badge> : null}
                        <Button
                          variant="ghost"
                          size="iconSm"
                          className="h-10 w-10"
                          disabled={save.isPending}
                          onClick={() => commit(ids.filter((x) => x !== p.id))}
                          aria-label={`${t('heads.remove')} ${personLabel(p, lang)}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2.5 text-[12px] text-muted-foreground">
                    {t('heads.none')}
                  </p>
                )}

                <EmployeePicker
                  employees={employees.filter((e) => !ids.includes(e.id))}
                  value={null}
                  onChange={(id) => (id ? void commit([...ids, id]) : undefined)}
                  placeholder={t('heads.add')}
                  title={`${t('heads.pick')} · ${line}`}
                  allowNone={false}
                />

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {members ? `${t('heads.members', { n: members })} · ` : ''}
                  {t('heads.autoGrant')}
                </p>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** ── ผู้ใช้งาน ─────────────────────────────────────────── */
function UsersTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { employees, isLoading } = useCoreData();
  const saveEmployee = useSaveEmployee();
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  // ทะเบียนมีเกือบสี่ร้อยคนแต่เปิดสิทธิ์ไว้ไม่ถึงหนึ่งในสาม
  // ถ้าไม่มีตัวกรองนี้ ผู้ดูแลจะหาว่าใครเข้าได้บ้างไม่เจอในกองรายชื่อ
  const [access, setAccess] = useState<'all' | 'yes' | 'no'>('all');
  const [role, setRole] = useState<Role | 'all'>('all');

  const rows = employees.filter((m) => {
    if (access === 'yes' && !m.can_login) return false;
    if (access === 'no' && m.can_login) return false;
    if (role !== 'all' && m.role !== role) return false;
    return `${m.emp_code} ${m.full_name} ${m.full_name_en ?? ''} ${m.department} ${m.vsm_line ?? ''}`
      .toLowerCase()
      .includes(term.toLowerCase());
  });

  const granted = employees.filter((m) => m.can_login).length;

  const quickToggle = async (m: Employee, patch: Partial<Employee>) => {
    await saveEmployee.mutateAsync({ id: m.id, ...patch });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('common.search')} />
        <Button variant="accent" onClick={() => (setEditing(null), setOpen(true))}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('admin.newUser')}</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex h-9 items-center rounded-md border bg-card p-0.5">
          {([
            ['all', t('admin.filterAll')],
            ['yes', t('admin.filterCanLogin')],
            ['no', t('admin.filterNoLogin')],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setAccess(value)}
              className={cn(
                'press focusable h-8 rounded-[4px] px-3 text-[12px] font-medium',
                access === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex h-9 items-center rounded-md border bg-card p-0.5">
          {([
            ['all', t('common.all')],
            ['qc', t('role.qc')],
            ['vsm', t('role.vsm')],
            ['viewer', t('role.viewer')],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRole(value)}
              className={cn(
                'press focusable h-8 rounded-[4px] px-2.5 text-[12px] font-medium',
                role === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="num text-[11px] text-muted-foreground">
          {t('admin.accessCount', { n: granted, total: employees.length })}
        </p>
      </div>

      {isLoading ? (
        <SkeletonList rows={5} />
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 200).map((m) => (
            <Card key={m.id} className="p-3">
              <div className="flex items-center gap-3">
                <Avatar name={personLabel(m, lang)} src={m.avatar_url} seed={m.id} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium">{personLabel(m, lang)}</span>
                    <Badge tone={m.role === 'qc' ? 'steel' : m.role === 'vsm' ? 'accent' : 'neutral'}>
                      {t(`role.${m.role}` as 'role.qc')}
                    </Badge>
                    {m.vsm_line ? <Badge tone="accent">{m.vsm_line}</Badge> : null}
                    {!m.is_active ? <Badge tone="bad">{t('common.inactive')}</Badge> : null}
                    {m.is_active && !m.can_login ? <Badge>{t('admin.noLoginBadge')}</Badge> : null}
                  </div>
                  <div className="num text-[11px] text-muted-foreground">
                    {m.emp_code} · {m.department}
                    {m.position ? ` · ${m.position}` : ''}
                  </div>
                </div>
                <Button variant="ghost" size="iconSm" onClick={() => (setEditing(m), setOpen(true))}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 grid gap-2 border-t pt-2 sm:grid-cols-3 sm:gap-3">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium">{t('admin.loginAccess')}</span>
                  <Switch checked={m.can_login} onCheckedChange={(v) => quickToggle(m, { can_login: v })} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[12px]">{t('admin.activeUser')}</span>
                  <Switch checked={m.is_active} onCheckedChange={(v) => quickToggle(m, { is_active: v })} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-[12px]">{t('admin.dashboardAccess')}</span>
                  <Switch
                    checked={m.dashboard_enabled}
                    onCheckedChange={(v) => quickToggle(m, { dashboard_enabled: v })}
                  />
                </label>
              </div>
            </Card>
          ))}
          {rows.length > 200 ? (
            <p className="py-2 text-center text-[11px] text-muted-foreground">
              {rows.length} {t('common.items')} — {t('common.search')}
            </p>
          ) : null}
        </div>
      )}

      <UserDialog open={open} onOpenChange={setOpen} employee={editing} onSaved={() => toast(t('admin.settingsSaved'))} />
    </div>
  );
}

function UserDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee: Employee | null;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const saveEmployee = useSaveEmployee();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Partial<Employee>>({});

  useEffect(() => {
    setForm(
      employee ?? {
        emp_code: '',
        full_name: '',
        department: '',
        role: 'viewer',
        vsm_line: null,
        is_active: true,
        dashboard_enabled: true,
        // คนใหม่ยังล็อกอินไม่ได้จนกว่าจะเปิดสิทธิ์ให้ — ต้องเป็นการตัดสินใจที่ตั้งใจ
        can_login: false,
      },
    );
  }, [employee, open]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    const key = await savePhoto(file);
    setForm((f) => ({ ...f, avatar_url: key }));
  };

  const submit = async () => {
    // บทบาท VSM ที่ไม่ผูกสาย จะไม่มีงานเข้ากล่องเลย — กันไว้ตั้งแต่ตอนบันทึก
    if (form.role === 'vsm' && !form.vsm_line) return;
    await saveEmployee.mutateAsync({ ...form, id: employee?.id });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={employee ? t('common.edit') : t('admin.newUser')}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={submit}
              disabled={saveEmployee.isPending || (form.role === 'vsm' && !form.vsm_line)}
            >
              {saveEmployee.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="flex items-center gap-3">
            <Avatar
              name={personLabel(form as Employee, lang) || '—'}
              src={form.avatar_url}
              seed={form.emp_code ?? 'new'}
              size={52}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickAvatar(e.target.files?.[0])}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" />
              {t('admin.photoUpload')}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('auth.empCode')} required>
              <Input
                className="num"
                value={form.emp_code ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, emp_code: e.target.value }))}
              />
            </Field>
            <Field label={t('common.department')}>
              <Input
                value={form.department ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              />
            </Field>
          </div>

          <Field label={t('admin.nameTh')} required>
            <Input
              value={form.full_name ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </Field>
          <Field label={t('admin.nameEn')} hint={t('common.optional')}>
            <Input
              value={form.full_name_en ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, full_name_en: e.target.value }))}
            />
          </Field>
          <Field label={t('common.position')} hint={t('common.optional')}>
            <Input
              value={form.position ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            />
          </Field>

          <Field label={t('admin.roleField')} hint={t('admin.roleHint')} required>
            <Select
              value={form.role ?? 'viewer'}
              onChange={(e) => {
                const role = e.target.value as Role;
                // เปลี่ยนออกจาก VSM แล้วต้องล้างสายทิ้ง ไม่งั้นค่าเก่าค้างอยู่โดยไม่มีความหมาย
                setForm((f) => ({ ...f, role, vsm_line: role === 'vsm' ? f.vsm_line : null }));
              }}
            >
              <option value="qc">{t('role.qc')}</option>
              <option value="vsm">{t('role.vsm')}</option>
              <option value="viewer">{t('role.viewer')}</option>
            </Select>
          </Field>

          {form.role === 'vsm' ? (
            <Field label={t('admin.vsmField')} hint={t('admin.vsmHint')} required>
              <VsmPicker
                value={(form.vsm_line as VsmLine | null) ?? null}
                onChange={(v) => setForm((f) => ({ ...f, vsm_line: v }))}
              />
            </Field>
          ) : null}

          <div className="space-y-1.5 rounded-md border p-3">
            <label className="flex items-center justify-between gap-2 py-1">
              <span className="text-[13px] font-medium">{t('admin.loginAccess')}</span>
              <Switch
                checked={form.can_login ?? false}
                onCheckedChange={(v) => setForm((f) => ({ ...f, can_login: v }))}
              />
            </label>
            <label className="flex items-center justify-between gap-2 py-1">
              <span className="text-[13px]">{t('admin.activeUser')}</span>
              <Switch
                checked={form.is_active ?? true}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
            </label>
            <label className="flex items-center justify-between gap-2 py-1">
              <span className="text-[13px]">{t('admin.dashboardAccess')}</span>
              <Switch
                checked={form.dashboard_enabled ?? true}
                onCheckedChange={(v) => setForm((f) => ({ ...f, dashboard_enabled: v }))}
              />
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** ── จุดตรวจ ───────────────────────────────────────────── */
function AreasTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { areas, tree, isLoading } = useCoreData();
  const saveArea = useSaveArea();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Area | null>(null);
  const [form, setForm] = useState<Partial<Area>>({});

  useEffect(() => {
    setForm(editing ?? { area_name: '', area_name_en: '', parent_id: null, vsm_line: null, is_active: true });
  }, [editing, open]);

  const submit = async () => {
    await saveArea.mutateAsync({ ...form, id: editing?.id });
    toast(t('admin.settingsSaved'));
    setOpen(false);
  };

  /** พื้นที่เป็นแม่ของตัวเองหรือลูกหลานตัวเองไม่ได้ — ไม่งั้นต้นไม้จะวนไม่จบ */
  const forbidden = editing ? new Set(descendantIds(areas, editing.id)) : new Set<string>();

  const flatRows = tree.flatMap(function walk(node): { area: Area; depth: number }[] {
    return [{ area: node, depth: node.depth }, ...node.children.flatMap(walk)];
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="accent" onClick={() => (setEditing(null), setOpen(true))}>
          <Plus className="h-4 w-4" />
          {t('admin.newArea')}
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={5} />
      ) : (
        <div className="space-y-1.5">
          {flatRows.map(({ area, depth }) => (
            <Card key={area.id} className="p-2.5">
              <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                <MapPin className={cn('h-4 w-4 shrink-0', depth === 0 ? 'text-accent' : 'text-muted-foreground')} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{areaLabel(area, lang)}</div>
                  {area.area_name_en ? (
                    <div className="num truncate text-[10px] text-muted-foreground">{area.area_name_en}</div>
                  ) : null}
                </div>
                {area.vsm_line ? <Badge tone="accent">{area.vsm_line}</Badge> : null}
                {!area.is_active ? <Badge tone="bad">{t('common.inactive')}</Badge> : null}
                <Button variant="ghost" size="iconSm" onClick={() => (setEditing(area), setOpen(true))}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={editing ? t('common.edit') : t('admin.newArea')}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="accent" onClick={submit} disabled={saveArea.isPending}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label={t('admin.nameTh')} required>
              <Input
                value={form.area_name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, area_name: e.target.value }))}
              />
            </Field>
            <Field label={t('admin.nameEn')} hint={t('common.optional')}>
              <Input
                value={form.area_name_en ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, area_name_en: e.target.value }))}
              />
            </Field>
            <Field label={t('admin.parentArea')}>
              <Select
                value={form.parent_id ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value || null }))}
              >
                <option value="">{t('admin.parentNone')}</option>
                {areas
                  .filter((a) => !forbidden.has(a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {areaLabel(a, lang)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('admin.areaVsm')} hint={t('admin.areaVsmHint')}>
              <div className="space-y-1.5">
                <VsmPicker
                  value={(form.vsm_line as VsmLine | null) ?? null}
                  onChange={(v) => setForm((f) => ({ ...f, vsm_line: v }))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setForm((f) => ({ ...f, vsm_line: null }))}
                >
                  {t('admin.vsmNone')}
                </Button>
              </div>
            </Field>
            <div className="rounded-md border p-3">
              <label className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{t('common.active')}</span>
                <Switch
                  checked={form.is_active ?? true}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                />
              </label>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** ── ประเภทข้อบกพร่อง ──────────────────────────────────── */
function CategoriesTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { categories, issues, isLoading } = useCoreData();
  const saveCategory = useSaveCategory();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DefectCategory | null>(null);
  const [form, setForm] = useState<Partial<DefectCategory>>({});

  useEffect(() => {
    setForm(editing ?? { category_name: '', category_name_en: '', is_active: true });
  }, [editing, open]);

  const submit = async () => {
    await saveCategory.mutateAsync({ ...form, id: editing?.id });
    toast(t('admin.settingsSaved'));
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="accent" onClick={() => (setEditing(null), setOpen(true))}>
          <Plus className="h-4 w-4" />
          {t('admin.newCategory')}
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={5} />
      ) : (
        <div className="space-y-1.5">
          {categories.map((c) => {
            const used = issues.filter((i) => i.category_ids.includes(c.id)).length;
            return (
              <Card key={c.id} className="p-3">
                <div className="flex items-center gap-2.5">
                  <Layers className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{categoryLabel(c, lang)}</div>
                    {c.category_name_en ? (
                      <div className="truncate text-[10px] text-muted-foreground">{c.category_name_en}</div>
                    ) : null}
                  </div>
                  {used ? <span className="num text-[11px] text-muted-foreground">{used}</span> : null}
                  {!c.is_active ? <Badge tone="bad">{t('common.inactive')}</Badge> : null}
                  <Button variant="ghost" size="iconSm" onClick={() => (setEditing(c), setOpen(true))}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={editing ? t('common.edit') : t('admin.newCategory')}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="accent" onClick={submit} disabled={saveCategory.isPending}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label={t('admin.nameTh')} required>
              <Input
                value={form.category_name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, category_name: e.target.value }))}
              />
            </Field>
            <Field label={t('admin.nameEn')} hint={t('common.optional')}>
              <Input
                value={form.category_name_en ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, category_name_en: e.target.value }))}
              />
            </Field>
            <div className="rounded-md border p-3">
              <label className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{t('common.active')}</span>
                <Switch
                  checked={form.is_active ?? true}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                />
              </label>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** ── ระบบ ─────────────────────────────────────────────── */
function SystemTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const [form, setForm] = useState(settings);

  useEffect(() => setForm(settings), [settings]);

  const save = async () => {
    if (!form) return;
    await saveSettings.mutateAsync(form);
    toast(t('admin.settingsSaved'));
  };

  const doExport = async () => {
    downloadJson(`qc-backup-${todayISO()}.json`, await exportDb());
  };

  const doReset = async () => {
    if (!confirm(t('admin.resetConfirm'))) return;
    await resetDb();
    location.reload();
  };

  const doClear = async () => {
    if (!confirm(t('admin.clearTxConfirm'))) return;
    await clearTransactions();
    location.reload();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('admin.tabSystem')} />
        <CardBody className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.company')}>
              <Input
                value={form?.company_name ?? ''}
                onChange={(e) => setForm((f) => f && { ...f, company_name: e.target.value })}
              />
            </Field>
            <Field label={t('admin.plant')}>
              <Input
                value={form?.plant_name ?? ''}
                onChange={(e) => setForm((f) => f && { ...f, plant_name: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('admin.dueCritical')}>
              <Input
                type="number"
                min={0}
                className="num"
                value={form?.due_days_critical ?? 1}
                onChange={(e) => setForm((f) => f && { ...f, due_days_critical: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('admin.dueMajor')}>
              <Input
                type="number"
                min={0}
                className="num"
                value={form?.due_days_major ?? 3}
                onChange={(e) => setForm((f) => f && { ...f, due_days_major: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('admin.dueMinor')}>
              <Input
                type="number"
                min={0}
                className="num"
                value={form?.due_days_minor ?? 7}
                onChange={(e) => setForm((f) => f && { ...f, due_days_minor: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('admin.targetOnTime')}>
              <Input
                type="number"
                min={0}
                max={100}
                className="num"
                value={form?.target_ontime_pct ?? 90}
                onChange={(e) => setForm((f) => f && { ...f, target_ontime_pct: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Button variant="accent" onClick={save}>
            {t('common.save')}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('admin.dataTools')} hint="ข้อมูลถูกเก็บในเครื่องนี้ (localStorage + IndexedDB)" />
        <CardBody className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={doExport}>
            <Download className="h-4 w-4" />
            {t('admin.exportJson')}
          </Button>
          <Button variant="outline" onClick={doClear}>
            <Trash2 className="h-4 w-4" />
            {t('admin.clearTx')}
          </Button>
          <Button variant="outline" onClick={doReset}>
            <RefreshCw className="h-4 w-4" />
            {t('admin.resetDemo')}
          </Button>
        </CardBody>
      </Card>

    </div>
  );
}

/** ── บันทึกระบบ ───────────────────────────────────────────
 *
 * ประวัติการแก้ไขเคยดูได้เฉพาะในใบแจ้งทีละใบ ซึ่งตอบได้แค่ "ใบนี้ถูกแก้อะไรบ้าง"
 * แต่ตอบไม่ได้ว่า "เมื่อวานใครไปแก้อะไรไว้บ้าง" ซึ่งเป็นคำถามที่ผู้ดูแลถามจริง
 * หน้านี้รวมทั้งระบบไว้ที่เดียว พร้อมตัวกรองตามตารางและช่องค้นหา
 *
 * ข้อมูลมาจากเซิร์ฟเวอร์ (ดู pull() ใน src/lib/sync.ts) จึงเห็นการแก้ไขของทุกคน
 * ไม่ใช่แค่ของเครื่องตัวเอง — ในโหมดในเครื่องจะเห็นเฉพาะที่ทำบนเครื่องนี้
 */
const AUDIT_PAGE = 60;

function AuditTab() {
  const { t, lang } = useI18n();
  const { data: changes = [], isLoading } = useChangeHistory();
  const { data: logins = [] } = useLoginHistory();
  const [term, setTerm] = useState('');
  const [table, setTable] = useState<string>('all');
  const [limit, setLimit] = useState(AUDIT_PAGE);

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    return changes
      .filter((c) => (table === 'all' ? true : c.table_name === table))
      .filter((c) =>
        q
          ? `${c.changed_by} ${c.record_id} ${fieldLabel(c.field, lang)} ${c.field ?? ''} ${c.old_value ?? ''} ${c.new_value ?? ''}`
              .toLowerCase()
              .includes(q)
          : true,
      );
  }, [changes, table, term, lang]);

  // เปลี่ยนตัวกรองแล้วต้องเริ่มนับหน้าใหม่ ไม่งั้นผลลัพธ์ชุดใหม่จะถูกตัดด้วยเพดานเก่า
  useEffect(() => setLimit(AUDIT_PAGE), [term, table]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('admin.changeHistory')}
          hint={t('admin.changeHistoryHint')}
          right={<History className="h-4 w-4 text-muted-foreground" />}
        />
        <CardBody className="space-y-3">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('common.search')} />

          <div className="scroll-x no-scrollbar -mx-1 flex gap-1.5 px-1 pb-1">
            <FilterChip active={table === 'all'} onClick={() => setTable('all')}>
              {t('admin.auditFilterAll')}
            </FilterChip>
            {AUDIT_TABLES.map((name) => (
              <FilterChip key={name} active={table === name} onClick={() => setTable(name)}>
                {tableLabel(name, lang)}
              </FilterChip>
            ))}
          </div>

          <p className="num text-right text-[11px] text-muted-foreground">
            {t('admin.auditCount', { n: rows.length })}
          </p>

          {isLoading ? (
            <SkeletonList rows={5} />
          ) : rows.length ? (
            <div className="space-y-1">
              {rows.slice(0, limit).map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
              {rows.length > limit ? (
                <Button variant="outline" className="w-full" onClick={() => setLimit((n) => n + AUDIT_PAGE)}>
                  {t('admin.auditShowMore')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="py-3 text-center text-[12px] text-muted-foreground">{t('common.noData')}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('admin.loginHistory')}
          hint={t('admin.loginHistoryHint')}
          right={<Database className="h-4 w-4 text-muted-foreground" />}
        />
        <CardBody className="space-y-1">
          {logins.slice(0, 30).map((l) => (
            <div key={l.id} className="flex items-center gap-2 border-b py-1.5 last:border-0">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{l.actor_name}</span>
              <Badge tone={l.result === 'success' ? 'ok' : 'bad'}>{l.role}</Badge>
              <span className="num text-[10px] text-muted-foreground">
                {new Date(l.at).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok' })}
              </span>
            </div>
          ))}
          {!logins.length ? (
            <p className="py-3 text-center text-[12px] text-muted-foreground">{t('common.noData')}</p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

/** หนึ่งบรรทัดของประวัติการแก้ไข — ใบแจ้งกดเข้าไปดูของจริงได้เลย */
function ChangeRow({ change: c }: { change: ChangeHistory }) {
  const { t, lang } = useI18n();
  const when = new Date(c.changed_at).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok',
  });

  const title =
    c.action_type === 'create'
      ? `${t('admin.auditCreated')} ${c.new_value ?? ''}`.trim()
      : c.action_type === 'delete'
        ? `${t('admin.auditDeleted')} ${c.old_value ?? ''}`.trim()
        : fieldLabel(c.field, lang);

  return (
    <div className="border-b py-1.5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Badge tone="neutral">{tableLabel(c.table_name, lang)}</Badge>
        <span className="text-[12px] font-medium">{title}</span>
        {c.action_type === 'update' ? (
          <span className="num min-w-0 text-[11px] text-muted-foreground">
            <span className="line-through">{c.old_value ?? '—'}</span> → {c.new_value ?? '—'}
          </span>
        ) : null}
        <span className="num ml-auto shrink-0 text-[10px] text-muted-foreground">
          {c.changed_by} · {when}
        </span>
      </div>
      {c.table_name === 'qc_issues' ? (
        <Link
          to={`/issues/${c.record_id}`}
          className="num focusable text-[10px] text-accent hover:underline"
        >
          {t('admin.auditOpenIssue')} · {c.record_id}
        </Link>
      ) : (
        <span className="num text-[10px] text-muted-foreground">
          {t('admin.auditRecord')} {c.record_id}
        </span>
      )}
    </div>
  );
}

/** สำรองข้อมูลเป็น JSON — ใช้ตัวช่วยเดียวกับ CSV แต่ไม่ต้องใส่ BOM */
function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
