from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from calc_objects import ObservationPoint, calculate_sample_position

ROOT = Path(__file__).resolve().parents[1]


def score_to_grade(score: int) -> str:
    if score >= 80:
        return "excellent"
    if score >= 60:
        return "good"
    if score >= 40:
        return "fair"
    return "poor"


def build_placeholder_events(
    start_date: datetime,
    days: int,
    location: ObservationPoint,
    objects: dict[str, Any],
    rules: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build non-astronomical placeholder events for first-page development.

    Real Skyfield-based calculations should replace this function's internals.
    The output schema is kept stable so the HTML can be developed independently.
    """
    time_slots = rules.get("time_slots", ["20:00", "21:00", "22:00"])
    event_objects = [
        {"category": "moon", "id": "moon", "name_kr": "달", "name_en": "Moon", "magnitude": -12.0},
        *[{"category": "planet", **item, "magnitude": item.get("base_magnitude", 0.0)} for item in objects.get("planets", [])[:3]],
        *[{"category": "star", **item} for item in objects.get("stars", [])[:6]],
    ]
    events: list[dict[str, Any]] = []

    for day_offset in range(days):
        calendar_day = start_date + timedelta(days=day_offset)
        for index, obj in enumerate(event_objects[:4]):
            slot = time_slots[(day_offset + index) % len(time_slots)]
            hour, minute = map(int, slot.split(":"))
            actual_day = calendar_day + timedelta(days=1 if hour < 12 else 0)
            when = actual_day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            position = calculate_sample_position(obj["id"], when, location)
            base_score = 88 - index * 9 - (day_offset % 3) * 3
            score = max(40, min(95, base_score))
            grade = score_to_grade(score)
            date_key = calendar_day.strftime("%Y-%m-%d")

            events.append(
                {
                    "date": date_key,
                    "calendar_date": date_key,
                    "time": slot,
                    "display_time": slot,
                    "datetime": when.isoformat(),
                    "timezone": location.timezone,
                    "location": location.name,
                    "category": obj["category"],
                    "object_id": obj["id"],
                    "object_name_kr": obj["name_kr"],
                    "object_name_en": obj.get("name_en", obj["id"]),
                    "title": f"{obj['name_kr']} 관측 가능",
                    "summary": f"{slot} 기준 {position['direction_kr']} 방향, 고도 {position['altitude_deg']}도로 표시되는 1차 개발용 placeholder 이벤트입니다.",
                    "direction_kr": position["direction_kr"],
                    "azimuth_deg": position["azimuth_deg"],
                    "altitude_deg": position["altitude_deg"],
                    "magnitude": obj.get("magnitude"),
                    "sun_altitude_deg": -14.0,
                    "moon_illumination_pct": 50.0 + (day_offset % 10) * 4,
                    "moon_altitude_deg": 20.0,
                    "weather": {
                        "available": False,
                        "sky": None,
                        "precipitation_type": None,
                        "precipitation_probability": None,
                    },
                    "score": score,
                    "grade": grade,
                    "viewing_hint": "실제 Skyfield 계산 연동 전까지 화면 개발을 위한 임시 데이터입니다.",
                    "source_flags": {
                        "position": "placeholder",
                        "sun_moon": "placeholder",
                        "weather": "disabled",
                    },
                }
            )

    return events


def build_daily_summary(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        grouped.setdefault(event["calendar_date"], []).append(event)

    summaries: list[dict[str, Any]] = []
    for date_key, date_events in sorted(grouped.items()):
        sorted_events = sorted(date_events, key=lambda item: item["score"], reverse=True)
        top = sorted_events[0]
        summaries.append(
            {
                "date": date_key,
                "best_time": top["display_time"],
                "best_objects": [event["object_name_kr"] for event in sorted_events[:3]],
                "top_score": top["score"],
                "grade": top["grade"],
                "short_comment": " · ".join(event["object_name_kr"] for event in sorted_events[:2]) + " 관측 추천",
            }
        )
    return summaries
