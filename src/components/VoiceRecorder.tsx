import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { deletePhoto, photoUrl, saveAudio } from '@/lib/photos';
import { cn } from '@/lib/utils';

/**
 * บันทึกเสียงบรรยายข้อบกพร่อง
 *
 * หน้าไลน์คนใส่ถุงมือ มือเปื้อน และมักถือของอยู่อีกข้าง การพิมพ์บนมือถือจึงช้ามาก
 * ปุ่มเดียวแล้วพูดใส่เร็วกว่าและได้รายละเอียดมากกว่า (น้ำเสียงบอกความเร่งด่วนด้วย)
 *
 * เก็บไฟล์ลงคลังเดียวกับรูป (src/lib/photos.ts) คีย์จึงขึ้นต้นด้วย local: เหมือนกัน
 * ตัวซิงก์อัปโหลดขึ้น R2 ให้เองโดยไม่ต้องรู้ว่าเป็นเสียงหรือรูป
 *
 * ⚠️ เสียงเป็นของแถมของใบแจ้ง ไม่ใช่ของบังคับ — ไมโครโฟนใช้ไม่ได้ก็ต้องบันทึกงานได้อยู่ดี
 * ทุกทางที่ล้มเหลวจึงจบด้วยข้อความบอกสาเหตุ ไม่ใช่ปุ่มที่กดแล้วเงียบ
 */

/** ชนิดไฟล์ที่ลองไล่จากคุณภาพต่อขนาดดีสุดลงมา — Safari รับเฉพาะ mp4 */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

/** อัดเสียงได้ไหม — ต้องมีทั้ง API และหน้าเว็บที่เปิดผ่าน https (หรือ localhost) */
function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VoiceRecorder({
  value,
  onChange,
  maxSeconds = 120,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  /** ตัดจบให้เองเมื่อถึงเวลานี้ กันการอัดค้างไว้ทั้งกะโดยไม่รู้ตัว */
  maxSeconds?: number;
}) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const supported = canRecord();

  /** เตรียม URL สำหรับเล่นเสียงที่แนบอยู่ (ของในเครื่องหรือของบน R2 ก็ได้) */
  useEffect(() => {
    let alive = true;
    if (!value) {
      setUrl(null);
      return;
    }
    void photoUrl(value).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [value]);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  /** ปิดไมโครโฟนให้สนิท ไม่งั้นไฟแสดงสถานะบนมือถือจะค้างและกินแบตต่อ */
  const releaseMic = () => {
    recorderRef.current?.stream.getTracks().forEach((tr) => tr.stop());
    recorderRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopTimer();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      releaseMic();
    };
  }, []);

  const start = async () => {
    setError(null);
    if (!supported) {
      setError(t('voice.unsupported'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t('voice.denied'));
      return;
    }

    try {
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopTimer();
        setRecording(false);
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size === 0) {
          setError(t('voice.failed'));
          return;
        }
        setBusy(true);
        try {
          const key = await saveAudio(blob);
          // อัดทับของเดิม = ของเดิมไม่มีใครอ้างถึงแล้ว ลบทิ้งเพื่อไม่ให้ค้างในเครื่อง
          if (value) await deletePhoto(value);
          onChange(key);
        } catch {
          setError(t('voice.failed'));
        } finally {
          setBusy(false);
        }
      };

      rec.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((s) => {
          const next = s + 1;
          if (next >= maxSeconds && recorderRef.current?.state === 'recording') recorderRef.current.stop();
          return next;
        });
      }, 1000);
    } catch {
      stream.getTracks().forEach((tr) => tr.stop());
      setError(t('voice.failed'));
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const remove = async () => {
    const key = value;
    onChange(null);
    if (key) await deletePhoto(key);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <Button type="button" variant="outline" size="sm" onClick={stop} className="border-bad text-bad">
            <Square className="h-3.5 w-3.5 fill-current" />
            {t('voice.stop')}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={start} disabled={busy || !supported}>
            <Mic className="h-4 w-4" />
            {value ? t('voice.rerecord') : t('voice.record')}
          </Button>
        )}

        {recording ? (
          <span className="flex items-center gap-1.5 text-xs text-bad">
            <span className="h-2 w-2 animate-pulse rounded-full bg-bad" />
            <span className="num">
              {mmss(elapsed)} / {mmss(maxSeconds)}
            </span>
          </span>
        ) : busy ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('common.saving')}
          </span>
        ) : null}

        {value && !recording ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={remove}
            className="text-muted-foreground hover:text-bad"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('voice.delete')}
          </Button>
        ) : null}
      </div>

      {value ? (
        <div className={cn('mt-2.5 rounded-md border bg-muted/30 p-2', recording && 'opacity-50')}>
          {url ? (
            <audio src={url} controls preload="metadata" className="h-9 w-full" />
          ) : (
            <span className="flex items-center gap-1.5 py-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('voice.loading')}
            </span>
          )}
        </div>
      ) : null}

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {error ? <span className="text-bad">{error}</span> : supported ? t('voice.hint') : t('voice.unsupported')}
      </p>
    </div>
  );
}

/** เล่นบันทึกเสียงที่แนบมากับใบแจ้ง — อ่านอย่างเดียว ใช้ในหน้ารายละเอียด */
export function VoicePlayer({ audioKey }: { audioKey: string }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void photoUrl(audioKey).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [audioKey]);

  return (
    <div className="rounded-md border bg-muted/30 p-2">
      {url ? (
        <audio src={url} controls preload="metadata" className="h-9 w-full" />
      ) : (
        <span className="flex items-center gap-1.5 py-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('voice.loading')}
        </span>
      )}
    </div>
  );
}
