<?php

declare(strict_types=1);

/**
 * Sending the magic link.
 * Spec: docs/specs/backoffice.md §5
 *
 * An interface for one reason: `mail()` cannot be tested. Everything *around* the
 * send — the rate limit, the address comparison, the token — can be, and a fake
 * recipient is what lets the tests read the link that was sent and try to replay it.
 */
interface Mailer
{
    /** True when the mail was handed off. Says nothing about delivery. */
    public function send(string $to, string $subject, string $body): bool;
}

/**
 * The real one. `mail()` on the host, confirmed working 2026-08-05.
 *
 * No SMTP credential, no endpoint, no shared secret — the code that mints the link
 * runs in this process. An earlier design had the Worker POST to a PHP mailer behind a
 * `MAIL_SECRET` that had to exist identically in two systems with no way to check
 * (spec §5); that is gone.
 */
final class PhpMailer implements Mailer
{
    public function __construct(private string $from)
    {
    }

    public function send(string $to, string $subject, string $body): bool
    {
        // Header injection: a newline in `$to` or `$subject` would let a caller append
        // Bcc: headers. `$to` has already been compared against the configured address
        // by the time we get here, so it cannot be attacker-controlled — but the guard
        // costs nothing and the day someone adds a second recipient it is the only
        // thing standing there.
        if (preg_match('/[\r\n]/', $to . $subject . $this->from) === 1) {
            return false;
        }

        return mail($to, $subject, $body, [
            'From' => $this->from,
            'Content-Type' => 'text/plain; charset=utf-8',
            // A magic link in a mail somebody forwards or an assistant summarises is a
            // credential. Ask the machines not to fetch it.
            'X-Auto-Response-Suppress' => 'All',
            'Auto-Submitted' => 'auto-generated',
        ]);
    }
}

/** Records instead of sending, so a test can read the link and try to reuse it. */
final class FakeMailer implements Mailer
{
    /** @var list<array{to:string, subject:string, body:string}> */
    public array $sent = [];

    public bool $working = true;

    public function send(string $to, string $subject, string $body): bool
    {
        if (!$this->working) {
            return false;
        }

        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];

        return true;
    }

    public function last(): ?array
    {
        return $this->sent[count($this->sent) - 1] ?? null;
    }
}
