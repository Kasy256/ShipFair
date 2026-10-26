"""Pose tests: does a garment hide what it hides, does skin poke through its hems, does hair sink in?

All measurements run on the evaluated (posed) meshes. Distances are metres; reports use cm.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .rig import BodyRig, pose, posed

RAY_UNDER_M = 0.05
RAY_PIERCE_M = 0.025
RAY_COVER_M = 0.08
RAY_BEHIND_M = 0.03


@dataclass
class PoseSet:
    """The test poses, resolved against the loaded clips. Missing clips use a stated substitute."""

    poses: list[tuple[str, Any, float]]
    notes: list[str] = field(default_factory=list)

    @classmethod
    def resolve(cls, cfg: Mapping[str, Any], actions: Mapping[str, Any]) -> "PoseSet":
        poses, notes = [], []
        for name, at in cfg["clips"]:
            act = actions.get(name)
            if act is None:
                sub = cfg.get("substitutes", {}).get(name)
                if sub and sub in actions:
                    notes.append(f"{name} missing from the clip set; tested {sub} in its place")
                    poses.append((f"{name}->{sub}", actions[sub], at))
                    continue
                notes.append(f"{name} missing from the clip set and has no substitute; not tested")
                continue
            poses.append((name, act, float(at)))
        if not poses:
            notes.append("no clips found: tests ran in the rest pose only")
            poses.append(("rest", None, 0.0))
        return cls(poses, notes)


def _vertex_faces(polys: Sequence[Sequence[int]], n: int) -> list[list[int]]:
    out: list[list[int]] = [[] for _ in range(n)]
    for fi, p in enumerate(polys):
        for v in p:
            out[v].append(fi)
    return out


def body_sets(rig: BodyRig, hides: int) -> tuple[set[int], set[int]]:
    """(hidden vertex ids, visible vertex ids) for one garment's `hides` bits."""
    hidden, visible = set(), set()
    for p in rig.body.data.polygons:
        (hidden if rig.face_mask[p.index] & hides else visible).update(p.vertices)
    return hidden, visible - hidden


def under_garment(rig: BodyRig, garment: bpy.types.Object, visible: set[int], outer: Sequence[bool]) -> list[int]:
    """Visible body vertices that sit under the garment at rest (a ray along the normal hits it)."""
    cos, nos, polys = posed(garment)
    bvh = BVHTree.FromPolygons(cos, [p for p, o in zip(polys, outer) if o])
    bcos, bnos, _ = posed(rig.body)
    out = []
    for i in visible:
        hit = bvh.ray_cast(bcos[i] + bnos[i] * 0.0005, bnos[i], RAY_UNDER_M)
        if hit[0] is not None:
            out.append(i)
    return out


def garment_pose(rig: BodyRig, garment: bpy.types.Object, outer: Sequence[bool], hidden: set[int],
                 under: Sequence[int]) -> dict[str, Any]:
    """In the current pose: deepest poke-through (cm), uncovered hidden vertices, offending places."""
    cos, _nos, polys = posed(garment)
    outer_polys = [p for p, o in zip(polys, outer) if o]
    outer_bvh = BVHTree.FromPolygons(cos, outer_polys)
    all_bvh = BVHTree.FromPolygons(cos, polys)
    bcos, bnos, _ = posed(rig.body)
    worst, spots = 0.0, []
    for i in under:
        p, n = bcos[i], bnos[i]
        hit, hn, fi, dist = outer_bvh.ray_cast(p, -n, RAY_PIERCE_M)
        if hit is not None and hn.dot(n) > 0.2:
            worst = max(worst, dist)
            spots.append((hit, dist, list(outer_polys[fi])))
    # Covered = garment surface along the outward normal, or just behind the (hidden) skin where
    # smoothing pulled the shell inside a bulge; either way the garment is what you see.
    uncovered = [i for i in hidden
                 if all_bvh.ray_cast(bcos[i] + bnos[i] * 0.0005, bnos[i], RAY_COVER_M)[0] is None
                 and all_bvh.ray_cast(bcos[i], -bnos[i], RAY_BEHIND_M)[0] is None]
    return {"penetrationCm": round(worst * 100, 2), "uncoveredPct": round(100 * len(uncovered) / max(1, len(hidden)), 2),
            "_spots": spots, "_uncovered": uncovered}


def push_garment(garment: bpy.types.Object, spots: Sequence[tuple[Vector, float, list[int]]], margin: float,
                 radius: float = 0.05) -> int:
    """Rest-pose fix: push the pierced face's vertices out by the depth (+ margin), and vertices
    within `radius` of the spot with a linear falloff. Outer and inner shell move together.
    """
    if not spots:
        return 0
    cos, _n, _p = posed(garment)
    me = garment.data
    half = len(me.vertices) // 2  # Solidify: vertex i (outer) pairs with i + half (inner)
    push: dict[int, float] = {}
    for spot, depth, face in spots:
        amount = depth + margin
        for i in face:
            j = i % half
            push[j] = max(push.get(j, 0.0), amount)
        for i, c in enumerate(cos[:half]):
            d = (c - spot).length
            if d < radius:
                push[i] = max(push.get(i, 0.0), amount * (1 - d / radius))
    for i, amount in push.items():
        n = me.vertices[i].normal.copy()
        me.vertices[i].co += n * amount
        if i + half < len(me.vertices):
            me.vertices[i + half].co += n * amount
    me.update()
    return len(push)


PARITY_DIRS = (Vector((0.31, 0.12, 0.94)).normalized(), Vector((-0.6, 0.77, 0.2)).normalized(),
               Vector((0.7, -0.5, -0.5)).normalized())


def _hits(bvh: BVHTree, origin: Vector, direction: Vector, reach: float = 3.0) -> int:
    count, p, left = 0, origin, reach
    while left > 0:
        hit, _n, _i, d = bvh.ray_cast(p, direction, left)
        if hit is None:
            break
        count += 1
        p = hit + direction * 1e-5
        left -= d + 1e-5
    return count


def inside(bvh: BVHTree, p: Vector) -> bool:
    """Ray parity, majority of three directions (robust around ears, fingers and open seams)."""
    return sum(_hits(bvh, p, d) % 2 for d in PARITY_DIRS) >= 2


def hair_pose(rig: BodyRig, hair: bpy.types.Object, ignore: set[int]) -> dict[str, Any]:
    """Deepest vertex of `hair` inside the posed body (cm). Points whose nearest body face is in
    `ignore` (the scalp a style sits on) are skipped."""
    cos, _n, _p = posed(hair)
    bcos, _bn, bpolys = posed(rig.body)
    bvh = BVHTree.FromPolygons(bcos, bpolys)
    worst, spots, where = 0.0, [], Vector()
    for i, c in enumerate(cos):
        loc, _nor, fi, dist = bvh.find_nearest(c, 0.1)
        if loc is None or fi in ignore or dist < 0.004 or not inside(bvh, c):
            continue
        spots.append((i, dist))
        if dist > worst:
            worst, where = dist, c
    out: dict[str, Any] = {"penetrationCm": round(worst * 100, 2), "_spots": spots}
    if worst > 0:
        out["worstAt"] = [round(x, 3) for x in where]
    return out


def push_hair(rig: BodyRig, hair: bpy.types.Object, spots: Sequence[tuple[int, float]], margin: float = 0.006,
              radius: float = 0.03) -> int:
    """Rest-pose fix: move sunken vertices (and neighbours, with falloff) out along the body normal."""
    me = hair.data
    mw = hair.matrix_world
    inv = mw.inverted()
    moves: dict[int, Vector] = {}
    cos = [mw @ v.co for v in me.vertices]
    for i, depth in spots:
        loc, n, _fi, _d = rig.bvh.find_nearest(cos[i], 0.2)
        if loc is None:
            continue
        for j, c in enumerate(cos):
            d = (c - cos[i]).length
            if d < radius:
                step = n * (depth + margin) * (1 - d / radius)
                if j not in moves or step.length > moves[j].length:
                    moves[j] = step
    for j, step in moves.items():
        me.vertices[j].co = inv @ (cos[j] + step)
    me.update()
    return len(moves)


def run_poses(rig: BodyRig, poses: PoseSet, fn: Any) -> dict[str, Any]:
    """Call `fn()` in every pose; returns {pose: result} and leaves the rig in its rest pose."""
    out = {}
    for name, action, at in poses.poses:
        pose(rig, action, at)
        out[name] = fn()
    pose(rig, None, 0.0)
    return out


def summarise(results: Mapping[str, Mapping[str, Any]], limit_cm: float) -> dict[str, Any]:
    pen = {k: v["penetrationCm"] for k, v in results.items()}
    worst = max(pen.values(), default=0.0)
    out: dict[str, Any] = {"maxPenetrationCm": worst, "perPose": pen, "pass": worst <= limit_cm}
    if any("worstAt" in v for v in results.values()):
        out["worstAt"] = {k: v["worstAt"] for k, v in results.items() if "worstAt" in v}
    if any("uncoveredPct" in v for v in results.values()):
        out["uncoveredPct"] = {k: v["uncoveredPct"] for k, v in results.items()}
    return out
