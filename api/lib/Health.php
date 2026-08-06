<?php

declare(strict_types=1);

/**
 * Is it up, and what is live?
 * Spec: docs/specs/backoffice.md §2
 *
 * Three questions the operator asks first, and none of them needs a credential: the
 * Worker's `/health` is public, the site answering at all is public, and the deployed
 * revision is a file the deploy already writes.
 *
 * Every check is **bounded and independent**. A hung Worker must not hang the admin page,
 * and one failure must not hide the other answers — the panel exists to be looked at when
 * something is wrong, which is exactly when parts of it will be timing out.
 */
final class Health
{
    /** Short: this runs while somebody is waiting for the page. */
    private const TIMEOUT_S = 4;

    /**
     * @param callable(string): array{status:int, body:string}|null $transport
     *        Injected for the tests, which must not touch the network.
     */
    public function __construct(private $transport = null)
    {
    }

    /**
     * @param array<string, string> $targets label → URL
     * @return list<array{label:string, url:string, ok:bool, status:int, detail:string}>
     */
    public function check(array $targets): array
    {
        $out = [];

        foreach ($targets as $label => $url) {
            if ($url === '') {
                $out[] = ['label' => $label, 'url' => '', 'ok' => false, 'status' => 0, 'detail' => 'not configured'];
                continue;
            }

            $result = $this->get($url);
            $out[] = [
                'label' => $label,
                'url' => $url,
                'ok' => $result['status'] >= 200 && $result['status'] < 400,
                'status' => $result['status'],
                // Truncated: a 500 page can be a whole HTML document, and this lands in a
                // JSON payload the admin renders.
                'detail' => substr(trim($result['body']), 0, 120),
            ];
        }

        return $out;
    }

    /**
     * What is actually live, from the marker the deploy writes to the web root.
     *
     * Cheaper and more truthful than anything else available: it is the commit that
     * produced the files being served, rather than the commit someone believes shipped
     * (docs/deployment.md §5).
     */
    public static function revision(string $webRoot): ?string
    {
        $file = $webRoot . '/.deploy-revision';
        if (!is_readable($file)) {
            return null;
        }

        $value = trim((string) file_get_contents($file));

        // A 40-char hex SHA or nothing. A truncated upload or a stray file should not put
        // arbitrary text into the page.
        return preg_match('/^[0-9a-f]{7,40}$/', $value) === 1 ? $value : null;
    }

    private function get(string $url): array
    {
        if ($this->transport !== null) {
            return ($this->transport)($url);
        }

        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT_S,
            CURLOPT_CONNECTTIMEOUT => 2,
            // Follow one hop: http→https is a normal answer, not a failure.
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 2,
        ]);
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_error($handle);
        curl_close($handle);

        return $body === false
            // 0 is not an HTTP status; it means the request never got one, which is what a
            // DNS failure, a refused connection or a timeout all are.
            ? ['status' => 0, 'body' => $error]
            : ['status' => $status, 'body' => (string) $body];
    }
}
