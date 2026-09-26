import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { deletePhoto, photoUrl, savePhoto } from '@/lib/photos';
import { cn } from '@/lib/utils';

/** แปลงคีย์รูปเป็น URL ที่แสดงผลได้ */
export function usePhotoUrls(keys: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const signature = keys.join('|');

  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(keys.map(async (k) => [k, (await photoUrl(k)) ?? ''] as const));
      if (alive) setUrls(Object.fromEntries(entries.filter(([, v]) => v)));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return urls;
}

export function PhotoGrid({ keys, className }: { keys: string[]; className?: string }) {
  const { t } = useI18n();
  const urls = usePhotoUrls(keys);
  const [zoom, setZoom] = useState<string | null>(null);

  if (!keys.length) return null;

  return (
    <>
      <div className={cn('grid grid-cols-3 gap-2 sm:grid-cols-4', className)}>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => urls[k] && setZoom(urls[k])}
            aria-label={t('photo.zoom')}
            className="press focusable aspect-square overflow-hidden rounded-md border bg-muted"
          >
            {urls[k] ? (
              <img src={urls[k]} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <span className="grid h-full w-full place-items-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
          </button>
        ))}
      </div>
      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        {zoom ? (
          <DialogContent title={t('photo.zoom')} size="lg">
            <img src={zoom} alt="" className="mx-auto max-h-[70dvh] rounded-md object-contain" />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function PhotoUploader({
  value,
  onChange,
  max = 6,
  hint,
}: {
  value: string[];
  onChange: (keys: string[]) => void;
  max?: number;
  /** ข้อความอธิบายเฉพาะบริบท เช่น "ถ่ายจุดเดิมหลังแก้ไข" — ไม่ส่งมาจะใช้คำอธิบายกลาง */
  hint?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const urls = usePhotoUrls(value);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const room = max - value.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      const keys = await Promise.all(picked.map((f) => savePhoto(f)));
      onChange([...value, ...keys]);
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const remove = async (key: string) => {
    onChange(value.filter((k) => k !== key));
    await deletePhoto(key);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || value.length >= max}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
          {t('photo.camera')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || value.length >= max}
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" />
          {t('photo.gallery')}
        </Button>
        {busy ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('photo.compressing')}
          </span>
        ) : (
          <span className="num self-center text-[11px] text-muted-foreground">
            {value.length}/{max}
          </span>
        )}
      </div>

      {value.length ? (
        <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {value.map((k) => (
            <div key={k} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
              {urls[k] ? (
                <img src={urls[k]} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(k)}
                className="press absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/65 text-white"
                aria-label={t('common.delete')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-1.5 text-[11px] text-muted-foreground">{hint ?? t('photo.hint')}</p>
    </div>
  );
}
