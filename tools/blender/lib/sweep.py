"""Sweep a 2D profile along a 3D path (parallel-transport frames). Used by straps, braids, locs, ribbons.

`profile(t)` returns the cross-section at path parameter t in [0, 1] as (u, v) points around the
path (u along the frame's side axis, v along its normal axis), so taper and twist are just functions.
"""

from __future__ import annotations

import math
from typing import Callable, Sequence

import bmesh
from mathutils import Vector

Profile = Callable[[float], Sequence[tuple[float, float]]]


def frames(path: Sequence[Vector], up: Vector | None = None) -> list[tuple[Vector, Vector, Vector]]:
    """(tangent, side, normal) per path point; the first side is chosen from `up`."""
    n = len(path)
    tans = []
    for i in range(n):
        a = path[max(0, i - 1)]
        b = path[min(n - 1, i + 1)]
        t = b - a
        tans.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, -1)))
    ref = up or Vector((0, 0, 1))
    side = tans[0].cross(ref)
    if side.length < 1e-6:
        side = tans[0].cross(Vector((1, 0, 0)))
    side.normalize()
    out = []
    for i, t in enumerate(tans):
        if i > 0:  # parallel transport: remove the component along the new tangent
            side = side - t * side.dot(t)
            side = side.normalized() if side.length > 1e-9 else out[-1][1]
        out.append((t, side, t.cross(side).normalized()))
    return out


def sweep(bm: bmesh.types.BMesh, path: Sequence[Vector], profile: Profile, *, closed: bool = True,
          cap_start: bool = False, cap_end: bool = True, up: Vector | None = None) -> list[bmesh.types.BMFace]:
    """Add a swept tube or ribbon to `bm`; returns the new faces."""
    fr = frames(path, up)
    rings: list[list[bmesh.types.BMVert]] = []
    n = len(path)
    for i, (p, (_t, s, nrm)) in enumerate(zip(path, fr)):
        prof = profile(i / max(1, n - 1))
        rings.append([bm.verts.new(p + s * u + nrm * v) for u, v in prof])
    faces = []
    for a, b in zip(rings, rings[1:]):
        m = len(a)
        last = m if closed else m - 1
        for j in range(last):
            k = (j + 1) % m
            faces.append(bm.faces.new((a[j], a[k], b[k], b[j])))
    if closed and cap_end and len(rings[-1]) >= 3:
        faces.append(bm.faces.new(rings[-1]))
    if closed and cap_start and len(rings[0]) >= 3:
        faces.append(bm.faces.new(list(reversed(rings[0]))))
    return faces


def circle(radius: float, sides: int, squash: float = 1.0, phase: float = 0.0) -> list[tuple[float, float]]:
    return [(radius * math.cos(phase + 2 * math.pi * i / sides), radius * squash * math.sin(phase + 2 * math.pi * i / sides))
            for i in range(sides)]


def rect(w: float, h: float) -> list[tuple[float, float]]:
    return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]


def two_lobe(radius: float, phase: float) -> list[tuple[float, float]]:
    """A peanut-shaped 8-point section: two strands twisted together."""
    pts = []
    for i in range(8):
        a = phase + 2 * math.pi * i / 8
        r = radius * (0.72 + 0.28 * abs(math.cos(a - phase)))
        pts.append((r * math.cos(a), r * math.sin(a) * 0.82))
    return pts


def taper(t: float, start: float = 1.0, end: float = 0.45) -> float:
    return start + (end - start) * t
