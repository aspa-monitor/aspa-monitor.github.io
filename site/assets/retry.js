// fetch() with one retry for the site's own data files. GitHub Pages now and then answers a file with a
// 5xx error (seen right after a deploy); a second try a moment later almost always works. Only network
// failures, 5xx and 429 are retried: a 404 or other 4xx is a real answer and comes back at once.

export const RETRY_DELAY_MS = 700;
const retryable = (status) => status >= 500 || status === 429;

export async function fetchRetry(url, { retries = 1, delay = RETRY_DELAY_MS, fetchFn = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetchFn(url);
    } catch (e) {
      if (attempt >= retries) throw e; // network failure on the last try
      await sleep(delay);
      continue;
    }
    if (!retryable(r.status) || attempt >= retries) return r;
    await sleep(delay);
  }
}
