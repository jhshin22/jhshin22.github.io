from __future__ import annotations

from datetime import datetime
from typing import Any

import requests

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def sky_label(cloud_cover: float | None) -> str | None:
    if cloud_cover is None:
        return None
    if cloud_cover <= 20:
        return "맑음"
    if cloud_cover <= 50:
        return "구름조금"
    if cloud_cover <= 75:
        return "구름많음"
    return "흐림"


def weather_score_delta(weather: dict[str, Any] | None) -> int:
    if not weather or not weather.get("available"):
        return 0

    cloud_cover = weather.get("cloud_cover")
    precip_probability = weather.get("precipitation_probability")
    precipitation = weather.get("precipitation")

    if precipitation is not None and float(precipitation) > 0:
        return -35
    if precip_probability is not None and float(precip_probability) >= 50:
        return -30
    if cloud_cover is not None and float(cloud_cover) >= 80:
        return -35
    if cloud_cover is not None and float(cloud_cover) >= 65:
        return -18
    if cloud_cover is not None and float(cloud_cover) >= 40:
        return -8
    if cloud_cover is not None and float(cloud_cover) <= 20:
        return 10
    return 0


def is_weather_unsuitable(weather: dict[str, Any] | None) -> bool:
    """Return True when the sky is likely too cloudy or rainy for recommendation."""
    if not weather or not weather.get("available"):
        return False

    cloud_cover = weather.get("cloud_cover")
    precip_probability = weather.get("precipitation_probability")
    precipitation = weather.get("precipitation")

    if precipitation is not None and float(precipitation) > 0:
        return True
    if precip_probability is not None and float(precip_probability) >= 50:
        return True
    if cloud_cover is not None and float(cloud_cover) >= 80:
        return True
    return False


def fetch_open_meteo_weather(
    latitude: float,
    longitude: float,
    timezone: str = "Asia/Seoul",
    forecast_days: int = 16,
    timeout: int = 20,
) -> dict[str, dict[str, Any]]:
    """Fetch hourly weather forecasts and return a dictionary keyed by local hour.

    Key format: YYYY-MM-DDTHH:MM, matching the first 16 chars of event datetime.
    Open-Meteo supports up to 16 forecast days for the standard forecast API.
    """
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "timezone": timezone,
        "forecast_days": min(max(int(forecast_days), 1), 16),
        "hourly": "cloud_cover,precipitation_probability,precipitation,weather_code,visibility",
    }

    response = requests.get(OPEN_METEO_FORECAST_URL, params=params, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    hourly = payload.get("hourly", {})

    times = hourly.get("time", [])
    cloud_cover = hourly.get("cloud_cover", [])
    precip_probability = hourly.get("precipitation_probability", [])
    precipitation = hourly.get("precipitation", [])
    weather_code = hourly.get("weather_code", [])
    visibility = hourly.get("visibility", [])

    result: dict[str, dict[str, Any]] = {}
    for idx, time_value in enumerate(times):
        cloud = value_at(cloud_cover, idx)
        precip_prob = value_at(precip_probability, idx)
        precip = value_at(precipitation, idx)
        code = value_at(weather_code, idx)
        vis = value_at(visibility, idx)

        key = normalize_hour_key(time_value)
        result[key] = {
            "available": True,
            "provider": "open_meteo",
            "sky": sky_label(cloud),
            "cloud_cover": cloud,
            "precipitation_probability": precip_prob,
            "precipitation": precip,
            "precipitation_type": precipitation_type(code, precip),
            "weather_code": code,
            "visibility": vis,
            "unsuitable": is_weather_unsuitable(
                {
                    "available": True,
                    "cloud_cover": cloud,
                    "precipitation_probability": precip_prob,
                    "precipitation": precip,
                }
            ),
        }
    return result


def normalize_hour_key(time_value: str) -> str:
    # Open-Meteo returns local time as YYYY-MM-DDTHH:MM when timezone is set.
    return time_value[:16]


def event_weather_key(when: datetime | str) -> str:
    if isinstance(when, datetime):
        return when.isoformat()[:16]
    return str(when)[:16]


def value_at(values: list[Any], idx: int) -> Any:
    if idx >= len(values):
        return None
    return values[idx]


def precipitation_type(weather_code: int | float | None, precipitation: float | None) -> str:
    if precipitation is not None and float(precipitation) > 0:
        return "있음"
    if weather_code is None:
        return "없음"
    code = int(weather_code)
    if code in {51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82}:
        return "비"
    if code in {71, 73, 75, 77, 85, 86}:
        return "눈"
    if code in {95, 96, 99}:
        return "뇌우"
    return "없음"
