DIRECTIONS_16 = [
    "북", "북북동", "북동", "동북동",
    "동", "동남동", "남동", "남남동",
    "남", "남남서", "남서", "서남서",
    "서", "서북서", "북서", "북북서",
]


def azimuth_to_direction_kr(azimuth_deg: float) -> str:
    """Convert azimuth degrees to a Korean 16-wind direction label."""
    normalized = azimuth_deg % 360
    index = int((normalized + 11.25) // 22.5) % 16
    return DIRECTIONS_16[index]
