"""Volume: an ellipsoid shaped by control values, lumpy noise and the head it sits on.

Used for afros, puffs, buns, curly mops and wavy volume. The shell is pushed clear of the head, the
face opening and anything below the cut height are removed, and open edges are closed onto the head.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

import bmesh
from mathutils import Vector

from .base import HairCtx, Piece, close_to_head, ease, ellipsoid, fbm, orient_out, push_out, relax_loops


def anchor(ctx: HairCtx, name: str) -> Vector:
    """Named places on the head volumes attach to (offsets are added by the config)."""
    hf = ctx.hf
    c = hf.centre
    return {
        "centre": c,
        "crown": Vector((0.0, c.y + 0.02, hf.top_z)),
        "top": Vector((0.0, c.y - 0.01, hf.top_z)),
        "back": Vector((0.0, hf.back_y, hf.eye_z + 0.02)),
        "nape": Vector((0.0, hf.back_y - 0.01, hf.nape_z + 0.03)),
        "backTop": Vector((0.0, hf.back_y - 0.02, hf.top_z - 0.04)),
    }[name]


def volume(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], region: str = "HAIR") -> list[bmesh.types.BMFace]:
    hf = ctx.hf
    bm = bmesh.new()
    centre = anchor(ctx, p.get("anchor", "centre")) + Vector(p.get("offsetM", (0, 0, 0)))
    radii = Vector(p["radiiM"])
    ellipsoid(bm, centre, radii, int(p.get("subdiv", 3)))
    lumps = p.get("lumps")
    clearance = float(p.get("clearanceM", 0.006))
    for v in bm.verts:
        d = (v.co - centre)
        dn = d.normalized()
        if lumps:
            amp = float(lumps["ampM"])
            v.co += dn * amp * fbm(v.co, float(lumps.get("freq", 18)), float(lumps.get("seed", 1)))
        if p.get("flatBottom") and v.co.z < centre.z - radii.z * float(p["flatBottom"]):
            v.co.z = centre.z - radii.z * float(p["flatBottom"])
        if p.get("hugFace", True):  # pull the volume onto the head around the face: no cliff at the temples
            reach = float(p.get("hugHeightM", 0.1))
            w = ease((0.6 - hf.u(v.co)) / 0.18) * ease((hf.hairline_front_z + reach - v.co.z) / reach)
            if w > 0:
                loc, nor, _i, _d = ctx.head_bvh.find_nearest(v.co, 0.4)
                if loc is not None:
                    v.co = v.co.lerp(loc + nor * clearance, w)
        if p.get("conform", True):
            v.co = push_out(ctx.head_bvh, v.co, clearance)
    drop = []
    cut_z = p.get("cutBelow")
    for f in bm.faces:
        c = f.calc_center_median()
        if p.get("faceCut", True) and hf.face_open(c, float(p.get("faceMarginM", 0.0))):
            drop.append(f)
        elif cut_z is not None and c.z < {"nape": hf.nape_z, "chin": hf.chin_z, "ear": hf.ear_top_z}.get(cut_z, hf.nape_z) + float(p.get("cutShiftM", 0.0)):
            drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if drop:
        relax_loops(bm, 4)
    if drop and p.get("close", True):
        close_to_head(ctx, bm)
    orient_out(ctx, bm, None if drop else centre)
    faces = piece.merge(bm, region)
    if p.get("curls"):
        faces += curls(ctx, piece, bm_surface_points(faces), p["curls"], region)
    bm.free()
    return faces


def bm_surface_points(faces: list[bmesh.types.BMFace]) -> list[tuple[Vector, Vector]]:
    return [(f.calc_center_median(), f.normal.copy()) for f in faces if f.is_valid and f.calc_area() > 1e-6]


def curls(ctx: HairCtx, piece: Piece, pts: list[tuple[Vector, Vector]], c: Mapping[str, Any], region: str) -> list[bmesh.types.BMFace]:
    """Curl clumps scattered over a volume's outer surface: breaks up the silhouette."""
    import random

    from .strands import spread

    rnd = random.Random(int(c.get("seed", 3)))
    outer = [(q, n) for q, n in pts if (q - ctx.hf.centre).dot(n) > 0 and not ctx.hf.face_open(q, 0.01)]
    bm = bmesh.new()
    lo, hi = c.get("sizeM", (0.014, 0.022))
    for q, n in spread(outer, int(c["count"]), int(c.get("seed", 3))):
        r = rnd.uniform(lo, hi)
        centre = q + n * r * float(c.get("sink", 0.25))
        ellipsoid(bm, centre, Vector((r, r, r * 0.85)), int(c.get("subdiv", 1)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    faces = piece.merge(bm, region)
    bm.free()
    return faces


def bun(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], region: str = "HAIR") -> list[bmesh.types.BMFace]:
    """A small free-standing knot (bun, puff, Bantu knot) with an optional twist groove."""
    bm = bmesh.new()
    centre = anchor(ctx, p.get("anchor", "crown")) + Vector(p.get("offsetM", (0, 0, 0)))
    radii = Vector(p["radiiM"])
    ellipsoid(bm, centre, radii, int(p.get("subdiv", 2)))
    twist = float(p.get("twistM", 0.0))
    for v in bm.verts:
        d = v.co - centre
        if twist:
            a = math.atan2(d.y, d.x)
            v.co += d.normalized() * twist * math.sin(3 * a + 8 * d.z / max(1e-6, radii.z))
        if p.get("lumps"):
            v.co += d.normalized() * float(p["lumps"]["ampM"]) * fbm(v.co, float(p["lumps"].get("freq", 25)), float(p["lumps"].get("seed", 2)))
    orient_out(ctx, bm, centre)
    faces = piece.merge(bm, region)
    bm.free()
    return faces
