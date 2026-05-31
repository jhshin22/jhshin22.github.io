from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from utils_direction import azimuth_to_direction_kr


@dataclass
class ObservationPoint:
    name: str
    latitude: float
    longitude: float
    elevation_m: float
    timezone: str


def calculate_sample_position(object_id: str, when: datetime, location: ObservationPoint) -> dict[str, Any]:
    """Return deterministic placeholder positions until Skyfield integration is added.

    This function intentionally does not pretend to be precise astronomy data.
    It only keeps the JSON pipeline working while the real Skyfield calculation
    is implemented in the next development phase.
    """
    seed = sum(ord(ch) for ch in object_id) + when.hour * 17 + when.day * 3
    altitude = 12 + (seed % 55)
    azimuth = float(seed % 360)
    return {
        "altitude_deg": round(float(altitude), 1),
        "azimuth_deg": round(azimuth, 1),
        "direction_kr": azimuth_to_direction_kr(azimuth),
        "source": "placeholder",
    }
