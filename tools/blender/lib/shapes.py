"""Low-poly bmesh primitives whose faces carry a material key (palette colour, ACCENT or GLOW)."""

from __future__ import annotations

import math
from typing import Sequence

import bmesh
import bpy
from mathutils import Vector

KEY_LAYER = "key"


class PartBuilder:
    """Builds one part. Every face gets a string key; `to_mesh` turns keys into slots and UVs."""

    def __init__(self) -> None:
        self.bm = bmesh.new()
        self.layer = self.bm.faces.layers.int.new(KEY_LAYER)
        self.keys: list[str] = []

    def key_id(self, key: str) -> int:
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def tag(self, faces: Sequence[bmesh.types.BMFace], key: str) -> None:
        k = self.key_id(key)
        for f in faces:
            f[self.layer] = k

    # -- primitives ------------------------------------------------------------------------
    def box(self, lo: Sequence[float], hi: Sequence[float], key: str, bevel: float = 0.0,
            segments: int = 1, bevel_key: str | None = None) -> list[bmesh.types.BMFace]:
        """Axis-aligned box from corner `lo` to `hi`, optionally bevelled on every edge."""
        res = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = res["verts"]
        size = Vector(hi) - Vector(lo)
        centre = (Vector(hi) + Vector(lo)) / 2
        for v in verts:
            v.co = Vector((v.co.x * size.x, v.co.y * size.y, v.co.z * size.z)) + centre
        faces = list({f for v in verts for f in v.link_faces})
        self.tag(faces, key)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            out = bmesh.ops.bevel(self.bm, geom=verts + edges, offset=bevel, segments=segments,
                                  profile=0.5, affect="EDGES", clamp_overlap=True)
            self.tag(out["faces"], bevel_key or key)
            faces = list({f for v in out["verts"] for f in v.link_faces} | set(faces))
            faces = [f for f in faces if f.is_valid]
        return faces

    def inset(self, face: bmesh.types.BMFace, thickness: float, depth: float,
              rim_key: str, inner_key: str) -> bmesh.types.BMFace:
        """Inset one face (rim gets `rim_key`), push the inner face by `depth` along its normal."""
        out = bmesh.ops.inset_individual(self.bm, faces=[face], thickness=thickness, depth=depth)
        self.tag(out["faces"], rim_key)
        self.tag([face], inner_key)
        return face

    def prism(self, profile: Sequence[tuple[float, float]], a0: float, a1: float, axis: str,
              side_keys: Sequence[str] | str, cap_key: str) -> list[bmesh.types.BMFace]:
        """Extrude a CCW 2D profile between a0 and a1 along `axis` ('X' or 'Z').

        For 'Z' the profile is (x, y); for 'X' it is (y, z). `side_keys` may give one key per edge.
        """
        def p3(u: float, v: float, a: float) -> Vector:
            return Vector((u, v, a)) if axis == "Z" else Vector((a, u, v))

        n = len(profile)
        lo = [self.bm.verts.new(p3(u, v, a0)) for u, v in profile]
        hi = [self.bm.verts.new(p3(u, v, a1)) for u, v in profile]
        faces = []
        flip = axis == "X"
        for i in range(n):
            j = (i + 1) % n
            quad = [lo[i], lo[j], hi[j], hi[i]]
            f = self.bm.faces.new(list(reversed(quad)) if flip else quad)
            key = side_keys if isinstance(side_keys, str) else side_keys[i]
            self.tag([f], key)
            faces.append(f)
        bottom = self.bm.faces.new(lo if flip else list(reversed(lo)))
        top = self.bm.faces.new(list(reversed(hi)) if flip else hi)
        self.tag([bottom, top], cap_key)
        return faces + [bottom, top]

    def torus(self, centre: Sequence[float], major: float, minor: float, seg_major: int,
              seg_minor: int, key: str) -> None:
        """Horizontal torus (ring lies in the XY plane)."""
        c = Vector(centre)
        rings = []
        for i in range(seg_major):
            a = 2 * math.pi * i / seg_major
            ring = []
            for j in range(seg_minor):
                b = 2 * math.pi * j / seg_minor
                r = major + minor * math.cos(b)
                ring.append(self.bm.verts.new(c + Vector((r * math.cos(a), r * math.sin(a), minor * math.sin(b)))))
            rings.append(ring)
        for i in range(seg_major):
            n = (i + 1) % seg_major
            for j in range(seg_minor):
                m = (j + 1) % seg_minor
                f = self.bm.faces.new([rings[i][j], rings[n][j], rings[n][m], rings[i][m]])
                self.tag([f], key)

    def cylinder(self, base: Sequence[float], height: float, radius: float, sides: int, key: str,
                 caps: bool = False) -> None:
        """Vertical cylinder standing on `base`."""
        pts = [(base[0] + radius * math.cos(2 * math.pi * i / sides),
                base[1] + radius * math.sin(2 * math.pi * i / sides)) for i in range(sides)]
        faces = self.prism(pts, base[2], base[2] + height, "Z", key, key)
        if not caps:
            bmesh.ops.delete(self.bm, geom=faces[-2:], context="FACES_ONLY")

    # -- output ----------------------------------------------------------------------------
    def to_mesh(self, name: str, palette_uv: dict[str, tuple[float, float]],
                materials: dict[str, bpy.types.Material]) -> bpy.types.Mesh:
        """Write a mesh: palette keys -> PALETTE slot + UV at the square centre; others -> own slot."""
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        uv = self.bm.loops.layers.uv.new("UVMap")
        slots: list[str] = []
        face_slot = []
        for f in self.bm.faces:
            key = self.keys[f[self.layer]]
            slot = key if key in materials and key != "PALETTE" else "PALETTE"
            if slot not in slots:
                slots.append(slot)
            face_slot.append(slots.index(slot))
            u, v = palette_uv.get(key, (0.5, 0.5))
            for loop in f.loops:
                loop[uv].uv = (u, v)
        for f, s in zip(self.bm.faces, face_slot):
            f.material_index = s
        self.bm.faces.layers.int.remove(self.layer)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for s in slots:
            me.materials.append(materials[s])
        for p in me.polygons:
            p.use_smooth = True
        if hasattr(me, "use_auto_smooth"):  # removed in 4.1; flat edges come from split normals there
            me.use_auto_smooth = True
            me.auto_smooth_angle = math.radians(35)
        return me


def face_towards(faces: Sequence[bmesh.types.BMFace], direction: Sequence[float]) -> bmesh.types.BMFace:
    """The largest face whose normal points along `direction`."""
    d = Vector(direction).normalized()
    cands = [f for f in faces if f.is_valid and f.normal.dot(d) > 0.99]
    if not cands:
        raise ValueError(f"no face facing {tuple(direction)}")
    return max(cands, key=lambda f: f.calc_area())


def rounded_rect(w: float, d: float, r_front: float, segs: int, r_back: float = 0.0) -> list[tuple[float, float]]:
    """CCW (x, y) outline centred on the origin, front edge at -y, front corners rounded."""
    hw, hd = w / 2, d / 2
    pts: list[tuple[float, float]] = []

    def arc(cx: float, cy: float, r: float, a0: float, a1: float) -> None:
        if r <= 0:
            pts.append((cx, cy))
            return
        for i in range(segs + 1):
            a = a0 + (a1 - a0) * i / segs
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    rf = min(r_front, hw, hd)
    arc(-hw + rf, -hd + rf, rf, math.pi, 1.5 * math.pi) if rf else pts.append((-hw, -hd))
    arc(hw - rf, -hd + rf, rf, 1.5 * math.pi, 2 * math.pi) if rf else pts.append((hw, -hd))
    rb = min(r_back, hw, hd)
    arc(hw - rb, hd - rb, rb, 0, 0.5 * math.pi) if rb else pts.append((hw, hd))
    arc(-hw + rb, hd - rb, rb, 0.5 * math.pi, math.pi) if rb else pts.append((-hw, hd))
    return pts
