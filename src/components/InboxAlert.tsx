import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, ChevronRight, Cog } from 'lucide-react';
import { usePhotoUrls } from '@/components/PhotoUploader';
import { StatusBadge, VsmBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useFixes, useInbox, useIssues, useLineHeads, useSession } from '@/hooks/useData';
import { displayStatus } from '@/lib/calc';
import { useI18n } from '@/lib/i18n';
import { showLocalNotification } from '@/lib/push';
import type { IssueStatus, QcIssue } from '@/lib/types';

/**
 * "เด้ง" งานใหม่ขึ้นมาตรงหน้าทันทีที่เข้ากล่องงานของผู้ใช้
 *   ปัญหาใหม่จาก QC   → หัวหน้าสาย/VSM ของสายนั้น
 *   QC ตีกลับ          → หัวหน้าสาย/VSM ของสายนั้น
 *   แก้ไขเสร็จแล้ว      → QC ที่ต้องตรวจรับ
 *
 * ทำงานคู่กับการแจ้งเตือนแบบเด้งจาก Worker (Web Push) — อันนั้นเด้งตอนปิดแอป
 * อันนี้เด้งตอนเปิดแอปอยู่ ซึ่งใช้ได้ทุกเครื่องแม้ไม่ได้กดเปิดการแจ้งเตือน
 *
 * จำว่าเห็นอะไรไปแล้วไว้ในเครื่อง (แยกตามคน) ไม่งั้นทุกครั้งที่เปิดแอปจะเด้งของเดิมซ้ำ
 * คีย์รวมสถานะและจำนวนครั้งที่ส่งงานแก้ไข ใบที่ถูกตีกลับรอบที่ 2 จึงเด้งใหม่ได้
 */

/** สถานะที่นับว่า "มีงานมาถึงคุณ" — สถานะอื่นในกล่องงานคือของที่คุณลงมือไปแล้ว */
const ARRIVALS: IssueStatus[] = ['open', 'rejected', 'fixed'];
const MAX_REMEMBERED = 500;

function storeKey(employeeId: string) {
  return `qc.seen.${employeeId}`;
}

function readSeen(employeeId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(storeKey(employeeId));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(employeeId: string, seen: Set<string>) {
  try {
    localStorage.setItem(storeKey(employeeId), JSON.stringify([...seen].slice(-MAX_REMEMBERED)));
  } catch {
    // พื้นที่เต็มหรือถูกปิด — ผลแค่อาจเด้งซ้ำ ไม่ใช่เรื่องใหญ่
  }
}

export function InboxAlert() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { session } = useSession();
  const inbox = useInbox();
  const issues = useIssues();
  const heads = useLineHeads();
  const { data: fixes = [] } = useFixes();
  const [shown, setShown] = useState<QcIssue[]>([]);

  const keyOf = useMemo(() => {
    const count = new Map<string, number>();
    fixes.forEach((f) => count.set(f.issue_id, (count.get(f.issue_id) ?? 0) + 1));
    return (i: QcIssue) => `${i.id}:${i.status}:${count.get(i.id) ?? 0}`;
  }, [fixes]);

  useEffect(() => {
    // รอข้อมูลในเครื่องโหลดครบก่อน ไม่งั้นกล่องงานว่างชั่วคราวจะทำให้ทุกใบดูเหมือนของใหม่
    if (!session || !issues.isSuccess || !heads.isSuccess) return;
    const me = session.employee_id;
    const arrivals = inbox.filter((i) => ARRIVALS.includes(i.status));

    const seen = readSeen(me);
    // เข้าระบบบนเครื่องนี้ครั้งแรก — งานค้างเดิมดูได้ที่หน้างานของฉันอยู่แล้ว ไม่ต้องเด้ง
    if (!seen) {
      writeSeen(me, new Set(arrivals.map(keyOf)));
      return;
    }

    const fresh = arrivals.filter((i) => !seen.has(keyOf(i)));
    if (!fresh.length) return;

    fresh.forEach((i) => seen.add(keyOf(i)));
    writeSeen(me, seen);
    setShown((prev) => [...fresh, ...prev.filter((p) => !fresh.some((f) => f.id === p.id))]);

    navigator.vibrate?.([200, 100, 200]);
    // แอปเปิดค้างไว้เบื้องหลัง — เด้งเป็นการแจ้งเตือนของระบบด้วย (tag เดียวกับของ Worker จึงไม่ซ้ำ)
    if (document.visibilityState === 'hidden') {
      for (const i of fresh.slice(0, 3)) {
        void showLocalNotification(
          titleFor(i, t),
          `${i.issue_no} · ${t('alert.machine', { m: i.machine_no || '-' })}\n${i.description}`,
          `/issues/${i.id}`,
          i.id,
        );
      }
    }
  }, [inbox, session, issues.isSuccess, heads.isSuccess, keyOf, t]);

  // เปลี่ยนคนล็อกอิน — ล้างกล่องที่ค้างของคนเดิม
  useEffect(() => setShown([]), [session?.employee_id]);

  const open = shown.length > 0;
  const first = shown[0];
  const close = () => setShown([]);

  const go = (path: string) => {
    close();
    navigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {first ? (
        <DialogContent
          title={shown.length > 1 ? t('alert.newIssues', { n: shown.length }) : titleFor(first, t)}
          footer={
            <>
              <Button variant="outline" onClick={close}>
                {t('alert.later')}
              </Button>
              <Button
                variant="accent"
                onClick={() => go(shown.length > 1 ? '/mywork' : `/issues/${first.id}`)}
              >
                <BellRing className="h-4 w-4" />
                {t('alert.view')}
              </Button>
            </>
          }
        >
          <ul className="space-y-2" aria-live="polite">
            {shown.slice(0, 4).map((i) => (
              <AlertRow key={i.id} issue={i} onOpen={() => go(`/issues/${i.id}`)} />
            ))}
          </ul>
          {shown.length > 4 ? (
            <p className="mt-2 text-center text-[12px] text-muted-foreground">+{shown.length - 4}</p>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function titleFor(i: QcIssue, t: ReturnType<typeof useI18n>['t']): string {
  if (i.status === 'fixed') return t('alert.fixed');
  if (i.status === 'rejected') return t('alert.rejected');
  return t('alert.newIssue');
}

function AlertRow({ issue, onOpen }: { issue: QcIssue; onOpen: () => void }) {
  const { t } = useI18n();
  const urls = usePhotoUrls(issue.photo_urls.slice(0, 1));
  const cover = urls[issue.photo_urls[0]];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="press focusable flex w-full items-start gap-3 rounded-md border bg-card p-2.5 text-left hover:bg-muted"
      >
        <span className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
          {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="num text-[12px] font-semibold">{issue.issue_no}</span>
            <VsmBadge line={issue.vsm_line} />
            <StatusBadge status={displayStatus(issue)} />
          </span>
          <span className="num mt-1 flex items-center gap-1 text-[12px] font-medium">
            <Cog className="h-3.5 w-3.5 text-muted-foreground" />
            {t('alert.machine', { m: issue.machine_no || '-' })}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {issue.description}
          </span>
        </span>
        <ChevronRight className="mt-5 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
