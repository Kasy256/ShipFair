"""Procedural accessories (headphones, glasses, backpack, lanyard) and sandals, fitted to a body rig."""

from __future__ import annotations

from typing import Any, Callable, Mapping

import bmesh
import bpy
from mathutils import Vector

from .attributes import set_corner_uv, set_face_attr
from .geometry import convex_hull
from .headframe import HeadFrame
from .rig import BodyRig, assign, bind, transfer_weights
from .sweep import circle, rect, sweep


class Part:
    """A bmesh whose faces carry a colour-slot name."""

    def __init__(self) -> None:
        self.bm = bmesh.new()
        self.layer = self.bm.faces.layers.int.new("region")
        self.names: list[str] = []

    def tag(self, faces: list[bmesh.types.BMFace], region: str) -> None:
        if region not in self.names:
            self.names.append(region)
        for f in faces:
            f[self.layer] = self.names.index(region)

    def new_faces(self, before: set[bmesh.types.BMFace]) -> list[bmesh.types.BMFace]:
        return [f for f in self.bm.faces if f not in before]

    def to_object(self, name: str, avatar: Mapping[str, Any]) -> bpy.types.Object:
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        regions = [avatar["regions"][self.names[f[self.layer]]] for f in self.bm.faces]
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for p in me.polygons:
            p.use_smooth = True
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        set_face_attr(obj, avatar["attributes"]["region"], regions)
        set_face_attr(obj, avatar["attributes"]["mask"], [0.0] * len(regions))
        return obj


def push_out(rig: BodyRig, p: Vector, clearance: float) -> Vector:
    """Move `p` so it is at least `clearance` outside the body surface."""
    loc, n, _i, _d = rig.bvh.find_nearest(p)
    if loc is None:
        return p
    d = (p - loc).dot(n)
    return p + n * (clearance - d) if d < clearance else p


def smooth_path(points: list[Vector], steps: int = 4) -> list[Vector]:
    """Catmull-Rom through `points`."""
    out: list[Vector] = []
    pts = [points[0], *points, points[-1]]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(steps):
            t = s / steps
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(points[-1])
    return out


def ray_y(rig: BodyRig, x: float, z: float, from_back: bool) -> float:
    origin = Vector((x, 1.0 if from_back else -1.0, z))
    hit, _n, _i, _d = rig.bvh.ray_cast(origin, Vector((0, -1 if from_back else 1, 0)), 2.0)
    return hit.y if hit is not None else (0.12 if from_back else -0.12)


def rigid(obj: bpy.types.Object, bone: str) -> None:
    groups: dict[str, bpy.types.VertexGroup] = {}
    for v in obj.data.vertices:
        assign(obj, groups, v.index, {bone: 1.0})


# -- items ---------------------------------------------------------------------------------------


def headphones(rig: BodyRig, hf: HeadFrame, part: Part) -> str:
    import math

    cz = hf.eye_z - 0.012
    r_x = hf.half_w + 0.02
    r_z = hf.top_z - cz + 0.02
    cy = hf.centre.y + 0.005
    path = [Vector((r_x * math.cos(a), cy, cz + r_z * math.sin(a)))
            for a in (math.pi * (0.06 + 0.88 * i / 16) for i in range(17))]
    before = set(part.bm.faces)
    sweep(part.bm, path, lambda t: rect(0.009, 0.024), up=Vector((0, 1, 0)), cap_start=True)
    for sx in (-1, 1):
        x0 = sx * (hf.half_w - 0.004)
        x1 = sx * (hf.half_w + 0.03)
        sweep(part.bm, [Vector((x0, cy, cz)), Vector((x1, cy, cz))], lambda t: circle(0.037, 12),
              cap_start=True, up=Vector((0, 0, 1)))
    part.tag(part.new_faces(before), "ACCESSORY")
    return "Head"


def glasses(rig: BodyRig, hf: HeadFrame, part: Part) -> str:
    import math

    y = hf.eye_front_y - 0.013
    before = set(part.bm.faces)
    for sx in (-1, 1):
        ex = sx * (hf.eye_half_x * 0.55)
        ring = [Vector((ex + 0.022 * math.cos(a), y, hf.eye_z + 0.018 * math.sin(a)))
                for a in (2 * math.pi * i / 14 for i in range(15))]
        sweep(part.bm, ring, lambda t: circle(0.0028, 4), cap_end=False, up=Vector((0, 1, 0)))
        outer = Vector((ex + sx * 0.022, y, hf.eye_z + 0.004))
        ear = Vector((sx * (hf.half_w + 0.003), hf.centre.y + 0.01, hf.eye_z - 0.004))
        sweep(part.bm, [outer, outer.lerp(ear, 0.5) + Vector((sx * 0.004, 0, 0.002)), ear],
              lambda t: rect(0.004, 0.003), up=Vector((0, 0, 1)), cap_start=True)
    inner = hf.eye_half_x * 0.55 - 0.022
    sweep(part.bm, [Vector((-inner, y, hf.eye_z + 0.006)), Vector((0, y - 0.002, hf.eye_z + 0.009)),
                    Vector((inner, y, hf.eye_z + 0.006))], lambda t: circle(0.0025, 4), cap_start=True)
    part.tag(part.new_faces(before), "ACCESSORY")
    return "Head"


def backpack(rig: BodyRig, hf: HeadFrame, part: Part) -> str:
    spine = rig.bone("spine_03")
    back = ray_y(rig, 0.0, spine.z, from_back=True)
    w, d, h = 0.28, 0.13, 0.38
    cy = back + 0.032 + d / 2
    cz = spine.z + 0.0
    before = set(part.bm.faces)
    res = bmesh.ops.create_cube(part.bm, size=1.0)
    for v in res["verts"]:
        v.co = Vector((v.co.x * w, cy + v.co.y * d, cz + v.co.z * h))
    edges = list({e for v in res["verts"] for e in v.link_edges})
    bmesh.ops.bevel(part.bm, geom=res["verts"] + edges, offset=0.03, segments=2, profile=0.5, affect="EDGES",
                    clamp_overlap=True)
    part.tag(part.new_faces(before), "ACCESSORY")
    top, bottom = cz + h / 2 - 0.04, cz - h / 2 + 0.06
    for sx in (-1, 1):
        clav = rig.bone(f"clavicle_{'l' if sx > 0 else 'r'}")
        up = rig.bone(f"upperarm_{'l' if sx > 0 else 'r'}")
        front = ray_y(rig, sx * 0.1, spine.z + 0.06, from_back=False)
        pts = [Vector((sx * 0.08, back + 0.03, top)), Vector((sx * 0.1, 0.03, clav.z + 0.07)),
               Vector((sx * 0.11, front - 0.01, spine.z + 0.06)), Vector((sx * (up.x * 0.75), 0.0, spine.z - 0.06)),
               Vector((sx * 0.12, back + 0.03, bottom))]
        path = [push_out(rig, p, 0.032) for p in smooth_path(pts, 5)]
        before = set(part.bm.faces)
        sweep(part.bm, path, lambda t: rect(0.008, 0.045), up=Vector((sx, 0, 0)), cap_start=True)
        part.tag(part.new_faces(before), "ACCESSORY")
    return "transfer"


BADGE_W, BADGE_H = 0.062, 0.088


def lanyard(rig: BodyRig, hf: HeadFrame, part: Part) -> tuple[str, Vector]:
    neck = rig.bone("neck_01")
    spine = rig.bone("spine_03")
    back = ray_y(rig, 0.0, neck.z, from_back=True)
    chest = ray_y(rig, 0.0, spine.z + 0.06, from_back=False)
    badge_top = Vector((0.0, chest - 0.034, spine.z + 0.08))
    for sx in (-1, 1):
        pts = [Vector((0.0, back + 0.02, neck.z + 0.01)), Vector((sx * 0.07, neck.y, neck.z - 0.005)),
               Vector((sx * 0.06, chest + 0.02, neck.z - 0.06)), badge_top + Vector((sx * 0.012, 0, 0.0))]
        path = [push_out(rig, p, 0.03) for p in smooth_path(pts, 5)]
        before = set(part.bm.faces)
        sweep(part.bm, path, lambda t: rect(0.002, 0.013), up=Vector((0, 0, 1)), cap_start=True)
        part.tag(part.new_faces(before), "ACCESSORY")
    before = set(part.bm.faces)
    res = bmesh.ops.create_cube(part.bm, size=1.0)
    centre = Vector((0.0, badge_top.y, badge_top.z - BADGE_H / 2 - 0.002))
    for v in res["verts"]:
        v.co = centre + Vector((v.co.x * BADGE_W, v.co.y * 0.004, v.co.z * BADGE_H))
    part.tag(part.new_faces(before), "ACCESSORY")
    return "transfer", centre


def sandals(rig: BodyRig, part: Part, avatar: Mapping[str, Any]) -> str:
    foot_bit = avatar["bodyMask"]["foot"]
    body = rig.body
    mw = body.matrix_world
    for side in ("l", "r"):
        sx = 1 if side == "l" else -1
        feet = [p for p in body.data.polygons if rig.face_mask[p.index] & foot_bit and (mw @ p.center).x * sx > 0]
        pts = [mw @ body.data.vertices[i].co for p in feet for i in p.vertices]
        low = [(v.x, v.y) for v in pts if v.z < 0.035]
        hull = convex_hull(low)
        step = max(1, len(hull) // 14)
        hull = hull[::step]
        cx = sum(h[0] for h in hull) / len(hull)
        cy = sum(h[1] for h in hull) / len(hull)
        ring = [Vector((cx + (x - cx) * 1.08, cy + (y - cy) * 1.05, 0.0)) for x, y in hull]
        before = set(part.bm.faces)
        bottom = [part.bm.verts.new(v) for v in ring]
        top = [part.bm.verts.new(v + Vector((0, 0, 0.016))) for v in ring]
        n = len(ring)
        for i in range(n):
            j = (i + 1) % n
            part.bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
        part.bm.faces.new(list(reversed(bottom)))
        part.bm.faces.new(top)
        part.tag(part.new_faces(before), "SHOES")
        heel, ball = rig.bone(f"foot_{side}"), rig.bone(f"ball_{side}")
        axis = (ball - heel)
        axis.z = 0
        axis.normalize()
        for t in (0.15, 0.85):
            centre = heel.lerp(ball, t)
            strap = [p for p in feet if abs(((mw @ p.center) - centre).dot(axis)) < 0.013 and (mw @ p.center).z > 0.012]
            if not strap:
                continue
            tmp = bmesh.new()
            tmp.from_mesh(body.data)
            tmp.faces.ensure_lookup_table()
            keep = {p.index for p in strap}
            bmesh.ops.delete(tmp, geom=[f for f in tmp.faces if f.index not in keep], context="FACES")
            tmp.normal_update()
            for v in tmp.verts:
                v.co = mw @ v.co + v.normal * 0.005
            for layer in list(tmp.verts.layers.deform):
                tmp.verts.layers.deform.remove(layer)
            me = bpy.data.meshes.new("__strap")
            tmp.to_mesh(me)
            tmp.free()
            before = set(part.bm.faces)
            part.bm.from_mesh(me)
            bpy.data.meshes.remove(me)
            part.tag(part.new_faces(before), "SHOES2")
    return "transfer"


BUILDERS: dict[str, Callable[..., Any]] = {"headphones": headphones, "glasses": glasses, "backpack": backpack}


def build_modelled(kind: str, rig: BodyRig, hf: HeadFrame, avatar: Mapping[str, Any],
                   weights: list[dict[str, float]]) -> tuple[bpy.types.Object, dict[str, Any]]:
    part = Part()
    badge: Vector | None = None
    if kind == "lanyard":
        mode, badge = lanyard(rig, hf, part)
    elif kind == "sandals":
        mode = sandals(rig, part, avatar)
    else:
        mode = BUILDERS[kind](rig, hf, part)
    obj = part.to_object(kind, avatar)
    if badge is not None:
        uvs: list[tuple[float, float]] = []
        me = obj.data
        for p in me.polygons:
            d = p.center - badge
            front = abs(d.x) < BADGE_W / 2 + 1e-4 and abs(d.z) < BADGE_H / 2 + 1e-4 and abs(d.y) < 0.004 and p.normal.y < -0.5
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uvs.append(((co.x - badge.x) / BADGE_W + 0.5, (co.z - badge.z) / BADGE_H + 0.5) if front else (-1.0, -1.0))
        set_corner_uv(obj, avatar["attributes"]["uvPrint"], uvs)
    if mode == "transfer":
        transfer_weights(obj, rig, weights)
    else:
        rigid(obj, next(b for b in rig.joints if b.lower() == mode.lower()))
    bind(obj, rig)
    return obj, {"weights": mode, "hasPrint": badge is not None}
