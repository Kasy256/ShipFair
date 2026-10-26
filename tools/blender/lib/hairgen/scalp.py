"""Scalp shell: the head's hair-bearing faces, offset outward with a per-vertex falloff.

Covers buzz cuts, fades, flat tops, slicked styles and cornrow bases; `curtain` extends the lower
edge downwards (bobs, long straight and wavy styles) and `fringe` drops the front edge over the
forehead. Every open edge is closed back onto the head, so the shell never shows its inside.
"""

from __future__ import annotations

from typing import Any, Mapping

import bmesh
from mathutils import Vector

from .base import (HairCtx, Piece, close_to_head, ease, fbm, head_bmesh, largest_island, orient_out, push_out, relax_loops,
                   smooth, surface_offset)


def _select(ctx: HairCtx, p: Mapping[str, Any]):
    hf = ctx.hf
    raise_m = float(p.get("hairlineRaiseM", 0.0))
    area = p.get("area", "hair")
    side_limit = p.get("sideLimitM")

    def facial(c: Vector) -> bool:
        u, m = hf.u(c), hf.mouth_z
        lip = abs(c.x) < 0.03 and abs(c.z - m) < 0.006
        moustache = abs(c.x) < 0.033 and m + 0.004 < c.z < m + 0.021 and u < 0.25
        if area == "moustache":
            return moustache
        if area == "goatee":
            return moustache or (abs(c.x) < 0.028 and c.z < m - 0.006 and u < 0.32)
        if area == "chinstrap":
            return u < 0.56 and c.z < hf.chin_z + 0.012 + u * 0.075 and c.z < m - 0.01 and c.y < hf.centre.y + 0.01
        beard = u < 0.56 and c.z < m + 0.03 + u * 0.05 and c.y < hf.centre.y + 0.01 and not lip
        return beard and (moustache or c.z < m + 0.004 or abs(c.x) > 0.033)

    def keep(c: Vector) -> bool:
        if area in ("beard", "moustache", "goatee", "chinstrap"):
            return facial(c) and (c.z > hf.chin_z - 0.035)
        if area == "crown" and c.z < hf.band_z(c) + float(p.get("crownLiftM", 0.0)):
            return False
        if area == "top" and c.z < hf.ear_top_z + float(p.get("topAboveEarM", 0.03)):
            return False
        if side_limit is not None and abs(c.x) > float(side_limit):
            return False
        if area == "wrap":
            return not hf.face_open(c, -0.004) and c.z > hf.chin_z - 0.06
        return c.z > hf.hairline_z(c, raise_m)

    return keep


def offset_for(ctx: HairCtx, p: Mapping[str, Any], co: Vector) -> float:
    """Base offset, faded from `sidesM` (at the ear line) to the full offset (at the top)."""
    hf = ctx.hf
    base = float(p.get("offsetM", 0.004))
    fade = p.get("fade")
    if fade:
        lo = hf.ear_top_z + float(fade.get("fromAboveEarM", 0.0))
        hi = hf.ear_top_z + float(fade.get("toAboveEarM", 0.05))
        t = ease((co.z - lo) / max(1e-6, hi - lo))
        base = float(fade["sidesM"]) + (base - float(fade["sidesM"])) * t
    crown = p.get("crown")
    if crown:  # extra height on top: quiffs, flat tops, curly tops
        t = ease((co.z - (hf.top_z - float(crown.get("depthM", 0.05)))) / float(crown.get("depthM", 0.05)))
        front = 1.0 + float(crown.get("frontBias", 0.0)) * (1.0 - min(1.0, max(0.0, hf.u(co))))
        base += float(crown["extraM"]) * t * front
    noise = p.get("noise")
    if noise:
        base += float(noise["ampM"]) * fbm(co, float(noise.get("freq", 30)), float(noise.get("seed", 1)))
    return max(0.0008, base)


def flatten_top(bm: bmesh.types.BMesh, z: float) -> None:
    for v in bm.verts:
        if v.co.z > z:
            v.co.z = z


def curtain(ctx: HairCtx, bm: bmesh.types.BMesh, c: Mapping[str, Any]) -> list[bmesh.types.BMFace]:
    """Extend the lower (sides and back) edge downwards in rows, flaring out and falling past the body."""
    hf = ctx.hf
    min_u = float(c.get("fromU", 0.3))
    top = hf.chin_z + float(c["belowChinM"]) if "belowChinM" in c else hf.ear_top_z + 0.04
    edges = [e for e in bm.edges if e.is_boundary and all(hf.u(v.co) > min_u or v.co.z < hf.eye_z for v in e.verts)
             and all(v.co.z < top for v in e.verts)]
    rows = int(c.get("rows", 4))
    length = float(c["lengthM"])
    flare = float(c.get("flareM", 0.02))
    jag = float(c.get("jagM", 0.0))
    made: list[bmesh.types.BMFace] = []
    centre = Vector((0.0, hf.centre.y, 0.0))
    for r in range(rows):
        if not edges:
            break
        res = bmesh.ops.extrude_edge_only(bm, edges=edges)
        new_verts = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        new_edges = [g for g in res["geom"] if isinstance(g, bmesh.types.BMEdge)]
        t = (r + 1) / rows
        for v in new_verts:
            radial = Vector((v.co.x - centre.x, v.co.y - centre.y, 0.0))
            radial = radial.normalized() if radial.length > 1e-6 else Vector((0, 1, 0))
            step = length / rows
            v.co += Vector((0, 0, -step)) + radial * (flare / rows) * (1.0 + 0.5 * t)
            if c.get("waveM"):
                v.co += radial * float(c["waveM"]) * fbm(v.co, float(c.get("waveFreq", 9)), 3.0 + r)
            if r == rows - 1 and jag:
                v.co.z -= jag * (0.5 + 0.5 * fbm(v.co, 40.0, 5.0))
            v.co = push_out(ctx.body_bvh, v.co, float(c.get("clearanceM", 0.03)))
        made += list({f for v in new_verts for f in v.link_faces})
        edges = [e for e in new_edges if e.is_boundary and all(v in new_verts for v in e.verts)]
        relax_loops(bm, 2)
    return made


def fringe(ctx: HairCtx, bm: bmesh.types.BMesh, f: Mapping[str, Any]) -> list[bmesh.types.BMFace]:
    """Drop the front hairline edge over the forehead (bangs)."""
    hf = ctx.hf
    edges = [e for e in bm.edges if e.is_boundary and all(hf.u(v.co) < float(f.get("toU", 0.3)) for v in e.verts)]
    if not edges:
        return []
    res = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new_verts = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    bottom = hf.eye_z + float(f.get("aboveEyesM", 0.025))
    side = float(f.get("sweep", 0.0))
    for v in new_verts:
        target = max(bottom, v.co.z - float(f.get("lengthM", 0.05)))
        v.co.z = target + side * v.co.x
        v.co = push_out(ctx.body_bvh, v.co, float(f.get("clearanceM", 0.008)))
    return list({fc for v in new_verts for fc in v.link_faces})


def scalp(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], region: str = "HAIR") -> list[bmesh.types.BMFace]:
    zones = ("head", "neck") if p.get("area") in ("wrap", "beard", "chinstrap") else ("head",)
    bm = head_bmesh(ctx, _select(ctx, p), zones)
    largest_island(bm)
    relax_loops(bm, int(p.get("relax", 6)))
    smooth(bm, int(p.get("smooth", 2)))
    surface_offset(ctx, bm, lambda q: offset_for(ctx, p, q))
    if p.get("flattenTopM") is not None:
        flatten_top(bm, ctx.hf.top_z + float(p["flattenTopM"]))
    if p.get("fringe"):
        fringe(ctx, bm, p["fringe"])
    if p.get("curtain"):
        curtain(ctx, bm, p["curtain"])
    if p.get("close", True):
        close_to_head(ctx, bm)
    orient_out(ctx, bm)
    faces = piece.merge(bm, region)
    bm.free()
    return faces
