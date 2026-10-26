"""Horizontal hip drift measurement (pure: no bpy)."""

from __future__ import annotations

import math
from typing import Sequence


def max_drift(samples: Sequence[tuple[float, float]]) -> float:
    """Largest horizontal distance (m) of any sample from the first one."""
    if not samples:
        return 0.0
    x0, y0 = samples[0]
    return max(math.hypot(x - x0, y - y0) for x, y in samples)


def net_drift(samples: Sequence[tuple[float, float]]) -> float:
    """Horizontal distance (m) between the first and last samples."""
    if len(samples) < 2:
        return 0.0
    (x0, y0), (x1, y1) = samples[0], samples[-1]
    return math.hypot(x1 - x0, y1 - y0)
