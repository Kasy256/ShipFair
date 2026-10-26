"""Shared pieces for the hair, facial hair and headwear generators.

A `HairCtx` holds the body rig, its head frame and BVH trees; a `Piece` is a bmesh whose faces carry a
colour-slot name. Generators add geometry to a Piece; `build.py` turns it into a weighted object.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping

import bmesh
import bpy
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

from ..headframe import HeadFrame
from ..rig import BodyRig


@dataclass
class HairCtx:
    rig: BodyRig
    hf: HeadFrame
    avatar: Mapping[str, Any]
    head_bvh: BVHTree

    @property
    def body_bvh(self) -> BVHTree:
        return self.rig.bvh


def make_ctx(rig: BodyRig, hf: HeadFrame, avatar: Mapping[str, Any]) -> HairCtx:
    bits = avatar["bodyMask"]["head"] | avatar["bodyMask"]["neck"]
    body = rig.body
    mw = body.matrix_world
    verts = [mw @ v.co for v in body.data.vertices]
    polys = [list(p.vertices) for p in body.data.polygons if rig.face_mask[p.index] & bits]
    return HairCtx(rig, hf, avatar, BVHTree.FromPolygons(verts, polys))


class Piece:
    """bmesh + per-face colour slot names."""

    def __init__(self) -> None:
        self.bm = bmesh.new()
        self.layer = self.bm.faces.layers.int.new("region")
        self.names: list[str] = ["HAIR"]

    def tag(self, faces: Iterable[bmesh.types.BMFace], region: str) -> None:
        if region not in self.names:
            self.names.append(region)
        k = self.names.index(region)
        for f in faces:
            f[self.layer] = k

    def mark(self) -> set[bmesh.types.BMFace]:
        return set(self.bm.faces)

    def since(self, before: set[bmesh.types.BMFace]) -> list[bmesh.types.BMFace]:
        return [f for f in self.bm.faces if f not in before]

    def merge(self, other: bmesh.types.BMesh, region: str) -> list[bmesh.types.BMFace]:
        """Copy another bmesh in (through a temporary mesh) and tag its faces."""
        me = bpy.data.meshes.new("__piece")
        other.to_mesh(me)
        before = self.mark()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        new = self.since(before)
        self.tag(new, region)
        return new

    def region_of(self, f: bmesh.types.BMFace) -> str:
        return self.names[f[self.layer]]


def head_bmesh(ctx: HairCtx, keep: Callable[[Vector], bool], zones: tuple[str, ...] = ("head", "neck")) -> bmesh.types.BMesh:
    """Welded copy of the body faces in `zones` whose centre passes `keep`."""
    bits = 0
    for z in zones:
        bits |= ctx.avatar["bodyMask"][z]
    rig = ctx.rig
    bm = bmesh.new()
    bm.from_mesh(rig.body.data)
    bm.transform(rig.body.matrix_world)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if not (rig.face_mask[f.index] & bits) or not keep(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    for layer in list(bm.verts.layers.deform):
        bm.verts.layers.deform.remove(layer)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def largest_island(bm: bmesh.types.BMesh) -> None:
    """Drop small disconnected bits (stray faces from a jagged selection)."""
    seen: set[bmesh.types.BMFace] = set()
    islands = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, island = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            island.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        islands.append(island)
    if len(islands) > 1:
        keep = max(islands, key=len)
        bmesh.ops.delete(bm, geom=[f for isl in islands if isl is not keep for f in isl], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")


def smooth(bm: bmesh.types.BMesh, iterations: int, factor: float = 0.5) -> None:
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(iterations):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)


def push_out(bvh: BVHTree, p: Vector, clearance: float, reach: float = 0.25) -> Vector:
    """`p` moved to at least `clearance` outside the surface in `bvh` (nearest-point test)."""
    loc, n, _i, _d = bvh.find_nearest(p, reach)
    if loc is None:
        return p
    d = (p - loc).dot(n)
    return p + n * (clearance - d) if d < clearance else p


def close_to_head(ctx: HairCtx, bm: bmesh.types.BMesh, gap: float = 0.0015) -> list[bmesh.types.BMFace]:
    """Extrude every open edge down onto the head surface, so a shell never shows its inside."""
    edges = [e for e in bm.edges if e.is_boundary]
    if not edges:
        return []
    res = bmesh.ops.extrude_edge_only(bm, edges=edges)
    new_verts = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in new_verts:
        loc, n, _i, _d = ctx.head_bvh.find_nearest(v.co, 0.05)
        if loc is not None:
            v.co = loc + n * gap
    return list({f for v in new_verts for f in v.link_faces})


def relax_loops(bm: bmesh.types.BMesh, iterations: int = 6) -> None:
    """Smooth jagged open edges (hairlines follow body triangles) along their loops."""
    verts = [v for v in bm.verts if v.is_boundary]
    for _ in range(iterations):
        moved = {}
        for v in verts:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                moved[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, co in moved.items():
            v.co = co


def surface_offset(ctx: HairCtx, bm: bmesh.types.BMesh, offset: Callable[[Vector], float]) -> None:
    """Place every vertex exactly `offset(p)` above the head (smoothing alone shrinks the shell inside)."""
    for v in bm.verts:
        loc, n, _i, _d = ctx.head_bvh.find_nearest(v.co, 0.1)
        if loc is not None:
            v.co = loc + n * offset(loc)


def flow_dir(ctx: HairCtx, p: Vector, normal: Vector, lift: float, back: float) -> Vector:
    """Direction hair leaves the scalp: down the surface, away from the face, slightly lifted."""
    c = ctx.hf.centre
    radial = Vector((p.x - c.x, p.y - c.y, 0.0))
    radial = radial.normalized() if radial.length > 1e-6 else Vector((0, 1, 0))
    if ctx.hf.u(p) < 0.45:  # hair in front of the ears parts to the sides, never over the face
        radial = Vector((1.0 if p.x >= 0 else -1.0, 1.0, 0.0)).normalized()
    want = Vector((0, 0, -1)) + radial * 0.6 + Vector((0, back, 0))
    tangent = want - normal * want.dot(normal)
    if tangent.length < 1e-6:
        tangent = radial
    return (tangent.normalized() + normal * lift).normalized()


def orient_out(ctx: HairCtx, bm: bmesh.types.BMesh, centre: Vector | None = None) -> None:
    """Consistent normals pointing away from the head (or from `centre` for free-standing blobs)."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    score = 0.0
    for f in bm.faces:
        c = f.calc_center_median()
        if centre is not None:
            ref = centre
        else:
            loc, _n, _i, _d = ctx.body_bvh.find_nearest(c, 0.5)
            ref = loc if loc is not None else ctx.hf.centre
        score += f.normal.dot(c - ref) * f.calc_area()
    if score < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)


def fbm(p: Vector, freq: float, seed: float, octaves: int = 2) -> float:
    """Smooth noise in about [-1, 1]; `seed` shifts the sample point so styles differ."""
    total, amp, f = 0.0, 1.0, freq
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for _ in range(octaves):
        total += amp * noise.noise((p + off) * f)
        amp *= 0.5
        f *= 2.0
    return total


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ellipsoid(bm: bmesh.types.BMesh, centre: Vector, radii: Vector, subdiv: int = 2) -> list[bmesh.types.BMVert]:
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in res["verts"]:
        v.co = centre + Vector((v.co.x * radii.x, v.co.y * radii.y, v.co.z * radii.z))
    return list(res["verts"])


def deg(a: float) -> float:
    return math.radians(a)
