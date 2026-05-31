import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_events import score_to_grade


def test_score_to_grade():
    assert score_to_grade(80) == "excellent"
    assert score_to_grade(60) == "good"
    assert score_to_grade(40) == "fair"
    assert score_to_grade(39) == "poor"
