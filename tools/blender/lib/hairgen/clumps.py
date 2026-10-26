"""Clumps: many small shapes scattered over the scalp with clustering (coils, knots, textured tops).

Shapes: `ico` (rounded coil clusters), `coil` (short spiral), `knot` (Bantu knot: a twisted cone).
"""

from __future__ import annotations

import math
import random
from typing import Any, Mapping

import bmesh
from mathutils import Matrix, Vector

from .base import HairCtx, Piece, ellipsoid
from .strands import scalp_points, spread
from ..sweep import circle, sweep


def _basis(n: Vector) -> Matrix:
    """Rotation taking +Z to `n`."""
    return n.to_track_quat("Z", "Y").to_matrix().to_4x4()


def coil(bm: bmesh.types.BMesh, base: Vector, n: Vector, size: float, turns: float, phase: float) -> None:
    pts = []
    steps = 10
    for i in range(steps + 1):
        t = i / steps
        a = phase + turns * 2 * math.pi * t
        r = size * 0.45 * (1 - 0.4 * t)
        local = Vector((r * math.cos(a), r * math.sin(a), size * 1.1 * t))
        pts.append(base + _basis(n).to_3x3() @ local)
    sweep(bm, pts, lambda t: circle(size * 0.28 * (1 - 0.35 * t), 4), cap_start=False, up=n)


def knot(bm: bmesh.types.BMesh, base: Vector, n: Vector, size: float, phase: float) -> None:
    """A Bantu knot: a coiled cone, wide at the scalp, narrowing to a point."""
    pts = []
    steps = 14
    for i in range(steps + 1):
        t = i / steps
        a = phase + 2.2 * 2 * math.pi * t
        r = size * 0.55 * (1 - t) + size * 0.05
        local = Vector((r * math.cos(a), r * math.sin(a), size * 0.95 * t))
        pts.append(base + _basis(n).to_3x3() @ local)
    sweep(bm, pts, lambda t: circle(size * 0.32 * (1 - 0.5 * t), 5), cap_start=True, up=n)


def clumps(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], region: str = "HAIR") -> list[bmesh.types.BMFace]:
    seed = int(p.get("seed", 11))
    rnd = random.Random(seed)
    pts = scalp_points(ctx, p.get("on", "all"), float(p.get("hairlineRaiseM", 0.0)))
    roots = spread(pts, int(p["count"]), seed)
    lo, hi = p.get("sizeM", (0.012, 0.018))
    off = float(p.get("offsetM", 0.008))
    shape = p.get("shape", "ico")
    bm = bmesh.new()
    for k, (c, n) in enumerate(roots):
        size = rnd.uniform(lo, hi)
        base = c + n * off
        if shape == "coil":
            coil(bm, base, n, size, float(p.get("turns", 1.6)), rnd.uniform(0, 6.28))
        elif shape == "knot":
            knot(bm, base, n, size, rnd.uniform(0, 6.28))
        else:
            r = Vector((size, size, size * float(p.get("squash", 0.8))))
            verts = ellipsoid(bm, base + n * size * 0.35, Vector((1, 1, 1)), int(p.get("subdiv", 1)))
            rot = _basis(n).to_3x3()
            centre = base + n * size * 0.35
            for v in verts:
                local = v.co - centre
                v.co = centre + rot @ Vector((local.x * r.x, local.y * r.y, local.z * r.z))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # closed tubes/blobs: outward per island
    faces = piece.merge(bm, region)
    bm.free()
    return faces
