// Small client for the free BGPKIT API (CORS-enabled, no key). Used by /aspa/ (ASPA statistics) and
// /lookup/ (RPKI ROV badges) until this project publishes its own RPKI data. Responses are cached in
// sessionStorage for 30 minutes so reloading a page doesn't hit the API again.
const API = "https://api.bgpkit.com/v4/rpki";
const CACHE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 20000;

export async function api(path) {
  const key = `bgpkit:${path}`;
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || "null");
    if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  } catch { /* no storage */ }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}/${path}`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const v = await r.json();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* full */ }
    return v;
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "no answer within 20 s" : e.message);
  } finally {
    clearTimeout(timer);
  }
}
