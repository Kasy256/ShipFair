"""Strand curves: roots sampled on the scalp, a gravity/flow path, a swept profile with taper.

Profiles: round (locs), square (box braids, twisting), twist (two-lobe two-strand twists), ribbon
(broad flat strands for wavy and straight styles). Paths can hang (gravity), follow the scalp
(`surface`: cornrows), converge on a point (`gather`: ponytails, updos), wave or curl into helices.
"""

from __future__ import annotations

import math
import random
from typing import Any, Callable, Mapping, Sequence

import bmesh
from mathutils import Vector

from .base import HairCtx, Piece, ellipsoid, flow_dir, push_out
from .volume import anchor
from ..sweep import circle, rect, sweep, two_lobe


def scalp_points(ctx: HairCtx, region: str, raise_m: float = 0.0) -> list[tuple[Vector, Vector]]:
    """(point, normal) at the centre of every hair-bearing head face in `region`."""
    hf = ctx.hf
    rig = ctx.rig
    head = ctx.avatar["bodyMask"]["head"]
    mw = rig.body.matrix_world
    out = []
    for p in rig.body.data.polygons:
        if not rig.face_mask[p.index] & head:
            continue
        c = mw @ p.center
        if c.z < hf.hairline_z(c, raise_m):
            continue
        u = hf.u(c)
        ok = {"all": True, "back": u > 0.5, "sides": abs(c.x) > hf.half_w * 0.55,
              "crown": c.z > hf.band_z(c), "front": u < 0.35, "lower": c.z < hf.eye_z + 0.03 or u > 0.7,
              "ring": c.z < hf.band_z(c) + 0.01}.get(region, True)
        if ok:
            out.append((c, (mw.to_3x3() @ p.normal).normalized()))
    return out


def spread(points: Sequence[tuple[Vector, Vector]], count: int, seed: int) -> list[tuple[Vector, Vector]]:
    """Farthest-point sampling: `count` roots spread evenly over `points`."""
    if not points:
        return []
    rnd = random.Random(seed)
    chosen = [points[rnd.randrange(len(points))]]
    dist = [(p[0] - chosen[0][0]).length for p in points]
    while len(chosen) < min(count, len(points)):
        i = max(range(len(points)), key=dist.__getitem__)
        chosen.append(points[i])
        for j, p in enumerate(points):
            d = (p[0] - points[i][0]).length
            if d < dist[j]:
                dist[j] = d
    return chosen


def hang_path(ctx: HairCtx, root: Vector, normal: Vector, p: Mapping[str, Any], seed: int) -> list[Vector]:
    """Leave the scalp along the normal (+ flow), bend down with gravity, stay outside the body."""
    n = int(p.get("segments", 8))
    step = float(p["lengthM"]) / n
    flow = Vector(p.get("flow", (0, 0, 0)))
    if p.get("mode", "hang") == "point":
        out_dir = (normal + flow).normalized()
    else:
        out_dir = (flow_dir(ctx, root, normal, float(p.get("lift", 0.25)), float(p.get("back", 0.3))) + flow).normalized()
    gravity = float(p.get("gravity", 0.35))
    clear = float(p.get("clearanceM", 0.012))
    jitter = float(p.get("jitterM", 0.0))
    rnd = random.Random(seed)
    lengthen = 1.0 + rnd.uniform(-float(p.get("lengthVar", 0.0)), float(p.get("lengthVar", 0.0)))
    pts = [root + normal * float(p.get("offsetM", 0.004))]
    d = out_dir
    for _ in range(n):
        d = (d + Vector((0, 0, -gravity))).normalized()
        nxt = pts[-1] + d * step * lengthen
        if jitter:
            nxt += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * jitter
        nxt = push_out(ctx.body_bvh, nxt, clear)
        nxt = push_out(ctx.head_bvh, nxt, clear + float(p.get("headClearanceM", 0.004)))
        d = (nxt - pts[-1]).normalized() if (nxt - pts[-1]).length > 1e-6 else d
        pts.append(nxt)
    return pts


def surface_path(ctx: HairCtx, root: Vector, p: Mapping[str, Any], target: Vector | None) -> list[Vector]:
    """Walk over the head surface (cornrows): toward `target` or along `flow`, re-projected each step."""
    n = int(p.get("segments", 12))
    step = float(p["lengthM"]) / n
    flow = Vector(p.get("flow", (0, 1, 0)))
    off = float(p.get("offsetM", 0.004))
    pts = []
    cur = root
    for _ in range(n + 1):
        loc, nor, _i, _d = ctx.head_bvh.find_nearest(cur, 0.3)
        if loc is None:
            break
        cur = loc + nor * off
        pts.append(cur)
        want = (target - cur) if target is not None else flow
        tangent = want - nor * want.dot(nor)
        if tangent.length < 1e-6:
            break
        cur = cur + tangent.normalized() * step
    return pts


def wave(pts: list[Vector], amp: float, freq: float, phase: float, side: Vector) -> list[Vector]:
    out = []
    total = len(pts) - 1 or 1
    for i, q in enumerate(pts):
        t = i / total
        out.append(q + side * amp * t * math.sin(phase + freq * t * 2 * math.pi))
    return out


def helix(pts: list[Vector], radius: float, turns: float, phase: float) -> list[Vector]:
    """Wrap a path into a spiral (ringlets); resampled finer so the coil reads."""
    fine: list[Vector] = []
    for a, b in zip(pts, pts[1:]):
        for k in range(3):
            fine.append(a.lerp(b, k / 3))
    fine.append(pts[-1])
    out = []
    total = len(fine) - 1 or 1
    for i, q in enumerate(fine):
        t = i / total
        a = phase + turns * 2 * math.pi * t
        tan = (fine[min(i + 1, total)] - fine[max(i - 1, 0)]).normalized()
        side = tan.cross(Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        up = tan.cross(side).normalized()
        out.append(q + (side * math.cos(a) + up * math.sin(a)) * radius * min(1.0, t * 4))
    return out


def profile_fn(p: Mapping[str, Any], seed: int) -> Callable[[float], Sequence[tuple[float, float]]]:
    kind = p.get("profile", "round")
    r = float(p.get("radiusM", 0.008))
    end = float(p.get("taper", 0.6))
    sides = int(p.get("sides", 5))
    twist = float(p.get("twistTurns", 3.0))
    bumps = float(p.get("braidBumps", 0.0))
    phase0 = seed * 0.7

    def scale(t: float) -> float:
        s = 1.0 + (end - 1.0) * t
        if bumps:
            s *= 1.0 + 0.18 * math.cos(bumps * 2 * math.pi * t)
        return s

    if kind == "ribbon":
        w = float(p.get("widthM", 0.035))
        return lambda t: [(x * scale(t) ** 0.5, y) for x, y in rect(w, r * 2)]
    if kind == "square":
        return lambda t: circle(r * scale(t), 4, 1.0, phase0 + twist * 2 * math.pi * t + math.pi / 4)
    if kind == "twist":
        return lambda t: [(x * scale(t), y * scale(t)) for x, y in two_lobe(r, phase0 + twist * 2 * math.pi * t)]
    return lambda t: circle(r * scale(t), sides, float(p.get("squash", 1.0)), phase0)


def strands(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], region: str = "HAIR") -> list[bmesh.types.BMFace]:
    seed = int(p.get("seed", 7))
    rnd = random.Random(seed)
    bm = bmesh.new()
    bead_bm = bmesh.new()
    mode = p.get("mode", "hang")
    target = None
    if p.get("gather"):
        g = p["gather"]
        target = anchor(ctx, g.get("anchor", "crown")) + Vector(g.get("offsetM", (0, 0, 0)))
    if mode == "rows":
        roots = rows(ctx, p)
    elif mode == "point":
        roots = point_roots(ctx, p, rnd)
    else:
        pts = scalp_points(ctx, p.get("on", "all"), float(p.get("hairlineRaiseM", 0.0)))
        pts = [q for q in pts if ctx.hf.u(q[0]) >= float(p.get("minU", 0.0))]  # keep long strands off the face
        roots = spread(pts, int(p["count"]), seed)
    for k, (root, normal) in enumerate(roots):
        if mode in ("surface", "rows"):
            path = surface_path(ctx, root, p, target)
        elif target is not None:
            path = gather_path(ctx, root, target, p)
        else:
            path = hang_path(ctx, root, normal, p, seed + k)
        if len(path) < 2:
            continue
        side = (path[-1] - path[0]).cross(Vector((0, 0, 1)))
        side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
        if p.get("wave"):
            path = wave(path, float(p["wave"]["ampM"]), float(p["wave"].get("freq", 2.0)), rnd.uniform(0, 6.28), side)
        if p.get("curl"):
            path = helix(path, float(p["curl"]["radiusM"]), float(p["curl"].get("turns", 5)), rnd.uniform(0, 6.28))
        if p.get("collide", True) and mode in ("hang", "point"):
            path = [path[0]] + [push_out(ctx.body_bvh, q, float(p.get("clearanceM", 0.012))) for q in path[1:]]
        sweep(bm, path, profile_fn(p, seed + k), cap_start=False, cap_end=True, up=normal)
        bead = p.get("bead")
        if bead:
            tip = path[-1]
            d = (path[-1] - path[-2]).normalized()
            ellipsoid(bead_bm, tip + d * float(bead.get("lengthM", 0.012)) * 0.5,
                      Vector((1, 1, 1)) * float(bead.get("radiusM", 0.007)), 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # closed tubes/blobs: outward per island
    faces = piece.merge(bm, region)
    bm.free()
    if len(bead_bm.verts):
        bmesh.ops.recalc_face_normals(bead_bm, faces=bead_bm.faces)
        faces += piece.merge(bead_bm, p["bead"].get("region", "ACCENT"))
    bead_bm.free()
    return faces


def point_roots(ctx: HairCtx, p: Mapping[str, Any], rnd: random.Random) -> list[tuple[Vector, Vector]]:
    """Roots clustered around one anchor (a ponytail's tie, a durag's knot); they leave along `flow`."""
    centre = anchor(ctx, p.get("anchor", "crown")) + Vector(p.get("anchorOffsetM", (0, 0, 0)))
    flow = Vector(p.get("flow", (0, 1, 0))).normalized()
    r = float(p.get("spreadM", 0.012))
    out = []
    for k in range(int(p["count"])):
        a = 2 * math.pi * k / max(1, int(p["count"])) + rnd.uniform(-0.3, 0.3)
        side = flow.cross(Vector((0, 0, 1)))
        side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
        up = side.cross(flow).normalized()
        out.append((centre + (side * math.cos(a) + up * math.sin(a)) * r, flow))
    return out


def gather_path(ctx: HairCtx, root: Vector, target: Vector, p: Mapping[str, Any]) -> list[Vector]:
    """Over the scalp toward the gather point (hair pulled into a pony or bun)."""
    n = int(p.get("segments", 8))
    pts = []
    for i in range(n + 1):
        q = root.lerp(target, i / n)
        loc, nor, _i, _d = ctx.head_bvh.find_nearest(q, 0.3)
        if loc is not None:
            lift = float(p.get("offsetM", 0.004)) + float(p.get("bulgeM", 0.004)) * math.sin(math.pi * i / n)
            q = q if (q - loc).dot(nor) > lift else loc + nor * lift
        pts.append(q)
    return pts


def rows(ctx: HairCtx, p: Mapping[str, Any]) -> list[tuple[Vector, Vector]]:
    """Cornrow starts: evenly spaced along the front hairline (or a side part line)."""
    hf = ctx.hf
    n = int(p["count"])
    half = hf.half_w * float(p.get("rowSpan", 0.95))
    out = []
    for i in range(n):
        x = -half + 2 * half * (i + 0.5) / n
        start = Vector((x, hf.front_y - 0.02, hf.hairline_front_z + 0.005 - abs(x) * 0.25))
        loc, nor, _i, _d = ctx.head_bvh.find_nearest(start, 0.3)
        if loc is not None:
            out.append((loc, nor))
    return out
