import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { useLocale } from '../i18n/LocaleContext';
import { useT } from '../i18n/strings';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/locale';
import { Sheet } from './Sheet';

/**
 * The one language switcher, shown top-right on the hub, the room/join picker
 * and the lobby (their headers reserve the corner for it — `hub.css`,
 * `lobby.css`). Spec: docs/specs/i18n.md
 *
 * Each language is named in itself — "English", "Français" — not translated,
 * so a player stuck on the wrong one can still recognise their own to tap it.
 */
const NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };

export function LocalePicker(): JSX.Element {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div class="locale-picker">
      <button
        class="locale-picker__button"
        type="button"
        aria-label={t.localePicker.label}
        onClick={() => setOpen(true)}
      >
        {locale.toUpperCase()}
      </button>

      {open && (
        <Sheet label={t.localePicker.label} onClose={() => setOpen(false)}>
          <div class="gamemenu__head">
            <h2 class="gamemenu__title">{t.localePicker.label}</h2>
            <button class="btn gamemenu__close" type="button" onClick={() => setOpen(false)}>
              {t.parts.cancel}
            </button>
          </div>
          <ul class="locale-picker__list">
            {SUPPORTED_LOCALES.map((option) => (
              <li key={option}>
                <button
                  class={`locale-picker__option ${option === locale ? 'locale-picker__option--on' : ''}`}
                  type="button"
                  aria-pressed={option === locale}
                  onClick={() => {
                    setLocale(option);
                    setOpen(false);
                  }}
                >
                  {NAMES[option]}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
