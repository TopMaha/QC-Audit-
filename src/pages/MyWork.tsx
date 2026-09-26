import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, Inbox, Info } from 'lucide-react';
import { PageTitle } from '@/components/AppShell';
import { IssueCard } from '@/components/IssueCard';
import { PushCard } from '@/components/PushCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, StatBlock } from '@/components/ui/card';
import { EmptyState, SectionTitle, SkeletonList } from '@/components/ui/misc';
import { useCoreData, useInbox, useMyLines, useSession } from '@/hooks/useData';
import { isOverdue, myOpenIssues, sortByUrgency, summarize } from '@/lib/calc';
import { useI18n } from '@/lib/i18n';

/**
 * งานของฉัน — หน้าแรกหลังเข้าสู่ระบบ
 *
 * เนื้อหาเปลี่ยนตามบทบาท เพราะสองฝั่งมองระบบคนละมุมโดยสิ้นเชิง
 *   VSM  ต้องการรู้ว่า "ฉันต้องแก้อะไรก่อน"
 *   QC   ต้องการรู้ว่า "มีอะไรรอฉันตรวจรับ และของที่ฉันแจ้งไปถึงไหนแล้ว"
 * ถ้ายัดทั้งสองมุมไว้ในหน้าเดียวกันแบบเดียว ทั้งคู่จะต้องกวาดตาข้ามของที่ไม่เกี่ยวกับตัวเอง
 */
export default function MyWork() {
  const { t } = useI18n();
  const { session, admin, canInspect } = useSession();
  const { issues, employees, categories, pathOf, fixes, isLoading } = useCoreData();
  const inbox = useInbox();
  // สายที่ต้องลงมือแก้ — VSM ของสายนั้น หรือคนที่ผู้ดูแลระบบตั้งเป็นหัวหน้าสาย (บทบาทอะไรก็ได้)
  const myLines = useMyLines();

  const role = session?.role ?? (admin ? 'qc' : 'viewer');
  const fixesWork = myLines.length > 0;
  const mine = session ? sortByUrgency(myOpenIssues(issues, session.employee_id)) : [];
  const stats = summarize(issues, fixes);

  const subtitle =
    fixesWork
      ? t('mywork.vsmSubtitle', { vsm: myLines.join(' · ') })
      : role === 'qc'
        ? t('mywork.qcSubtitle')
        : t('mywork.viewerSubtitle');

  if (isLoading) return <SkeletonList rows={5} />;

  // VSM ที่ยังไม่ถูกผูกสาย จะไม่มีทางเห็นงานเข้าเลย — ต้องบอกให้รู้ว่าติดตรงไหน
  // ไม่ใช่ปล่อยให้เห็นหน้าว่างแล้วเข้าใจว่าไม่มีงาน
  if (role === 'vsm' && !fixesWork) {
    return (
      <div>
        <PageTitle title={t('mywork.title')} />
        <EmptyState icon={<Info className="h-8 w-8" />} title={t('mywork.noLine')} hint={t('mywork.noLineHint')} />
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title={t('mywork.title')}
        subtitle={subtitle}
        right={
          canInspect ? (
            <Button variant="accent" size="sm" asChild>
              <Link to="/inspect">
                <ClipboardCheck className="h-4 w-4" />
                <span className="hidden sm:inline">{t('mywork.startInspect')}</span>
              </Link>
            </Button>
          ) : null
        }
      />

      {/* คนที่มีงานเข้าต้องรู้ทันทีแม้ไม่ได้เปิดแอป — ชวนเปิดการแจ้งเตือนแบบเด้ง */}
      {session && (fixesWork || role === 'qc') ? <PushCard audience={fixesWork ? 'line' : 'qc'} /> : null}

      {/* ตัวเลขสามตัวที่ตอบว่า "สถานการณ์ตอนนี้เป็นยังไง" ในหนึ่งสายตา */}
      <div className="stagger mb-4 grid grid-cols-3 gap-2">
        <StatBlock label={t('dash.openIssues')} value={stats.active} tone={stats.active ? 'warn' : 'ok'} />
        <StatBlock label={t('dash.overdue')} value={stats.overdue} tone={stats.overdue ? 'bad' : 'ok'} />
        <StatBlock label={t('dash.onTime')} value={stats.onTimePct} unit="%" tone={stats.onTimePct >= 80 ? 'ok' : 'warn'} />
      </div>

      <div className="space-y-5">
        <section>
          <SectionTitle
            right={
              inbox.length ? (
                <Badge tone={inbox.some((i) => isOverdue(i)) ? 'bad' : 'accent'} size="md">
                  {inbox.length}
                </Badge>
              ) : null
            }
          >
            {fixesWork ? t('mywork.toFix') : t('mywork.toVerify')}
          </SectionTitle>

          {inbox.length ? (
            <div className="space-y-2">
              {inbox.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  employees={employees}
                  categories={categories}
                  pathOf={pathOf}
                  showQc={!fixesWork}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardBody className="flex items-center gap-3 py-6">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-ok" />
                <div>
                  <p className="text-[14px] font-medium">{t('mywork.allClear')}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{t('mywork.allClearHint')}</p>
                </div>
              </CardBody>
            </Card>
          )}
        </section>

        {/* คนที่เปิดใบแจ้งได้ต้องตามงานที่ตัวเองแจ้งไว้ด้วย ไม่ใช่แจ้งแล้วจบ */}
        {canInspect && mine.length ? (
          <section>
            <SectionTitle right={<Badge size="md">{mine.length}</Badge>}>{t('mywork.myOpen')}</SectionTitle>
            <div className="space-y-2">
              {mine.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  employees={employees}
                  categories={categories}
                  pathOf={pathOf}
                  showQc={false}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ผู้ดูแลระบบที่แผนกไม่ใช่ QC บทบาทเป็น viewer แต่บันทึกได้ ไม่ใช่ "ดูอย่างเดียว" */}
        {role === 'viewer' && !canInspect && !fixesWork ? (
          <EmptyState icon={<Inbox className="h-8 w-8" />} title={t('mywork.viewerSubtitle')} />
        ) : null}
      </div>
    </div>
  );
}
