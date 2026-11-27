import { createContext, useContext } from 'react';
import { translate, type Key } from './i18n';
import type { Lang } from './types';

export const LangContext = createContext<Lang>('en');

export function useT() {
  const lang = useContext(LangContext);
  return { lang, t: (key: Key, params?: Record<string, string | number>) => translate(lang, key, params) };
}
