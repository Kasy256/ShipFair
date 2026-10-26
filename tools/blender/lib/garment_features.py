"""Garment features added on top of the generated shell: colour panels, a lying-down hood, soles."""

from __future__ import annotations

import math
from typing import Any, Mapping

import bmesh
import bpy
from mathutils import Matrix, Vector

from .rig import BodyRig


def layers(bm: bmesh.types.BMesh) -> tuple[Any, Any]:
    """The face `region` (colour slot) and `part` (0 shell, 1 hood) int layers, created if missing."""
    fl = bm.faces.layers.int
    return fl.get("region") or fl.new("region"), fl.get("part") or fl.new("part")


def feature_panel(bm: bmesh.types.BMesh, rig: BodyRig, f: Mapping[str, Any], regions: Mapping[str, int]) -> int:
    """Re-colour (and push in or out) front faces inside a box or a V: jacket opening, lapels, pouch."""
    reg, _ = layers(bm)
    bm.normal_update()
    z0 = rig.bone(f["zFrom"][0]).z + f["zFrom"][1]
    z1 = rig.bone(f["zTo"][0]).z + f["zTo"][1]
    h0, h1 = f["halfWidthM"]
    for sx in (-1.0, 1.0):  # cut along the panel's side edges first, so they come out straight
        edge = Vector((sx * (h1 - h0), 0.0, z1 - z0))
        normal = Vector((edge.z, 0.0, -edge.x)).normalized() * sx
        front = [g for g in bm.faces if g.normal.y < -0.2 and z0 - 0.02 < g.calc_center_median().z < z1 + 0.02]
        geom = list({v for g in front for v in g.verts}) + list({e for g in front for e in g.edges}) + front
        if front:
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=Vector((sx * h0, 0.0, z0)), plane_no=normal)
    for z in (z0, z1):  # and along its top and bottom
        front = [g for g in bm.faces if g.normal.y < -0.2 and abs(g.calc_center_median().x) < max(h0, h1) + 0.03]
        geom = list({v for g in front for v in g.verts}) + list({e for g in front for e in g.edges}) + front
        if front:
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=Vector((0.0, 0.0, z)), plane_no=Vector((0, 0, 1)))
    bm.normal_update()
    hit = []
    for face in bm.faces:
        c = face.calc_center_median()
        if not z0 <= c.z <= z1 or face.normal.y > -0.3:
            continue
        t = (c.z - z0) / max(1e-6, z1 - z0)
        half = f["halfWidthM"][0] + (f["halfWidthM"][1] - f["halfWidthM"][0]) * t
        if abs(c.x) <= half:
            hit.append(face)
    verts = {v for face in hit for v in face.verts}
    bm.normal_update()
    for v in verts:
        v.co += v.normal * float(f.get("pushM", 0.0))
    for face in hit:
        face[reg] = regions[f["region"]]
    return len(hit)


def feature_hood(bm: bmesh.types.BMesh, rig: BodyRig, f: Mapping[str, Any], regions: Mapping[str, int]) -> int:
    """A hood lying down on the upper back: a tilted, open bowl behind the neck."""
    reg, part = layers(bm)
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=14, v_segments=9, radius=1.0)
    bmesh.ops.delete(tmp, geom=[v for v in tmp.verts if v.co.z > f.get("openZ", 0.25)], context="VERTS")
    rx, ry, rz = f["radiiM"]
    neck = rig.bone("neck_01")
    centre = neck + Vector(f["offsetM"])
    m = Matrix.Translation(centre) @ Matrix.Rotation(math.radians(f["tiltDeg"]), 4, "X") @ Matrix.Diagonal((rx, ry, rz, 1))
    tmp.transform(m)
    me = bpy.data.meshes.new("__hood")
    tmp.to_mesh(me)
    tmp.free()
    before = set(bm.faces)
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    new = [face for face in bm.faces if face not in before]
    for face in new:
        face[reg] = regions[f["region"]]
        face[part] = 1
    return len(new)


def feature_sole(bm: bmesh.types.BMesh, f: Mapping[str, Any], regions: Mapping[str, int]) -> int:
    """Flatten anything below the ground onto it and colour the bottom band as the sole."""
    reg, _ = layers(bm)
    for v in bm.verts:
        if v.co.z < f.get("groundM", 0.0):
            v.co.z = f.get("groundM", 0.0)
    n = 0
    for face in bm.faces:
        if face.calc_center_median().z < f["heightM"]:
            face[reg] = regions[f["region"]]
            n += 1
    return n


def apply_features(bm: bmesh.types.BMesh, rig: BodyRig, feats: list[Mapping[str, Any]], regions: Mapping[str, int],
                   stage: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for f in feats:
        if f.get("stage", "after_offset") != stage:
            continue
        kind = f["type"]
        if kind == "panel":
            out[f.get("name", kind)] = feature_panel(bm, rig, f, regions)
        elif kind == "hood":
            out[f.get("name", kind)] = feature_hood(bm, rig, f, regions)
        elif kind == "sole":
            out[f.get("name", kind)] = feature_sole(bm, f, regions)
        else:
            raise ValueError(f"unknown garment feature {kind!r}")
    return out
