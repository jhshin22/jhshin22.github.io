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


@dataclass(frozen=True)
class ObservationPoint:
    name: str
    latitude: float
    longitude: float
    elevation_m: float
    timezone: str


class SkyfieldEngine:
    """Skyfield-backed astronomy calculation engine.

    The engine uses JPL's DE421 ephemeris through Skyfield. The first run may
    download `de421.bsp` into `data/skyfield_cache`; subsequent runs reuse it.
    """

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
        """Approximate illuminated fraction of the moon as seen by the observer."""
        t = self._time(when)
        at_time = self.observer.at(t)
        moon = at_time.observe(self.ephemeris["moon"]).apparent()
        sun = at_time.observe(self.ephemeris["sun"]).apparent()
        separation_rad = float(moon.separation_from(sun).radians)
        fraction = (1 - math.cos(separation_rad)) / 2
        return round(max(0.0, min(1.0, fraction)) * 100, 1)

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
