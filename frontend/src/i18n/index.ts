import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';
import type { LangCode } from '../api/types';

export interface I18nValue {
  lang: LangCode;
  setLang: (lang: LangCode) => void;
  t: typeof zhCN;
}

export const I18nContext = createContext<I18nValue>({
  lang: 'zh-CN',
  setLang: () => {},
  t: zhCN
});

export function getDict(lang: LangCode) {
  return lang === 'en-US' ? (enUS as unknown as typeof zhCN) : zhCN;
}

export function useI18n() {
  return useContext(I18nContext);
}
