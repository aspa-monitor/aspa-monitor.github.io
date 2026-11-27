import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRetry } from "../../site/assets/retry.js";

// A fake fetch that answers from a script: numbers are statuses, "net" throws like a network failure.
function fake(script) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === "net") throw new TypeError("Failed to fetch");
    return { status: step, ok: step >= 200 && step < 300 };
  };
  return { fetchFn, calls, sleep: async () => {} };
}

test("a 503 is retried once and the second answer is used", async () => {
  const f = fake([503, 200]);
  assert.equal((await fetchRetry("/x", f)).status, 200);
  assert.equal(f.calls.length, 2);
});

test("a network failure is retried once", async () => {
  const f = fake(["net", 200]);
  assert.equal((await fetchRetry("/x", f)).status, 200);
});

test("only one retry: a second 5xx or failure comes back", async () => {
  const f = fake([502, 502, 200]);
  assert.equal((await fetchRetry("/x", f)).status, 502);
  assert.equal(f.calls.length, 2);
  await assert.rejects(fetchRetry("/x", fake(["net", "net"])), TypeError);
});

test("404 and success are not retried; 429 is", async () => {
  for (const s of [200, 404, 403]) {
    const f = fake([s, 200]);
    assert.equal((await fetchRetry("/x", f)).status, s);
    assert.equal(f.calls.length, 1);
  }
  assert.equal((await fetchRetry("/x", fake([429, 200]))).status, 200);
});
