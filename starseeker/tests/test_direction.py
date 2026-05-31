import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from utils_direction import azimuth_to_direction_kr


def test_cardinal_directions():
    assert azimuth_to_direction_kr(0) == "북"
    assert azimuth_to_direction_kr(90) == "동"
    assert azimuth_to_direction_kr(180) == "남"
    assert azimuth_to_direction_kr(270) == "서"
