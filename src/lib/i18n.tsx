import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { th, type Dict } from './locales/th';
import { en } from './locales/en';
import type { Lang } from './time';
import type { Area, DefectCategory } from './types';

const dicts: Record<Lang, Dict> = { th, en };
const LANG_KEY = 'qc.lang';

/** เส้นทางคีย์แปลภาษา เช่น 'issue.title' */
export type TKey = { [S in keyof Dict]: `${S & string}.${keyof Dict[S] & string}` }[keyof Dict];

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === 'en' ? 'en' : 'th';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      const [group, item] = key.split('.') as [keyof Dict, string];
      const dict = dicts[lang] as unknown as Record<string, Record<string, string>>;
      let out = dict[group as string]?.[item] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
      }
      return out;
    },
    [lang],
  );

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang: setLangState,
      toggleLang: () => setLangState((l) => (l === 'th' ? 'en' : 'th')),
      t,
    }),
    [lang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n ต้องอยู่ภายใน I18nProvider');
  return ctx;
}

/** ชื่อประเภทข้อบกพร่องตามภาษาที่เลือก */
export function categoryLabel(
  c: Pick<DefectCategory, 'category_name' | 'category_name_en'> | undefined,
  lang: Lang,
): string {
  if (!c) return '—';
  return lang === 'en' ? c.category_name_en || c.category_name : c.category_name;
}

export function personLabel(p: { full_name: string; full_name_en?: string } | undefined, lang: Lang): string {
  if (!p) return '—';
  return lang === 'en' ? p.full_name_en || p.full_name : p.full_name;
}

export function areaLabelOf(a: Pick<Area, 'area_name' | 'area_name_en'> | undefined, lang: Lang): string {
  if (!a) return '—';
  return lang === 'en' ? a.area_name_en || a.area_name : a.area_name;
}
