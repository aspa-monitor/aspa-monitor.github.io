// Every time shown to people is IST (Asia/Kolkata, UTC+05:30).

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Date -> "2026-11-24 21:15:00 IST" */
export function formatIST(date) {
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} IST`;
}

export function formatUnixIST(seconds) {
  return seconds == null ? "—" : formatIST(new Date(seconds * 1000));
}

/** Rough "3 h ago" text. */
export function ago(date, now = new Date()) {
  const s = Math.round((now - date) / 1000);
  if (s < 0) return "in the future";
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
