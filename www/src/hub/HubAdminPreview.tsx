import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { useT } from '../core/i18n/strings';

/**
 * Dev-only, admin-only: a live "what would prod actually show" preview.
 * Spec: docs/specs/hub.md §3, docs/specs/backoffice.md §2b
 *
 * `showAll` is the server's own dev/prod signal (`api/config.php`'s `show_all`,
 * inlined into every page — `docs/specs/seo.md` §4), so gating the probe on it
 * means this never fires a request on prod at all, not even a failing one.
 *
 * "Admin" is answered by asking the admin API a question it already answers
 * truthfully from the session cookie alone: `GET /api/index.php?a=state` is
 * 200 for a signed-in admin browser and 401 for anyone else (`api/index.php`'s
 * own auth gate). No new endpoint, no new credential — the same session the
 * admin centre already set when they signed in there.
 *
 * The toggle itself changes nothing server-side. It overrides the `showAll`
 * `HubGrid` renders with, purely in this tab, the same way `LocalePicker`
 * overrides the locale `scripts/ssr.mjs` baked in — both start equal to what
 * the server sent, so hydration is never at risk, and only diverge after a
 * deliberate tap.
 */
export function useAdminPreview(serverShowAll: boolean): {
  isAdmin: boolean;
  effectiveShowAll: boolean;
  previewProd: boolean;
  setPreviewProd: (on: boolean) => void;
} {
  const [isAdmin, setIsAdmin] = useState(false);
  const [previewProd, setPreviewProd] = useState(false);

  useEffect(() => {
    if (!serverShowAll) return;
    let cancelled = false;
    fetch('/api/index.php?a=state')
      .then((res) => {
        if (!cancelled && res.status === 200) setIsAdmin(true);
      })
      .catch(() => {
        // No admin session, or the API is unreachable — either way, not an admin.
      });
    return () => {
      cancelled = true;
    };
  }, [serverShowAll]);

  return {
    isAdmin,
    effectiveShowAll: previewProd ? false : serverShowAll,
    previewProd,
    setPreviewProd,
  };
}

export function HubAdminPreview({
  previewProd,
  onChange,
}: {
  previewProd: boolean;
  onChange: (prod: boolean) => void;
}): JSX.Element {
  const t = useT();
  return (
    <div class="hub__filters hub__admin-preview" role="group" aria-label="Dev preview">
      <button
        type="button"
        class={`hub__filter-chip${previewProd ? '' : ' is-on'}`}
        aria-pressed={!previewProd}
        onClick={() => onChange(false)}
      >
        {t.hub.previewAll}
      </button>
      <button
        type="button"
        class={`hub__filter-chip${previewProd ? ' is-on' : ''}`}
        aria-pressed={previewProd}
        onClick={() => onChange(true)}
      >
        {t.hub.previewProd}
      </button>
    </div>
  );
}
