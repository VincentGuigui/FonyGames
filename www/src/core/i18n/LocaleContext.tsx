import { createContext } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useContext, useMemo, useState } from 'preact/hooks';
import { detectLocale, loadStoredLocale, storeLocale, type Locale } from './locale';

type LocaleState = { locale: Locale; setLocale: (next: Locale) => void };

/**
 * A no-op default rather than `null` + a null check at every call site — every real
 * consumer sits under `LocaleProvider`, which every page mounts once at its root
 * (see `www/src/main.tsx` and each `www/src/<slug>.tsx`).
 */
const LocaleContext = createContext<LocaleState>({ locale: 'en', setLocale: () => {} });

/** Fixed locale for SSR/unit fixtures; production pages use `LocaleProvider`. */
export function LocaleTestProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ComponentChildren;
}): JSX.Element {
  return <LocaleContext.Provider value={{ locale, setLocale: () => {} }}>{children}</LocaleContext.Provider>;
}

/**
 * Seeds the locale once per page load — a stored choice first, then the browser's own
 * preference list, English if neither says anything — and remembers a change for next
 * time. Spec: docs/specs/i18n.md
 */
export function LocaleProvider({ children }: { children: ComponentChildren }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(
    () => loadStoredLocale() ?? detectLocale(navigator.languages ?? [navigator.language]),
  );

  const state = useMemo<LocaleState>(
    () => ({
      locale,
      setLocale: (next) => {
        storeLocale(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={state}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  return useContext(LocaleContext);
}
