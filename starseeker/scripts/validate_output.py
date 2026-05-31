from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_EVENT_FIELDS = {
    "date",
    "calendar_date",
    "time",
    "datetime",
    "object_name_kr",
    "score",
    "grade",
    "altitude_deg",
    "azimuth_deg",
}


def read_json(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def validate_events(events: list[dict]) -> None:
    if not isinstance(events, list):
        raise TypeError("events.json must be a JSON array")

    for idx, event in enumerate(events):
        missing = REQUIRED_EVENT_FIELDS - set(event)
        if missing:
            raise ValueError(f"event[{idx}] missing fields: {sorted(missing)}")

        score = event["score"]
        if not isinstance(score, int) or not 0 <= score <= 100:
            raise ValueError(f"event[{idx}] score out of range: {score}")

        altitude = float(event["altitude_deg"])
        if not -90 <= altitude <= 90:
            raise ValueError(f"event[{idx}] altitude out of range: {altitude}")

        azimuth = float(event["azimuth_deg"])
        if not 0 <= azimuth <= 360:
            raise ValueError(f"event[{idx}] azimuth out of range: {azimuth}")

        datetime.fromisoformat(event["datetime"])


def main() -> None:
    events = read_json(ROOT / "data" / "events.json")
    daily_summary = read_json(ROOT / "data" / "daily_summary.json")
    metadata = read_json(ROOT / "data" / "metadata.json")

    validate_events(events)
    if not isinstance(daily_summary, list):
        raise TypeError("daily_summary.json must be a JSON array")
    if "generated_at" not in metadata:
        raise ValueError("metadata.json missing generated_at")

    print(f"Validation passed: {len(events)} events, {len(daily_summary)} daily summaries")


if __name__ == "__main__":
    main()
