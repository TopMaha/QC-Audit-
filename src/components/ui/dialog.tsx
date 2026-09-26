import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * มือถือ: เลื่อนขึ้นจากด้านล่างเต็มความกว้าง (sheet)
 * จอกว้างตั้งแต่ 640px: กล่องกลางจอ ไม่เกิน 94% ของความกว้างและ 88% ของความสูงจอ
 *
 * ⚠️ ห้ามจัดกึ่งกลางด้วย translate บนตัวกล่อง — แอนิเมชันตอนเปิดจบที่ transform: none
 * แล้วค้างไว้ (fill-mode both) ทับ translate จนมุมซ้ายบนของกล่องไปอยู่กลางจอ กล่องล้นขวา/ล่าง
 * จึงใช้กรอบ flex เต็มจอที่กดทะลุได้ (pointer-events-none) เป็นตัวจัดวางแทน
 * กล่องปรับตามขนาดหน้าต่างเองทุกครั้งที่ผู้ใช้ย่อ/ขยายจอ เพราะเป็น CSS ล้วน
 */
export function DialogContent({
  children,
  className,
  title,
  description,
  footer,
  size = 'md',
}: {
  children: ReactNode;
  className?: string;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  const { t } = useI18n();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      {/* คลิกนอกกล่องทะลุกรอบนี้ไปโดนฉากหลัง Radix จึงยังปิดกล่องให้ตามปกติ */}
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <DialogPrimitive.Content
          className={cn(
            'pointer-events-auto relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border bg-card shadow-lift',
            'data-[state=open]:animate-slide-in',
            'sm:max-h-[88dvh] sm:w-[min(94vw,var(--dw))] sm:rounded-xl',
            size === 'lg' ? '[--dw:900px]' : '[--dw:560px]',
            className,
          )}
        >
          <div className="brand-bar h-[3px] shrink-0 rounded-t-xl opacity-90" />
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-base font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {/* ปุ่มไอคอนต้องมีชื่อให้โปรแกรมอ่านหน้าจอ และพื้นที่แตะอย่างน้อย 44px สำหรับนิ้วที่ใส่ถุงมือ */}
            <DialogPrimitive.Close
              aria-label={t('common.close')}
              className="press focusable -mr-2 -mt-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
          {footer ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/40 px-4 py-3 pb-safe">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}
