import { externalReferrer, isRefused, type AnalyticsAction } from './analytics';

/**
 * The two decisions in `core/analytics.ts` worth a test of their own: whether a browser
 * has opted out, and whether a referrer is worth reporting. `track()` itself is a thin
 * fire-and-forget wrapper over `sendBeacon`/`fetch` with no branch a unit test can watch
 * from outside a real browser — `api/tests/analytics_test.php` covers the payload
 * contract from the other end instead.
 */

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${what}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${what}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

console.log('\nisRefused: either signal is enough');

{
  check('neither signal set: not refused', isRefused({}) === false);
  check('globalPrivacyControl true: refused', isRefused({ globalPrivacyControl: true }) === true);
  check('globalPrivacyControl false: not refused', isRefused({ globalPrivacyControl: false }) === false);
  check("doNotTrack '1': refused", isRefused({ doNotTrack: '1' }) === true);
  // Firefox also sends 'unspecified' for "no preference set" — must not read as opt-out.
  check("doNotTrack 'unspecified': not refused", isRefused({ doNotTrack: 'unspecified' }) === false);
  check('both set: still refused', isRefused({ globalPrivacyControl: true, doNotTrack: '1' }) === true);
}

console.log('\nexternalReferrer: our own hub never counts as a referrer');

{
  const origin = 'https://fonygames.guigui.fr';

  check('no referrer at all', externalReferrer('', origin) === undefined);
  check(
    'a link from our own hub is dropped',
    externalReferrer('https://fonygames.guigui.fr/', origin) === undefined,
  );
  check(
    'our own hub with a path is still dropped',
    externalReferrer('https://fonygames.guigui.fr/grid-attack/', origin) === undefined,
  );
  check(
    'a real external referrer is kept, verbatim',
    externalReferrer('https://example.com/party-games', origin) === 'https://example.com/party-games',
  );
  // Same host, different scheme or port is a different origin — worth keeping.
  check(
    'a different port is a different origin',
    externalReferrer('https://fonygames.guigui.fr:8443/', 'https://fonygames.guigui.fr') ===
      'https://fonygames.guigui.fr:8443/',
  );
  // Some browsers/extensions hand back a bare string here rather than a URL.
  check('an unparseable referrer is dropped, not thrown', externalReferrer('not a url', origin) === undefined);
}

console.log('\nAnalyticsAction: the six the endpoint allows');

{
  // A compile-time check as much as a runtime one: this list must build against the
  // exported union, so a renamed action fails typecheck here before it fails silently
  // against the server's allowlist (api/tests/analytics_test.php checks that side).
  const actions: AnalyticsAction[] = [
    'hub_nav',
    'game_select',
    'room_create',
    'room_join',
    'game_start',
    'game_played',
  ];
  check('there are six', actions.length === 6, actions);
}

if (failures > 0) throw new Error(`${failures} of ${checks} check(s) failed`);
console.log(`\nall passed (${checks} checks)`);
