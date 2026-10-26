"""Cloth wrap pieces for headwear: brims, gele pleats, turban wraps and colour bands.

The wrap shell itself is a scalp shell (`area: wrap` covers head + neck around the face opening) with
a `curtain` drape; these helpers add what a shell can't: a cap brim, sculpted pleats, layered bands.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

import bmesh
import bpy
from mathutils import Matrix, Vector

from .base import HairCtx, Piece, ellipsoid, push_out
from .volume import anchor
from ..sweep import circle, sweep


def brim(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], region: str = "ACCENT2") -> list[bmesh.types.BMFace]:
    """A cap peak: a curved half-disc in front of the forehead at the band, slightly drooping."""
    hf = ctx.hf
    bm = bmesh.new()
    depth = float(p.get("depthM", 0.075))
    width = hf.half_w + float(p.get("widenM", 0.012))
    z0 = hf.hairline_front_z + float(p.get("zShiftM", 0.0))
    y0 = hf.front_y + float(p.get("backM", 0.03))
    rings = []
    segs = 12
    for r in (0.0, 0.5, 1.0):
        ring = []
        for i in range(segs + 1):
            a = math.pi * i / segs
            x = -width * math.cos(a)
            reach = depth * r * math.sin(a) ** 0.6
            y = y0 - reach - (0.0 if r else 0.0)
            base = Vector((x, y0 - abs(math.sin(a)) * 0.0, z0))
            q = Vector((x, y, z0 - float(p.get("droopM", 0.012)) * r * r))
            if r == 0.0:
                loc, nor, _i, _d = ctx.body_bvh.find_nearest(base, 0.3)
                q = (loc + nor * float(p.get("offsetM", 0.016))) if loc is not None else base
                q.z = z0
            ring.append(q)
        rings.append(ring)
    t = float(p.get("thicknessM", 0.006))
    top = [[bm.verts.new(q) for q in ring] for ring in rings]
    bot = [[bm.verts.new(q - Vector((0, 0, t))) for q in ring] for ring in rings]
    for a, b in zip(range(len(rings) - 1), range(1, len(rings))):
        for i in range(segs):
            bm.faces.new((top[a][i], top[a][i + 1], top[b][i + 1], top[b][i]))
            bm.faces.new((bot[a][i], bot[b][i], bot[b][i + 1], bot[a][i + 1]))
    last = len(rings) - 1
    for i in range(segs):
        bm.faces.new((top[last][i], top[last][i + 1], bot[last][i + 1], bot[last][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    faces = piece.merge(bm, region)
    bm.free()
    return faces


def pleats(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], region: str = "ACCENT") -> list[bmesh.types.BMFace]:
    """Gele: a fan of flattened lobes rising from the crown, each tilted outward."""
    bm = bmesh.new()
    base = anchor(ctx, p.get("anchor", "crown")) + Vector(p.get("offsetM", (0, 0.0, -0.01)))
    n = int(p.get("count", 6))
    spread_deg = float(p.get("spreadDeg", 150))
    rx, ry, rz = p.get("lobeM", (0.07, 0.025, 0.11))
    for i in range(n):
        a = math.radians(-spread_deg / 2 + spread_deg * i / max(1, n - 1))
        lobe = bmesh.new()
        ellipsoid(lobe, Vector((0, 0, rz * 0.8)), Vector((rx, ry, rz)), 2)
        m = Matrix.Translation(base) @ Matrix.Rotation(a, 4, "Y") @ Matrix.Rotation(math.radians(p.get("tiltDeg", 20)), 4, "X")
        lobe.transform(m)
        for v in lobe.verts:
            v.co = push_out(ctx.head_bvh, v.co, 0.01)
        me = bpy.data.meshes.new("__lobe")
        lobe.to_mesh(me)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        lobe.free()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    faces = piece.merge(bm, region)
    bm.free()
    return faces


def wraps(ctx: HairCtx, piece: Piece, p: Mapping[str, Any], regions: Sequence[str] = ("ACCENT",)) -> list[bmesh.types.BMFace]:
    """Turban: tilted bands wound around the head, each a swept flattened tube."""
    hf = ctx.hf
    out = []
    layers = p.get("layers", [])
    for k, layer in enumerate(layers):
        bm = bmesh.new()
        tilt = math.radians(layer.get("tiltDeg", 0))
        z = hf.eye_z + float(layer["aboveEyesM"])
        pts = []
        segs = 20
        for i in range(segs + 1):
            a = 2 * math.pi * i / segs
            q = Vector((math.cos(a) * (hf.half_w + 0.03), hf.centre.y + math.sin(a) * ((hf.back_y - hf.front_y) / 2 + 0.03),
                        z + math.sin(a) * math.tan(tilt) * 0.09))
            pts.append(push_out(ctx.head_bvh, q, float(layer.get("clearanceM", 0.018))))
        w, h = layer.get("sectionM", (0.016, 0.03))
        sweep(bm, pts, lambda t, w=w, h=h: circle(w, 6, h / w), cap_start=False, cap_end=False, up=Vector((0, 0, 1)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        out += piece.merge(bm, regions[k % len(regions)] if not layer.get("region") else layer["region"])
        bm.free()
    return out


def band(ctx: HairCtx, piece: Piece, faces: Sequence[bmesh.types.BMFace], p: Mapping[str, Any]) -> int:
    """Re-colour the faces of a part that sit near its lower edge (cuff, band, hem)."""
    hf = ctx.hf
    height = float(p.get("heightM", 0.02))
    ref = p.get("ref", "hairline")
    n = 0
    for f in faces:
        if not f.is_valid:
            continue
        c = f.calc_center_median()
        line = hf.band_z(c) if ref == "band" else hf.hairline_z(c)
        if c.z < line + height and c.z > line - float(p.get("belowM", 0.08)):
            piece.tag([f], p["region"])
            n += 1
    return n
