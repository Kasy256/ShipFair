"""2D footprint helpers for collider choice (pure: no bpy)."""

from __future__ import annotations

from typing import Sequence

Point = tuple[float, float]


def convex_hull(points: Sequence[Point]) -> list[Point]:
    """Andrew's monotone chain; returns the hull counter-clockwise without repeating the start."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return list(pts)

    def cross(o: Point, a: Point, b: Point) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[Point] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[Point] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def polygon_area(poly: Sequence[Point]) -> float:
    n = len(poly)
    return abs(sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))) / 2


def collider_shape(points: Sequence[Point], round_ratio: float = 0.88, aspect_tol: float = 0.2) -> str:
    """'cylinder' for round, near-square footprints (hull fills < `round_ratio` of its box), else 'box'."""
    if len(points) < 3:
        return "box"
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    w, d = max(xs) - min(xs), max(ys) - min(ys)
    if w <= 0 or d <= 0:
        return "box"
    if abs(w - d) / max(w, d) > aspect_tol:
        return "box"
    fill = polygon_area(convex_hull(points)) / (w * d)
    return "cylinder" if fill < round_ratio else "box"
