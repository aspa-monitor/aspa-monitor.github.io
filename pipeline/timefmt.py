"""Human-visible times are IST (UTC+05:30); code works in UTC internally."""
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def now_ist() -> str:
    """Current time as ISO 8601 with the +05:30 offset, to the second."""
    return datetime.now(timezone.utc).astimezone(IST).isoformat(timespec="seconds")


def parse_iso(text: str) -> datetime:
    """Parse an ISO 8601 timestamp that carries an offset (never compare the text)."""
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        raise ValueError(f"timestamp without offset: {text!r}")
    return dt
