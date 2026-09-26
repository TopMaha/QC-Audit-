import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useCoreData, useSession } from '@/hooks/useData';
import { issuesInRange } from '@/lib/calc';
import { useI18n } from '@/lib/i18n';

/**
 * ปุ่มส่งออก Excel ของช่วงวันที่ที่เลือก — สรุปราย VSM พร้อมรูป BEFORE / AFTER
 * ตัวสร้างไฟล์อยู่ใน src/lib/excel.ts และถูกโหลดเมื่อกดครั้งแรกเท่านั้น
 * การโหลดรูปจาก R2 ใช้เวลาจึงบอกความคืบหน้าบนปุ่ม ไม่ให้ผู้ใช้กดซ้ำ
 */
export function ExcelExportButton({
  from,
  to,
  size = 'md',
  className,
}: {
  from: string;
  to: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { session, admin } = useSession();
  const { issues, fixes, employees, categories, pathOf } = useCoreData();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async () => {
    if (!issuesInRange(issues, from, to).length) {
      toast(t('xls.empty'));
      return;
    }
    setBusy(t('xls.preparing'));
    try {
      const { exportExcel } = await import('@/lib/excel');
      await exportExcel({
        from,
        to,
        lang,
        t,
        issues,
        fixes,
        employees,
        categories,
        pathOf,
        exportedBy: session?.full_name ?? (admin ? t('role.admin') : ''),
        onProgress: setBusy,
      });
      toast(t('xls.done'));
    } catch (e) {
      console.error('excel export failed', e);
      toast(t('xls.failed', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Button variant="accent" size={size} className={className} onClick={run} disabled={busy !== null} title={t('xls.hint')}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
      <span className="truncate">{busy ?? t('xls.button')}</span>
    </Button>
  );
}
