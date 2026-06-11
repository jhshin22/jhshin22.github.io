from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from utils_direction import azimuth_to_direction_kr

try:
    from skyfield.api import Loader, Star, wgs84
except ImportError:  # pragma: no cover - exercised only when dependency is missing
    Loader = None
    Star = None
    wgs84 = None


PLANET_BODY_NAMES = {
    "mercury": "mercury",
    "venus": "venus",
    "mars": "mars",
    "jupiter": "jupiter barycenter",
    "saturn": "saturn barycenter",
}

INNER_PLANETS = {"mercury", "venus"}


@dataclass(frozen=True)
class ObservationPoint:
    name: str
    latitude: float
    longitude: float
    elevation_m: float
    timezone: str


class SkyfieldEngine:
    """Skyfield-backed astronomy calculation engine."""

    def __init__(self, location: ObservationPoint, cache_dir: Path):
        if Loader is None or Star is None or wgs84 is None:
            raise RuntimeError(
                "Skyfield is not installed. Run `pip install -r requirements.txt` before building StarSeeker data."
            )

        self.location = location
        self.loader = Loader(str(cache_dir))
        self.timescale = self.loader.timescale()
        self.ephemeris = self.loader("de421.bsp")
        self.observer = self.ephemeris["earth"] + wgs84.latlon(
            latitude_degrees=location.latitude,
            longitude_degrees=location.longitude,
            elevation_m=location.elevation_m,
        )

    def _time(self, when: datetime):
        if when.tzinfo is None:
            raise ValueError("SkyfieldEngine requires timezone-aware datetimes.")
        return self.timescale.from_datetime(when)

    def _altaz_for_target(self, target: Any, when: datetime) -> dict[str, float | str]:
        t = self._time(when)
        apparent = self.observer.at(t).observe(target).apparent()
        altitude, azimuth, _distance = apparent.altaz()
        azimuth_deg = float(azimuth.degrees) % 360
        altitude_deg = float(altitude.degrees)
        return {
            "altitude_deg": round(altitude_deg, 1),
            "azimuth_deg": round(azimuth_deg, 1),
            "direction_kr": azimuth_to_direction_kr(azimuth_deg),
        }

    def planet_position(self, object_id: str, when: datetime) -> dict[str, float | str]:
        body_name = PLANET_BODY_NAMES.get(object_id)
        if body_name is None:
            raise ValueError(f"Unsupported planet id: {object_id}")
        return self._altaz_for_target(self.ephemeris[body_name], when)

    def moon_position(self, when: datetime) -> dict[str, float | str]:
        return self._altaz_for_target(self.ephemeris["moon"], when)

    def sun_position(self, when: datetime) -> dict[str, float | str]:
        return self._altaz_for_target(self.ephemeris["sun"], when)

    def star_position(self, star_config: dict[str, Any], when: datetime) -> dict[str, float | str]:
        star = Star(
            ra_hours=float(star_config["ra_hours"]),
            dec_degrees=float(star_config["dec_degrees"]),
        )
        return self._altaz_for_target(star, when)

    def moon_illumination_pct(self, when: datetime) -> float:
        t = self._time(when)
        at_time = self.observer.at(t)
        moon = at_time.observe(self.ephemeris["moon"]).apparent()
        sun = at_time.observe(self.ephemeris["sun"]).apparent()
        separation_rad = float(moon.separation_from(sun).radians)
        fraction = (1 - math.cos(separation_rad)) / 2
        return round(max(0.0, min(1.0, fraction)) * 100, 1)

    def moon_phase_info(self, when: datetime) -> dict[str, Any]:
        t = self._time(when)
        at_time = self.observer.at(t)
        moon = at_time.observe(self.ephemeris["moon"]).apparent()
        sun = at_time.observe(self.ephemeris["sun"]).apparent()
        elongation_deg = float(moon.separation_from(sun).degrees)
        illumination_pct = self.moon_illumination_pct(when)
        waxing = is_moon_waxing(when)
        return {
            "phase_type": "moon",
            "phase_name_kr": moon_phase_name(elongation_deg, waxing),
            "illumination_pct": illumination_pct,
            "phase_angle_deg": round(elongation_deg, 1),
            "waxing": waxing,
            "visible_to": "naked_eye",
            "observable_phase_note": "맨눈으로도 위상 확인 가능, 쌍안경으로 명암 경계선 관측 추천",
        }

    def planet_phase_info(self, object_id: str, when: datetime) -> dict[str, Any] | None:
        body_name = PLANET_BODY_NAMES.get(object_id)
        if body_name is None:
            return None

        t = self._time(when)
        sun = self.ephemeris["sun"].at(t).position.km
        earth = self.ephemeris["earth"].at(t).position.km
        planet = self.ephemeris[body_name].at(t).position.km

        # Phase angle at the planet: Sun-Planet-Earth. 0° => full-like, 180° => new/crescent.
        sun_vec = sun - planet
        earth_vec = earth - planet
        phase_angle_deg = vector_angle_deg(sun_vec, earth_vec)
        illumination_pct = round((1 + math.cos(math.radians(phase_angle_deg))) / 2 * 100, 1)

        if object_id in INNER_PLANETS:
            phase_name = inner_planet_phase_name(illumination_pct)
            visible_to = "small_telescope"
            note = "취미용 소형 망원경으로 위상 확인 가능"
        elif object_id == "mars":
            phase_name = outer_planet_phase_name(illumination_pct)
            visible_to = "small_telescope_difficult"
            note = "조건이 좋고 배율이 충분할 때 둥근 원반과 약한 위상 차이를 시도 가능"
        else:
            phase_name = "거의 보름 모양"
            visible_to = "not_meaningful_visually"
            note = "아마추어 관측에서는 위상 변화보다 줄무늬·고리 같은 특징이 더 중요"

        return {
            "phase_type": "planet",
            "phase_name_kr": phase_name,
            "illumination_pct": illumination_pct,
            "phase_angle_deg": round(phase_angle_deg, 1),
            "visible_to": visible_to,
            "observable_phase_note": note,
        }

    def context(self, when: datetime) -> dict[str, float]:
        sun = self.sun_position(when)
        moon = self.moon_position(when)
        return {
            "sun_altitude_deg": float(sun["altitude_deg"]),
            "moon_altitude_deg": float(moon["altitude_deg"]),
            "moon_illumination_pct": self.moon_illumination_pct(when),
        }


def object_position(
    engine: SkyfieldEngine,
    object_config: dict[str, Any],
    category: str,
    when: datetime,
) -> dict[str, float | str]:
    if category == "moon":
        return engine.moon_position(when)
    if category == "planet":
        return engine.planet_position(object_config["id"], when)
    if category == "star":
        return engine.star_position(object_config, when)
    raise ValueError(f"Unsupported category: {category}")


def object_phase_info(
    engine: SkyfieldEngine,
    object_config: dict[str, Any],
    category: str,
    when: datetime,
) -> dict[str, Any] | None:
    if category == "moon":
        return engine.moon_phase_info(when)
    if category == "planet":
        return engine.planet_phase_info(object_config["id"], when)
    return None


def vector_angle_deg(a, b) -> float:
    dot = float((a * b).sum())
    norm_a = math.sqrt(float((a * a).sum()))
    norm_b = math.sqrt(float((b * b).sum()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    cosine = max(-1.0, min(1.0, dot / (norm_a * norm_b)))
    return math.degrees(math.acos(cosine))


def is_moon_waxing(when: datetime) -> bool:
    synodic_month_days = 29.53058867
    known_new_moon = datetime(2000, 1, 6, 18, 14, tzinfo=when.tzinfo)
    age_days = (when - known_new_moon).total_seconds() / 86400
    return (age_days % synodic_month_days) < (synodic_month_days / 2)


def moon_phase_name(elongation_deg: float, waxing: bool) -> str:
    if elongation_deg < 8:
        return "삭에 가까움"
    if elongation_deg > 172:
        return "보름달에 가까움"
    if 82 <= elongation_deg <= 98:
        return "상현달" if waxing else "하현달"
    if elongation_deg < 82:
        return "초승달" if waxing else "그믐달"
    return "차오르는 반달 이후" if waxing else "기우는 반달 이후"


def inner_planet_phase_name(illumination_pct: float) -> str:
    if illumination_pct < 10:
        return "매우 가는 초승 모양"
    if illumination_pct < 35:
        return "초승 모양"
    if illumination_pct < 65:
        return "반달 모양"
    if illumination_pct < 90:
        return "둥근 반달 이후"
    return "거의 보름 모양"


def outer_planet_phase_name(illumination_pct: float) -> str:
    if illumination_pct < 90:
        return "약간 이지러진 둥근 모양"
    return "거의 보름 모양"
