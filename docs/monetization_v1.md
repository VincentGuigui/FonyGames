# Monetization

How this project could make money, what each option would cost in principles,
and what the numbers actually are.

> Status: **investigation, no decision taken.** Nothing here is built, and
> nothing here should be read as a recommendation to build it. Rates checked
> September 2026 — re-check before committing to any of them, the same warning
> [realtime-options.md](realtime-options.md) carries for the same reason.

---

## 1. The finding that reframes everything below

**There is no audience yet, and there is no cost problem yet.** Monetization is
a function of traffic, and every option in §6 multiplies by a number that is
currently near zero. M7 (the field test — real party, real phones) is still
open in [roadmap.md](roadmap.md), and the site lives on a subdomain of a
personal domain with no acquisition channel other than a link pasted into a
group chat.

The honest consequence: **the highest-value "monetization work" available today
is distribution work, not payment plumbing.** Nothing in §6 is worth building
before there is something to multiply.

That is not an argument for never monetizing. It is an argument for knowing
which gate each option belongs behind (§7), and for not paying a principle cost
now for revenue that would round to zero.

## 2. What it costs to run, today

Both real numbers, from [realtime-options.md](realtime-options.md) §3:

| Resource | Free allowance | What binds first |
| --- | --- | --- |
| Cloudflare Durable Objects | 100k requests/day, 13,000 GB-s/day | see below |
| PHP host + MySQL | already paid for, a personal domain that predates this project | — |
| Domain | `guigui.fr` subdomain, no separate cost | — |

Worked against this catalogue's two traffic profiles:

| | Billed requests/round | Rounds/day by requests | Rounds/day by duration | **Actual ceiling** |
| --- | --- | --- | --- | --- |
| **Profile A** (event games — most of the catalogue) | ~18 | ~5,555 | ~866 | **~866/day**, duration-bound |
| **Profile B** (streaming — Cat and Mouse, Shake Rush) | ~720 | ~139 | ~866 | **~139/day**, request-bound |

Duration: a 128 MB object awake for a 2-minute round is ~15 GB-s, so
13,000 GB-s/day is ~866 rounds however cheap the messages are. Hibernation means
idle lobbies cost nothing, so this is a worst case.

**Call it ~850 rounds a day free, and roughly 26,000 a month.** Past that the
next step is Cloudflare Workers Paid at **$5/month** (1M requests included).

So the cost curve is flat at zero and then flat at five dollars. **Nothing here
needs monetizing to survive.** Whatever the reason to earn money from this
project turns out to be, "the bill" is not it — and that matters, because it
removes the one justification that would let a monetization decision skip the
principle questions in §3.

## 3. What this project's own rules already forbid

These are written rules in this repository, not preferences. Every one of them
is a real blocker for at least one option below, and each would have to be
*amended in writing* — Golden Rule §3.1 — before the corresponding option could
ship.

| Rule | Where | What it blocks |
| --- | --- | --- |
| "No third-party analytics on sensor data. **No tracking pixels.**" | [device-capabilities.md](device-capabilities.md) §6 | Every programmatic ad network. An ad SDK *is* a third-party tracking script. |
| "Zero friction. No install, no account, no download. ≤ 3 taps from a shared link." | [../AGENTS.md](../AGENTS.md) §4 | Accounts, therefore IAP and subscriptions. Also a consent banner in front of the first tap. |
| "No user accounts, no persistent profiles" | [architecture.md](architecture.md) §5 | Anything that has to remember who paid. |
| Hub first load ≤ 150 KB gzipped | [architecture.md](architecture.md) §4 | Not fatal, but see below. |
| No personal data beyond the room's life, bar the disclosed activity record | [../AGENTS.md](../AGENTS.md) §7 | Audience segments, retargeting, data resale. |
| No native app, no store distribution | [../AGENTS.md](../AGENTS.md) §7 | The app-store IAP economy entirely. |

On the payload budget specifically: the **whole current first load is 17,110
bytes gzipped** (architecture.md §4, measured 2026-08-06). A typical ad SDK is
50–200 KB. An ad network would not eat into the budget — it would be **several
times larger than the entire product**, and it would land on the one page whose
job is to load fast enough that a stranger does not leave.

And the public promise, in the hub footer in both languages: *"No install, no
account. Positions and sensor readings never leave the room you're playing
in."* Ads do not contradict the literal sentence. They contradict what a reader
takes from it.

## 4. The consent wall

[specs/analytics.md](specs/analytics.md) §1 already leaves consent **deliberately open** —
a year-long visitor-id cookie exists today with no banner, and that spec
explicitly refuses to infer from its absence that none is needed.

Advertising removes the option of leaving it open:

- Serving **personalized** ads to the EEA/UK requires a **Google-certified CMP
  integrated with IAB TCF**, mandatory since January 2024, and **TCF v2.3 since
  1 March 2026**. Without it, ad requests fall back to limited ads.
- **Non-personalized** ads can be served without consent, and pay
  substantially less.
- The audience is French. This is not a rule that can be routed around by
  geography.

So the sequence is fixed: **the consent question has to be answered before the
ad question, not alongside it.** And a consent dialog is, by construction, a
tap between the shared link and the game — the exact friction §4 of AGENTS.md
exists to prevent. That cost lands on *every* visitor, including the ones who
never see a second page.

## 5. Why the standard web-game playbook does not fit

Two structural mismatches, both worth stating plainly because most advice about
monetizing web games assumes neither.

**Portals monetize single players.** Poki, CrazyGames, GameDistribution and the
rest all work the same way: a visitor arrives alone, plays alone, and watches
ads between attempts. **A visitor who arrives at FonyGames alone cannot play
almost anything** — 19 of 20 live games require a second human with a second
phone. The single largest revenue channel in web gaming is closed by the
product's core premise, not by its principles. (§6.4 is what to do about that.)

**Ads in a party game are worse than ads in a solo game — socially, not just
tonally.** In a solo game an interstitial interrupts one person. Here, six
people in one room hit the end-of-round screen within a second of each other
and all six phones start playing a video at once, out of sync, out loud. The
product is people looking at each other; the ad format is people looking down.
That is a product objection, and it stands even if every compliance box is
ticked.

## 6. The options

Ranked by fit with *this* project, not by revenue potential in general.

| # | Option | Realistic revenue | Principle cost | Effort |
| --- | --- | --- | --- | --- |
| 1 | Voluntary support (tip jar) | €0–20/mo | **none** | ~1 hour |
| 2 | Self-served sponsor slot | €0–300/campaign | low | ~1 day + sales |
| 3 | B2B / event licensing | €100–1,000+/event | low | weeks |
| 4 | Solo spin-offs on portals | $200–2,000/mo per hit | **none** (separate product) | weeks per game |
| 5 | Ads on the hub itself | €20–60/mo at 10k sessions | **high** | days + ongoing compliance |
| 6 | Premium / IAP | — | **very high** | months |

### 6.1 Voluntary support — the only free lunch

A footer link to GitHub Sponsors, Ko-fi, Liberapay or a Stripe payment link.
No script, no cookie, no consent, no payload, no account, no third party on the
page. It is a link.

Conversion on tip jars is famously bad (well under 1% of visitors) and this will
not fund anything. But the bill it needs to cover is **$5/month**, the project
is open source, and this is the only option in the table that costs nothing
against any rule in §3. If the answer to "why monetize at all" is "so it pays
for itself", this alone finishes the job.

### 6.2 A self-served sponsor slot

One static image plus a link, served from our own host, sold directly to one
sponsor at a time. No ad network, no auction, no third-party script, **no
tracking pixel** — which is precisely why it clears §3 where programmatic
advertising does not. It sells the *audience's attention* without selling
anything *about* the audience, and because it processes no personal data it
raises no new consent question.

The flags system already built ([specs/backoffice.md](specs/backoffice.md) §2b)
is most of the delivery mechanism: an operator-controlled, per-slot value with
an admin UI and no rebuild.

The catch is sales, not code. A sponsor slot is worth roughly what the traffic
is worth, and below ~20k monthly visitors there is little to sell. A party-game
audience is a genuinely good fit for a board-game shop, a drinks brand or a
local venue — but somebody has to go and ask them.

### 6.3 B2B / event licensing — the best-fit option nobody suggests

Sell the platform to people running an event: a team-building afternoon, a
wedding, a bar's quiz night, a conference ice-breaker. Branded room, their logo,
a chosen subset of games, a code on a screen that a room full of people scan.

Why it fits unusually well here:

- **The buyer has the account; the players never do.** The ≤ 3 taps rule
  survives completely intact — a guest still just opens a link.
- No ads, no consent banner, no tracking, no payload cost on the public hub.
- Per-event pricing means revenue **does not depend on scale traffic** — one
  paying event is worth more than a month of ads at plausible volumes.
- Most of the machinery exists: per-room codes, the flags system to select a
  game set, an admin centre, a rooms model that is already "one organiser,
  many guests".

The cost is that it is a *business*, not a feature: invoicing, a contact route,
support on the night, and a promise of reliability the project does not
currently make.

### 6.4 Solo spin-offs on portals — monetize the game design, not the site

Take the games that work with one player and publish *those* to Poki,
CrazyGames or GameDistribution as standalone entries. The portal sells the ads,
runs the CMP, owns the consent problem, and pays a revenue share — typically
**50–80%**, with CrazyGames' published 2026 jam terms at 60% of ad revenue.
Non-exclusive licensing of a finished H5 game is another route, commonly
**$300–800** flat, more for exclusivity. A well-performing casual portal game
lands somewhere around **$200–2,000/month**.

**`fonygames.guigui.fr` is not involved at all.** No rule in §3 is touched,
because the thing being monetized is a different artefact on somebody else's
site. That separation is the whole appeal.

Roughly eight of the twenty live games are genuinely solo-viable — a score or a
clock, not a degraded multiplayer:

| Candidate | Why it works alone |
| --- | --- |
| Tiles Surfer | Already `[1, 8]` — the only game whose minimum is one |
| 100 Taps | Pure time attack against a shuffle |
| Squash Mosquitoes | 66 mosquitoes, faster wins |
| Tap Tap Music | Switch off every lamp, against the clock |
| Steady Hand | Becomes a personal best |
| Ghost Hunt | Sweeping the room needs nobody else |
| UFO Hunt | "Your score is only your own shots" already |
| Tap Duel (`sprint`) | Most taps before the buzzer |

And the mechanism is already half-built: `enoughToStart(connected, limits,
solo)` and the admin solo-testing switch ([specs/backoffice.md](specs/backoffice.md)
§6) exist precisely to let one person start a round. Today it is a testing
affordance. It is also, unintentionally, a product surface.

The irreducibly social games — Pass the Bomb, Spill, Sling Puck, Cat and Mouse,
Goat Siege, Tap Fighter, Gravity Shooter, Grid Attack, Aliens Love Cows,
Tic-Tac-Tic-Tac-Toe, Neon Fall — cannot go this route and should not be forced
to.

### 6.5 Ads on the hub — the numbers, so the trade is explicit

The end-of-round screen (`core/ui/GameOver.tsx`) is a real, natural slot: it
already exists, already pauses, and already has a "play again" button to put an
ad in front of. Rewarded video is the highest-paying format and clears roughly
**$8–15 eCPM in the EU** ($15–28 US, $1–3 tier-3). Display and interstitial in
casual gaming run far lower — on the order of €1–4 RPM in the EU, and toward
the bottom of that without consent.

Worked at a volume that would already be a real success for a link-shared
hobby project:

| Monthly sessions | Impressions (2/session) | At €3 eCPM | At €1 (non-personalized) |
| --- | --- | --- | --- |
| 10,000 | 20,000 | **€60** | €20 |
| 50,000 | 100,000 | €300 | €100 |
| 80,000 | 160,000 | €480 | €160 |

Set against: infrastructure at **€0–5/month**, a **17 KB** first load that
would grow by multiples, a **consent banner in front of every visitor**, an
amendment to the no-tracking-pixels rule, and six phones playing video ads at
each other in a living room.

**€60/month is the honest figure at a traffic level this project has not
reached.** That is the trade, stated at its real size.

### 6.6 Premium / IAP — not recommended

Needs accounts, payments, persistent entitlements and a privacy review, against
two explicit non-goals ([architecture.md](architecture.md) §5,
[../AGENTS.md](../AGENTS.md) §4). A room-level unlock code could dodge the
account requirement in theory, but there is no payment infrastructure, the
flags system is per-game rather than per-purchaser, and the whole thing prices
a party game that people play once at a barbecue. The effort is months and the
principle cost is the highest in the table.

## 7. Recommendation: gates, not a plan

Nothing here is worth doing on a schedule. Each option should unlock on a
condition:

| Gate | Condition | Do |
| --- | --- | --- |
| **Now** | — | §6.1, the tip-jar link. One hour, no cost, no rule touched. Then go back to M7. |
| **Gate 1** | M7 done, ~5k sessions/month, a real referrer mix in the stats | §6.4 (pick two solo candidates) and/or start §6.3 conversations. Neither needs the hub to change. |
| **Gate 2** | ~20k sessions/month | §6.2 becomes sellable. Revisit whether a sponsor beats an ad network — at this size it usually does, and it costs nothing in §3. |
| **Gate 3** | ~50k+ sessions/month, sustained | Only now is §6.5 worth its price. **Answer the consent question first** — analytics.md §1 already owes that answer, and ads make it non-optional. |

The instrumentation to know when a gate opens **already exists**: unique
visitors, per-game funnels (`game_select` → `room_create`/`room_join` →
`game_start` → `game_played`), countries and referrer hosts, all in
[specs/analytics.md](specs/analytics.md) §6. Nothing new needs building to measure this.

Two of these — §6.3 and §6.4 — are traffic-independent and could start today
on their own merits. They are also the only two that earn without asking the
public hub to become something else.

## 8. Open decisions for the maintainer

Each of these needs an explicit yes before anything is built (AGENTS.md §3.3),
and the answer belongs in [roadmap.md](roadmap.md) as well as here.

1. **Why monetize at all?** "Pay the $5 bill" and "make this a business" have
   completely different answers, and the table in §6 sorts differently under
   each. This document cannot pick.
2. **Is the no-tracking-pixels rule negotiable?** (device-capabilities.md §6.)
   If it is not, §6.5 is closed permanently and the honest thing is to write
   that down and stop revisiting it.
3. **Consent**, already open in analytics.md §1 and now blocking more than it
   was.
4. **Is a solo product line acceptable?** §6.4 is the highest-revenue option
   with no principle cost, but it means maintaining single-player variants of a
   deliberately multiplayer catalogue — a scope decision, not a technical one.
5. **A real domain?** Several options assume the project reads as a product
   rather than a personal subdomain. Cheap, but it is a commitment.

---

## Sources

- [Web game monetization: what the data actually says (2026)](https://app.cinevva.com/guides/web-game-monetization) · [CrazyGames developer guide (2026)](https://app.cinevva.com/guides/publish-game-crazygames) · [CrazyGames developer portal](https://developer.crazygames.com/)
- [H5 game monetization 2026, for publishers](https://blog.pubfuture.com/h5-game-monetization-2026-for-publishers/47248/) · [10 ways to monetize HTML5 games in 2026](https://playgama.com/blog/main/10-ways-to-monetize-html5-games-that-actually-work-in-2026/) · [Best ad networks for HTML5 games](https://doondook.studio/best-ad-networks-monetize-html5-games/)
- [AppLixir: what CPM/eCPM actually means](https://www.applixir.com/blog/everything-you-need-to-know-about-cpm-ecpm/) · [Web gaming for indie developers: five honest truths](https://indiegamebusiness.com/web-gaming-for-indie-developers/)
- [Google consent management requirements, EEA/UK/Switzerland (publishers)](https://support.google.com/adsense/answer/13554116?hl=en) · [Publisher integration with IAB Europe TCF](https://support.google.com/adsense/answer/9804260?hl=en) · [IAB TCF v2.3: what publishers must do by February 2026](https://www.cookieyes.com/blog/iab-tcf-v2-3-explained/)
- Internal: [realtime-options.md](realtime-options.md) §3 (free-tier maths), [architecture.md](architecture.md) §4 (payload budgets), [specs/analytics.md](specs/analytics.md) §1 (the consent gap), [specs/backoffice.md](specs/backoffice.md) §2b, §6 (flags, solo switch)
