from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from build_events import build_daily_summary, build_placeholder_events
from calc_objects import ObservationPoint

ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build StarSeeker data files.")
    parser.add_argument("--days", type=int, default=30, help="Number of calendar days to build.")
    parser.add_argument("--start-date", type=str, default=None, help="YYYY-MM-DD. Defaults to today in Asia/Seoul.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    location_config = read_json(ROOT / "config" / "location.json")
    objects = read_json(ROOT / "config" / "objects.json")
    rules = read_json(ROOT / "config" / "scoring_rules.json")

    timezone = ZoneInfo(location_config.get("timezone", "Asia/Seoul"))
    if args.start_date:
        start_date = datetime.fromisoformat(args.start_date).replace(tzinfo=timezone)
    else:
        start_date = datetime.now(timezone).replace(hour=0, minute=0, second=0, microsecond=0)

    location = ObservationPoint(
        name=location_config["name"],
        latitude=float(location_config["latitude"]),
        longitude=float(location_config["longitude"]),
        elevation_m=float(location_config.get("elevation_m", 0)),
        timezone=location_config.get("timezone", "Asia/Seoul"),
    )

    events = build_placeholder_events(start_date, args.days, location, objects, rules)
    daily_summary = build_daily_summary(events)
    end_date = start_date + timedelta(days=args.days - 1)
    metadata = {
        "generated_at": datetime.now(timezone).isoformat(timespec="seconds"),
        "timezone": location.timezone,
        "location": {
            "name": location.name,
            "latitude": location.latitude,
            "longitude": location.longitude,
            "elevation_m": location.elevation_m,
        },
        "range": {
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
        },
        "weather_enabled": False,
        "kasi_enabled": False,
        "version": "0.1.0-placeholder",
    }

    write_json(ROOT / "data" / "events.json", events)
    write_json(ROOT / "data" / "daily_summary.json", daily_summary)
    write_json(ROOT / "data" / "metadata.json", metadata)
    print(f"Generated {len(events)} events for {args.days} days.")


if __name__ == "__main__":
    main()
