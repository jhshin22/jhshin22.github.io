from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from build_events import build_daily_summary, build_real_events
from calc_objects import ObservationPoint
from fetch_weather import fetch_open_meteo_weather

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
    parser.add_argument("--disable-weather", action="store_true", help="Disable Open-Meteo weather filtering.")
    return parser.parse_args()


def weather_severity(weather: dict) -> int:
    if not weather or not weather.get("available"):
        return 0
    severity = 0
    cloud = weather.get("cloud_cover")
    pop = weather.get("precipitation_probability")
    precipitation = weather.get("precipitation")
    if precipitation is not None and float(precipitation) > 0:
        severity += 4
    if pop is not None and float(pop) >= 50:
        severity += 3
    if cloud is not None and float(cloud) >= 80:
        severity += 4
    elif cloud is not None and float(cloud) >= 65:
        severity += 2
    elif cloud is not None and float(cloud) >= 40:
        severity += 1
    return severity


def weather_reason(weather: dict) -> str:
    parts = []
    if weather.get("sky"):
        parts.append(str(weather["sky"]))
    if weather.get("cloud_cover") is not None:
        parts.append(f"구름량 {weather['cloud_cover']}%")
    if weather.get("precipitation_probability") is not None:
        parts.append(f"강수확률 {weather['precipitation_probability']}%")
    if weather.get("precipitation") is not None and float(weather["precipitation"]) > 0:
        parts.append(f"강수량 {weather['precipitation']}mm")
    return ", ".join(parts) if parts else "날씨 조건 불리"


def build_no_recommendation_reasons(
    start_date: datetime,
    days: int,
    rules: dict,
    events: list[dict],
    weather_by_hour: dict[str, dict],
) -> list[dict]:
    dates_with_events = {event["calendar_date"] for event in events}
    time_slots = rules.get("time_slots", [])
    reasons = []

    for day_offset in range(days):
        calendar_day = start_date + timedelta(days=day_offset)
        date_key = calendar_day.strftime("%Y-%m-%d")
        if date_key in dates_with_events:
            continue

        samples = []
        for slot in time_slots:
            hour, minute = map(int, slot.split(":"))
            actual_day = calendar_day + timedelta(days=1 if hour < 12 else 0)
            key = actual_day.replace(hour=hour, minute=minute, second=0, microsecond=0).isoformat()[:16]
            weather = weather_by_hour.get(key)
            if weather and weather.get("available"):
                samples.append(weather)

        if samples:
            worst = sorted(samples, key=weather_severity, reverse=True)[0]
            if weather_severity(worst) >= 4:
                reason = f"날씨 조건이 좋지 않습니다({weather_reason(worst)})."
                reason_type = "weather"
            else:
                reason = "날씨가 일부 아쉽거나, 고도·밝기·하늘 어두움 조건을 동시에 만족하는 대상이 없습니다."
                reason_type = "mixed"
        else:
            reason = "예보 범위 밖이거나, 고도·밝기·하늘 어두움 조건을 동시에 만족하는 대상이 없습니다."
            reason_type = "astronomy_or_no_weather"

        reasons.append({"date": date_key, "reason_type": reason_type, "reason": reason})

    return reasons


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

    weather_by_hour = {}
    weather_enabled = False
    weather_error = None
    if not args.disable_weather:
        try:
            weather_by_hour = fetch_open_meteo_weather(
                latitude=location.latitude,
                longitude=location.longitude,
                timezone=location.timezone,
                forecast_days=min(args.days + 1, 16),
            )
            weather_enabled = bool(weather_by_hour)
            print(f"Fetched {len(weather_by_hour)} hourly weather records from Open-Meteo.")
        except Exception as exc:  # noqa: BLE001 - keep astronomy build alive when weather fails
            weather_error = str(exc)
            print(f"Weather fetch failed; continuing without weather filter: {weather_error}")

    events = build_real_events(start_date, args.days, location, objects, rules, weather_by_hour=weather_by_hour)
    daily_summary = build_daily_summary(events)
    no_recommendation_reasons = build_no_recommendation_reasons(start_date, args.days, rules, events, weather_by_hour)
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
        "weather_enabled": weather_enabled,
        "weather_provider": "open_meteo" if weather_enabled else None,
        "weather_error": weather_error,
        "weather_forecast_days": min(args.days + 1, 16) if weather_enabled else 0,
        "kasi_enabled": False,
        "astronomy_engine": "skyfield_de421",
        "version": "0.4.0-ux-reasons",
    }

    write_json(ROOT / "data" / "events.json", events)
    write_json(ROOT / "data" / "daily_summary.json", daily_summary)
    write_json(ROOT / "data" / "no_recommendation_reasons.json", no_recommendation_reasons)
    write_json(ROOT / "data" / "metadata.json", metadata)
    print(f"Generated {len(events)} Skyfield-based events for {args.days} days.")


if __name__ == "__main__":
    main()
