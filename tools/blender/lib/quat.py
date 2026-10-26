"""Quaternion comparison (pure: no bpy)."""

from __future__ import annotations

import math
from typing import Sequence


def angle_deg(a: Sequence[float], b: Sequence[float]) -> float:
    """Smallest rotation angle between two unit quaternions (w, x, y, z); q and -q are equal."""
    dot = abs(sum(x * y for x, y in zip(a, b)))
    return math.degrees(2 * math.acos(min(1.0, dot)))
