// Generic fetch-with-retry, extracted from what was FPL-only logic in
// fpl.ts so sync-news's RSS fetches share the exact same retry/backoff/
// timeout behaviour rather than a second copy (CLAUDE.md: one quantity, one
// implementation). fpl.ts keeps a thin FPL-flavoured wrapper around this.

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches `url` and returns the response text, retrying on 429/5xx with
 * exponential backoff. 4xx other than 429 fails fast — it will not fix
 * itself on retry.
 */
export async function fetchWithRetry(
  url: string,
  opts: { headers?: Record<string, string>; retries?: number; timeoutMs?: number } = {},
): Promise<string> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: opts.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const err = new HttpError(res.status, `GET ${url} returned ${res.status}`);
        if (!retryable) throw err;
        lastError = err;
      } else {
        return await res.text();
      }
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
    }

    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }

  throw lastError;
}
