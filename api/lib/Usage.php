<?php

declare(strict_types=1);

/**
 * Cloudflare usage, against the free-tier ceilings.
 * Spec: docs/specs/backoffice.md §2 · ceilings: docs/realtime-options.md §4
 *
 * The point is **one early warning before the free tier runs out**, not pretty graphs.
 * Cloudflare's own dashboard does graphs better and always will; what it cannot do is sit
 * next to the flag switches on one page.
 *
 * ## Read-only, server-side, and no new shared secret
 *
 * `CF_ANALYTICS_TOKEN` is scoped to *Account Analytics: Read* and is used by PHP only, so
 * it never reaches a browser. It is deliberately NOT the deploy token: a token that can
 * both publish a Worker and read everything is a bigger blast radius for nothing
 * (docs/deployment.md §3.3).
 *
 * ## ⚠️ The GraphQL field names here are unverified
 *
 * This sandbox cannot reach `api.cloudflare.com`, and the analytics token does not exist
 * yet, so the query below is written from the documented schema and **has never had a real
 * response**. That is why:
 *
 *  - every field is read defensively and a missing one yields `null`, not an exception;
 *  - a parse failure returns the first 500 bytes of the raw body, so the operator can see
 *    what Cloudflare actually sent and fix the mapping in one place;
 *  - the panel's honest state is "unavailable", and it says which of the three reasons it
 *    is (no token, request failed, response not understood).
 *
 * A panel that showed a confident zero would be worse than one that says it does not know.
 */
final class Usage
{
    /** Free-tier ceilings, from docs/realtime-options.md §4. */
    public const REQUESTS_PER_DAY = 100_000;
    public const GB_SECONDS_PER_DAY = 13_000;

    private const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

    /**
     * @param callable(string, array, string): array{status:int, body:string}|null $transport
     *        Injected so the tests drive real parsing without a network. Null uses cURL.
     */
    public function __construct(
        private string $accountId,
        private string $token,
        private $transport = null,
    ) {
    }

    public function configured(): bool
    {
        return $this->accountId !== '' && $this->token !== '';
    }

    /**
     * Durable Object requests and duration for the last `$days` days.
     *
     * @return array{
     *   ok: bool,
     *   reason?: string,
     *   raw?: string,
     *   days?: list<array{date:string, requests:int|null, gbSeconds:float|null}>,
     *   ceilings: array{requests:int, gbSeconds:int}
     * }
     */
    public function daily(int $days = 7): array
    {
        $ceilings = ['requests' => self::REQUESTS_PER_DAY, 'gbSeconds' => self::GB_SECONDS_PER_DAY];

        if (!$this->configured()) {
            // Not an error. A host with no analytics token has no usage panel, and saying
            // so is more useful than a row of zeroes.
            return ['ok' => false, 'reason' => 'no analytics token is configured', 'ceilings' => $ceilings];
        }

        $days = max(1, min(31, $days));
        $end = gmdate('Y-m-d');
        $start = gmdate('Y-m-d', time() - ($days - 1) * 86400);

        $result = $this->post([
            'query' => self::QUERY,
            'variables' => ['accountTag' => $this->accountId, 'start' => $start, 'end' => $end],
        ]);

        if ($result['status'] !== 200) {
            return [
                'ok' => false,
                'reason' => "Cloudflare answered {$result['status']}",
                'raw' => substr($result['body'], 0, 500),
                'ceilings' => $ceilings,
            ];
        }

        return self::parse($result['body']) + ['ceilings' => $ceilings];
    }

    /**
     * Parse a GraphQL response into per-day rows.
     *
     * Static and pure, so `usage_test.php` can feed it recorded shapes — including the
     * malformed ones, which are the cases that decide whether the panel lies.
     *
     * @return array{ok: bool, reason?: string, raw?: string, days?: list<array<string, mixed>>}
     */
    public static function parse(string $body): array
    {
        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            return ['ok' => false, 'reason' => 'the response was not JSON', 'raw' => substr($body, 0, 500)];
        }

        // GraphQL reports its own errors with HTTP 200, so a 200 is not success.
        if (isset($decoded['errors']) && is_array($decoded['errors']) && $decoded['errors'] !== []) {
            $first = $decoded['errors'][0]['message'] ?? 'unknown GraphQL error';
            return ['ok' => false, 'reason' => 'Cloudflare: ' . (string) $first, 'raw' => substr($body, 0, 500)];
        }

        $account = $decoded['data']['viewer']['accounts'][0] ?? null;
        if (!is_array($account)) {
            return [
                'ok' => false,
                'reason' => 'no account in the response — is the token scoped to this account?',
                'raw' => substr($body, 0, 500),
            ];
        }

        /** @var array<string, array{date:string, requests:int|null, gbSeconds:float|null}> $byDate */
        $byDate = [];

        foreach ($account['durableObjectsInvocationsAdaptiveGroups'] ?? [] as $row) {
            $date = $row['dimensions']['date'] ?? null;
            if (!is_string($date)) {
                continue;
            }
            $byDate[$date] ??= ['date' => $date, 'requests' => null, 'gbSeconds' => null];
            $requests = $row['sum']['requests'] ?? null;
            if (is_int($requests) || is_float($requests)) {
                $byDate[$date]['requests'] = (int) $requests;
            }
        }

        foreach ($account['durableObjectsPeriodicGroups'] ?? [] as $row) {
            $date = $row['dimensions']['date'] ?? null;
            if (!is_string($date)) {
                continue;
            }
            $byDate[$date] ??= ['date' => $date, 'requests' => null, 'gbSeconds' => null];
            // GB-seconds is read if it turns up but is NOT requested by the query — see
            // the note on QUERY. So this stays null today, and the panel says so rather
            // than showing a confident zero against the 13,000 GB-s ceiling.
            $duration = $row['sum']['durationGbSeconds'] ?? $row['sum']['duration'] ?? null;
            if (is_int($duration) || is_float($duration)) {
                $byDate[$date]['gbSeconds'] = (float) $duration;
            }
        }

        if ($byDate === []) {
            return [
                'ok' => false,
                'reason' => 'the response had no usage rows — the schema may have changed',
                'raw' => substr($body, 0, 500),
            ];
        }

        krsort($byDate);

        return ['ok' => true, 'days' => array_values($byDate)];
    }

    /**
     * How close a day is to the ceiling, as a percentage, or null when unknown.
     *
     * Separate and pure because it is the only arithmetic here, and because "82% of the
     * free tier" is the one number the operator actually acts on.
     */
    public static function pressure(?float $used, int $ceiling): ?int
    {
        if ($used === null || $ceiling <= 0) {
            return null;
        }

        return (int) round(($used / $ceiling) * 100);
    }

    /** @param array<string, mixed> $payload */
    private function post(array $payload): array
    {
        $body = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $headers = [
            'Authorization: Bearer ' . $this->token,
            'Content-Type: application/json',
        ];

        if ($this->transport !== null) {
            return ($this->transport)(self::ENDPOINT, $headers, (string) $body);
        }

        $handle = curl_init(self::ENDPOINT);
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            // A slow analytics API must not hang the admin page. The panel says
            // "unavailable" and the flag switches above it still work.
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CONNECTTIMEOUT => 4,
        ]);
        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_error($handle);
        curl_close($handle);

        if ($response === false) {
            // 0 is not a real HTTP status; `daily()` reports it as a failed request, which
            // is what a DNS or TLS problem is.
            return ['status' => 0, 'body' => $error];
        }

        return ['status' => $status, 'body' => (string) $response];
    }

    /**
     * The query.
     *
     * `limit` is required by this API and 1000 is far past 31 days of rows. Written out
     * rather than built, so the exact text is reviewable — it is the part most likely to
     * need correcting against the real schema.
     *
     * ⚠️ **One dataset, one field, and that is the whole lesson.** GraphQL fails the WHOLE
     * query on a single unknown field, and the first real response proved it: this asked
     * `durableObjectsPeriodicGroups` for `sum { requests }`, which that dataset does not
     * have, and the panel died with `unknown field "requests"` — taking the request count
     * with it even though the *other* dataset spelled it correctly.
     *
     * The periodic block earned nothing: `parse()` treats GB-seconds as optional and never
     * required it, so the guess was pure downside. It is gone rather than corrected,
     * because a second guess would fail the same way.
     *
     * The request count is the ceiling that actually binds at our scale (100k/day vs ~139
     * heavy rounds/day, docs/realtime-options.md §4). Adding duration later means finding
     * the real field name from a real response first — `parse()` already reads either
     * documented spelling if it turns up.
     */
    private const QUERY = <<<'GRAPHQL'
        query FonyUsage($accountTag: String!, $start: Date!, $end: Date!) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              durableObjectsInvocationsAdaptiveGroups(
                limit: 1000
                filter: { date_geq: $start, date_leq: $end }
                orderBy: [date_DESC]
              ) {
                dimensions { date }
                sum { requests }
              }
            }
          }
        }
        GRAPHQL;
}
