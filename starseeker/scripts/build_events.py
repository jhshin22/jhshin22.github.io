from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from calc_objects import ObservationPoint, SkyfieldEngine, object_position
from fetch_weather import event_weather_key, is_weather_unsuitable, weather_score_delta

ROOT = Path(__file__).resolve().parents[1]

BRIGHTNESS_SCORE_BY_OBJECT = {
    "moon": 25,
    "venus": 30,
    "jupiter": 25,
    "mars": 20,
    "saturn": 18,
    "mercury": 15,
}


def score_to_grade(score: int) -> str:
    if score >= 80:
        return "excellent"
    if score >= 60:
        return "good"
    if score >= 40:
        return "fair"
    return "poor"


def altitude_score(altitude_deg: float) -> int:
    if altitude_deg < 10:
        return 0
    if altitude_deg < 20:
        return 15
    if altitude_deg < 35:
        return 25
    return 35


def darkness_score(sun_altitude_deg: float) -> int:
    if sun_altitude_deg >= -6:
        return 0
    if sun_altitude_deg >= -12:
        return 15
    return 25


def brightness_score(obj: dict[str, Any], category: str) -> int:
    object_id = obj["id"]
    if object_id in BRIGHTNESS_SCORE_BY_OBJECT:
        return BRIGHTNESS_SCORE_BY_OBJECT[object_id]
    if category == "star":
        magnitude = float(obj.get("magnitude", 2.0))
        if magnitude <= 0:
            return 20
        if magnitude <= 1:
            return 15
        if magnitude <= 2:
            return 10
    return 5


def moonlight_penalty(category: str, moon_altitude_deg: float, moon_illumination_pct: float) -> int:
    if category in {"moon", "planet"}:
        return 0
    if moon_altitude_deg <= 0:
        return 0
    if moon_illumination_pct >= 70:
        return 20
    if moon_illumination_pct >= 40:
        return 10
    if moon_illumination_pct >= 20:
        return 5
    return 0


def calculate_score(
    obj: dict[str, Any],
    category: str,
    position: dict[str, Any],
    context: dict[str, float],
    weather: dict[str, Any] | None = None,
) -> int:
    altitude = float(position["altitude_deg"])
    sun_altitude = float(context["sun_altitude_deg"])

    if altitude < 10:
        return 0
    if sun_altitude >= -6 and category not in {"moon", "planet"}:
        return 0
    if is_weather_unsuitable(weather):
        return 0

    score = 0
    score += altitude_score(altitude)
    score += darkness_score(sun_altitude)
    score += brightness_score(obj, category)
    score -= moonlight_penalty(
        category,
        float(context["moon_altitude_deg"]),
        float(context["moon_illumination_pct"]),
    )
    score += weather_score_delta(weather)
    return max(0, min(100, int(score)))


def build_viewing_hint(obj: dict[str, Any], category: str, grade: str) -> str:
    name = obj["name_kr"]
    if category == "moon":
        return "쌍안경으로 달의 명암 경계선 주변을 보면 크레이터와 지형 대비를 확인하기 좋습니다."
    if obj["id"] == "jupiter":
        return "맨눈으로도 밝게 보이며, 쌍안경으로는 갈릴레이 위성 관측을 시도할 수 있습니다."
    if obj["id"] == "venus":
        return "매우 밝은 행성이지만 지평선 근처 건물과 산에 가려질 수 있어 트인 방향이 중요합니다."
    if obj["id"] == "saturn":
        return "맨눈으로는 밝은 별처럼 보입니다. 고도가 충분하면 소형 망원경 관측 대상으로 좋습니다."
    if category == "star":
        return f"{name}은 맨눈으로 찾기 쉬운 밝은 별입니다. 주변 별자리와 함께 위치를 확인해 보세요."
    return "고도가 높고 하늘이 어두울수록 관측 조건이 좋아집니다."


def event_summary(obj: dict[str, Any], slot: str, position: dict[str, Any], grade: str, weather: dict[str, Any] | None = None) -> str:
    label = {"excellent": "매우 좋은", "good": "좋은", "fair": "조건부로 가능한"}.get(grade, "낮은")
    weather_text = ""
    if weather and weather.get("available"):
        sky = weather.get("sky") or "날씨 확인"
        cloud = weather.get("cloud_cover")
        pop = weather.get("precipitation_probability")
        weather_text = f" 날씨는 {sky}"
        if cloud is not None:
            weather_text += f", 구름량 {cloud}%"
        if pop is not None:
            weather_text += f", 강수확률 {pop}%"
        weather_text += "입니다."
    return (
        f"{slot} 기준 {position['direction_kr']} 방향, 고도 {position['altitude_deg']}도로 "
        f"관측 조건이 {label} 편입니다.{weather_text}"
    )


def iter_observation_objects(objects: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    result: list[tuple[str, dict[str, Any]]] = [
        ("moon", {"id": "moon", "name_kr": "달", "name_en": "Moon", "magnitude": -12.0})
    ]
    result.extend(("planet", {**item, "magnitude": item.get("base_magnitude", 0.0)}) for item in objects.get("planets", []))
    result.extend(("star", item) for item in objects.get("stars", []))
    return result


def build_real_events(
    start_date: datetime,
    days: int,
    location: ObservationPoint,
    objects: dict[str, Any],
    rules: dict[str, Any],
    weather_by_hour: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    cache_dir = ROOT / "data" / "skyfield_cache"
    engine = SkyfieldEngine(location, cache_dir=cache_dir)
    time_slots = rules.get("time_slots", ["20:00", "21:00", "22:00"])
    min_score = int(rules.get("minimum_score", 40))
    weather_by_hour = weather_by_hour or {}
    events: list[dict[str, Any]] = []

    for day_offset in range(days):
        calendar_day = start_date + timedelta(days=day_offset)
        date_key = calendar_day.strftime("%Y-%m-%d")

        for slot in time_slots:
            hour, minute = map(int, slot.split(":"))
            actual_day = calendar_day + timedelta(days=1 if hour < 12 else 0)
            when = actual_day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            context = engine.context(when)
            weather = weather_by_hour.get(event_weather_key(when), {"available": False})

            for category, obj in iter_observation_objects(objects):
                position = object_position(engine, obj, category, when)
                score = calculate_score(obj, category, position, context, weather)
                if score < min_score:
                    continue
                grade = score_to_grade(score)
                magnitude = obj.get("magnitude", obj.get("base_magnitude"))

                events.append(
                    {
                        "date": date_key,
                        "calendar_date": date_key,
                        "time": slot,
                        "display_time": slot,
                        "datetime": when.isoformat(),
                        "timezone": location.timezone,
                        "location": location.name,
                        "category": category,
                        "object_id": obj["id"],
                        "object_name_kr": obj["name_kr"],
                        "object_name_en": obj.get("name_en", obj["id"]),
                        "title": f"{obj['name_kr']} 관측 가능",
                        "summary": event_summary(obj, slot, position, grade, weather),
                        "direction_kr": position["direction_kr"],
                        "azimuth_deg": position["azimuth_deg"],
                        "altitude_deg": position["altitude_deg"],
                        "magnitude": magnitude,
                        "sun_altitude_deg": context["sun_altitude_deg"],
                        "moon_illumination_pct": context["moon_illumination_pct"],
                        "moon_altitude_deg": context["moon_altitude_deg"],
                        "weather": weather,
                        "score": score,
                        "grade": grade,
                        "viewing_hint": build_viewing_hint(obj, category, grade),
                        "source_flags": {
                            "position": "skyfield_de421",
                            "sun_moon": "skyfield_de421",
                            "weather": "open_meteo" if weather.get("available") else "disabled",
                        },
                    }
                )

    return events


def best_unique_events(date_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for event in sorted(date_events, key=lambda item: item["score"], reverse=True):
        key = f"{event['category']}__{event.get('object_id') or event['object_name_kr']}"
        if key not in unique:
            unique[key] = event
    return list(unique.values())


def build_daily_summary(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        grouped.setdefault(event["calendar_date"], []).append(event)

    summaries: list[dict[str, Any]] = []
    for date_key, date_events in sorted(grouped.items()):
        sorted_events = sorted(date_events, key=lambda item: item["score"], reverse=True)
        unique_events = best_unique_events(sorted_events)
        top = unique_events[0]
        summaries.append(
            {
                "date": date_key,
                "best_time": top["display_time"],
                "best_objects": [event["object_name_kr"] for event in unique_events[:3]],
                "top_score": top["score"],
                "grade": top["grade"],
                "short_comment": " · ".join(event["object_name_kr"] for event in unique_events[:2]) + " 관측 추천",
            }
        )
    return summaries
