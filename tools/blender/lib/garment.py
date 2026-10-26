"""Generated garments: body zones -> cut, smoothed, decimated, offset shell with hem bands + Solidify.

Built in the body's rest pose. Faces carry a `region` int layer (colour slot) and a `part` layer
(0 shell, 1 hood) until the mesh is written; `_REGION` / `_MASK` are set from them.
"""

from __future__ import annotations

from typing import Any, Mapping

import bmesh
import bpy
from mathutils import Vector

from .attributes import set_corner_uv, set_face_attr
from .avatar import Plane, bits, expand_sides, norm, planes_from_specs, resolve_bone
from .garment_features import apply_features
from .garment_features import layers as _layers
from .rig import BodyRig, assign, bind, transfer_weights
from .scene import triangle_count

INNER_GROUP = "__inner"


def body_zone_bmesh(rig: BodyRig, zone_bits: int, region: int) -> bmesh.types.BMesh:
    """A bmesh copy of the body faces whose mask is in `zone_bits` (world space).

    The body's own skin weights ride along in the deform layer, so the garment moves exactly like
    the skin it was cut from (nearest-face transfer after offsetting gets armpits wrong).
    """
    bm = bmesh.new()
    bm.from_mesh(rig.body.data)
    bm.transform(rig.body.matrix_world)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if not rig.face_mask[f.index] & zone_bits]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # glTF import splits vertices at UV/normal/attribute seams; weld so seams don't open into hems.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    reg, part = _layers(bm)
    for f in bm.faces:
        f[reg] = region
        f[part] = 0
    return bm


def cut(bm: bmesh.types.BMesh, planes: list[Plane]) -> None:
    """Bisect at each plane (where it applies) and delete the outer side. Hems stay open."""
    for pl in planes:
        faces = [f for f in bm.faces if pl.applies(tuple(f.calc_center_median()))]
        if not faces:
            continue
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=pl.point, plane_no=pl.normal)
        outer = [f for f in bm.faces if pl.outside(tuple(f.calc_center_median()))]
        bmesh.ops.delete(bm, geom=outer, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")


def smooth(bm: bmesh.types.BMesh, iterations: int, factor: float = 0.5) -> None:
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(iterations):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)


def to_object(bm: bmesh.types.BMesh, name: str, groups: list[str] | None = None) -> bpy.types.Object:
    """Write `bm` to a new object; `groups` recreates vertex groups in the deform layer's index order."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for g in groups or []:
        obj.vertex_groups.new(name=g)
    return obj


def zone_hems(specs: list[dict[str, Any]], heads: Mapping[str, Any]) -> list[Plane]:
    """Hems that follow a zone boundary instead of a cut: a direction (bone axis) and a radius."""
    out = []
    for spec in specs:
        for side, s in expand_sides(spec):
            a = resolve_bone(heads, s["axisFrom"])
            d = norm(tuple(x - y for x, y in zip(resolve_bone(heads, s["axisTo"]), a)))
            span = tuple(s.get("spanM", (-0.1, 0.1)))
            out.append(Plane(a, d, side, float(s["radiusM"]), a, d, span))  # type: ignore[arg-type]
    return out


def relax_boundary(bm: bmesh.types.BMesh, planes: list[Plane], iterations: int = 4) -> None:
    """Smooth jagged zone-boundary hems along the loop (cut hems are already straight).

    Plain Laplacian smoothing shrinks a closed loop towards its centre (pulling a collar into the
    neck), so each vertex keeps its distance from the hem's axis.
    """
    owned = {}
    for v in bm.verts:
        if v.is_boundary:
            pl = next((p for p in planes if p.applies(tuple(v.co))), None)
            if pl is not None:
                owned[v] = pl

    def radial(co: Vector, pl: Plane) -> tuple[Vector, Vector]:
        ap, ad = Vector(pl.axis_point), Vector(pl.axis_dir)
        along = ap + ad * (co - ap).dot(ad)
        return along, co - along

    radius = {v: radial(v.co, pl)[1].length for v, pl in owned.items()}
    for _ in range(iterations):
        moved = {}
        for v, pl in owned.items():
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) != 2:
                continue
            co = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
            along, off = radial(co, pl)
            moved[v] = along + off.normalized() * radius[v] if off.length > 1e-6 else co
        for v, co in moved.items():
            v.co = co


def from_object(obj: bpy.types.Object) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    return bm


def decimate(obj: bpy.types.Object, target_tris: int) -> None:
    """Collapse-decimate, leaving boundary (hem) vertices alone."""
    tris = triangle_count(obj)
    if tris <= target_tris:
        return
    vg = obj.vertex_groups.new(name="__decimate")
    bm = from_object(obj)
    reg = bm.faces.layers.int.get("region")

    def border(v: bmesh.types.BMVert) -> bool:  # colour-region edges stay crisp, like hems
        return reg is not None and len({f[reg] for f in v.link_faces}) > 1

    interior = [v.index for v in bm.verts if not v.is_boundary and not border(v)]
    bm.free()
    vg.add(interior, 1.0, "REPLACE")
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.ratio = max(0.03, target_tris / tris)
    mod.vertex_group = vg.name
    mod.vertex_group_factor = 1.0
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.vertex_groups.remove(obj.vertex_groups["__decimate"])  # applying invalidates `vg`


def offset(bm: bmesh.types.BMesh, dist: float) -> None:
    bm.normal_update()
    moves = [(v, v.normal.copy()) for v in bm.verts]
    for v, n in moves:
        v.co += n * dist


def boundary_plane(v: bmesh.types.BMVert, planes: list[Plane], n_cuts: int, tol: float = 0.004) -> int:
    """Index of the cut plane a hem vertex lies on, else the first zone hem that claims it."""
    best, best_d = -1, tol
    for i, pl in enumerate(planes[:n_cuts]):
        if pl.applies(tuple(v.co)):
            d = abs(pl.distance(tuple(v.co)))
            if d < best_d:
                best, best_d = i, d
    if best >= 0:
        return best
    for i, pl in enumerate(planes[n_cuts:], start=n_cuts):
        if pl.applies(tuple(v.co)):
            return i
    return -1


def bands(bm: bmesh.types.BMesh, planes: list[Plane], specs: list[dict[str, Any]], length: float,
          out: float, regions: Mapping[str, int], n_cuts: int) -> dict[str, int]:
    """Extrude each hem loop past its cut (or along its zone hem's axis) and slightly outward."""
    reg, _ = _layers(bm)
    plane_of = {v: boundary_plane(v, planes, n_cuts) for v in bm.verts if v.is_boundary}
    made: dict[str, int] = {}
    for i, (pl, spec) in enumerate(zip(planes, specs)):
        band = spec.get("band", "slot2")
        if not band:
            continue
        edges = [e for e in bm.edges if e.is_boundary and plane_of.get(e.verts[0]) == i and plane_of.get(e.verts[1]) == i]
        if not edges:
            continue
        loop_verts = {v for e in edges for v in e.verts}
        centre = sum((v.co for v in loop_verts), Vector()) / len(loop_verts)
        res = bmesh.ops.extrude_edge_only(bm, edges=edges)
        new_verts = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        new_faces = {f for v in new_verts for f in v.link_faces}
        n = Vector(pl.normal)
        for v in new_verts:
            radial = v.co - centre
            radial -= n * radial.dot(n)
            radial = radial.normalized() if radial.length > 1e-6 else Vector()
            v.co += n * float(spec.get("lengthM", length)) + radial * float(spec.get("outM", out))
        slot = regions[spec["region"]] if "region" in spec else None
        for f in new_faces:
            if slot is not None:
                f[reg] = slot
        made[spec.get("name", f"cut{i}")] = len(new_faces)
    return made


def snap_strays(bm: bmesh.types.BMesh, rig: BodyRig, offset: float, reach: float) -> int:
    """Safety net: a vertex flung far from the body (seen after panel cuts + decimation) goes back
    onto the shell at `offset`. Returns how many moved; the report shows it."""
    moved = 0
    _reg, part = _layers(bm)
    for v in bm.verts:
        if any(f[part] == 1 for f in v.link_faces):  # the hood stands off the body on purpose
            continue
        loc, n, _i, d = rig.bvh.find_nearest(v.co)
        if loc is not None and d > reach:
            v.co = loc + n * offset
            moved += 1
    return moved


def orient_outward(bm: bmesh.types.BMesh, rig: BodyRig) -> None:
    """Face normals away from the body (bisect + extrude can leave islands inconsistent)."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    score = 0.0
    for f in bm.faces:
        c = f.calc_center_median()
        loc, _n, _i, _d = rig.bvh.find_nearest(c)
        if loc is not None:
            score += f.normal.dot(c - loc)
    if score < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)


def face_regions(bm: bmesh.types.BMesh) -> tuple[list[int], list[int]]:
    reg, part = _layers(bm)
    return [f[reg] for f in bm.faces], [f[part] for f in bm.faces]


def solidify(obj: bpy.types.Object, thickness: float) -> None:
    obj.vertex_groups.new(name=INNER_GROUP)
    mod = obj.modifiers.new("solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = -1.0
    mod.use_even_offset = False  # even offset shoots vertices out at sliver corners
    mod.use_rim = True
    mod.shell_vertex_group = INNER_GROUP
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def inner_faces(obj: bpy.types.Object) -> list[bool]:
    """True for faces of the Solidify inner shell (every vertex in the inner group)."""
    vg = obj.vertex_groups.get(INNER_GROUP)
    if vg is None:
        return [False] * len(obj.data.polygons)
    inner = {v.index for v in obj.data.vertices for g in v.groups if g.group == vg.index and g.weight > 0.5}
    return [all(i in inner for i in p.vertices) for p in obj.data.polygons]


def print_uvs(obj: bpy.types.Object, rig: BodyRig, avatar: Mapping[str, Any], outer: list[bool]) -> None:
    """Planar front projection of a square chest rectangle; everything else lands outside [0,1]."""
    cfg = avatar["print"]
    centre = rig.bone(cfg["bone"]) + Vector(cfg["offsetM"])
    size = float(cfg["sizeM"])
    uvs: list[tuple[float, float]] = []
    me = obj.data
    for p in me.polygons:
        front = outer[p.index] and p.normal.y < -0.35 and p.center.y < centre.y
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if front:
                uvs.append(((co.x - centre.x) / size + 0.5, (co.z - centre.z) / size + 0.5))
            else:
                uvs.append((-1.0, -1.0))
    set_corner_uv(obj, avatar["attributes"]["uvPrint"], uvs)


# -- build ----------------------------------------------------------------------------------------


def build_garment(rig: BodyRig, item: Mapping[str, Any], defaults: Mapping[str, Any], avatar: Mapping[str, Any],
                  weights: list[dict[str, float]], budget: int,
                  shell_ratio: float = 1.0) -> tuple[bpy.types.Object, dict[str, Any], list[bool]]:
    """One garment for one body. Returns the bound object, build facts and its inner-shell faces."""
    regions = avatar["regions"]
    names = avatar["attributes"]
    cfg = {**defaults, **item}
    mask = avatar["bodyMask"]
    bm = body_zone_bmesh(rig, bits(mask, cfg["source"]), regions[cfg["regions"]["main"]])
    cut_specs = [c for c in cfg.get("cuts", []) if not c.get("zone")]
    hem_specs = [c for c in cfg.get("cuts", []) if c.get("zone")]
    cut_planes = planes_from_specs(cut_specs, rig.heads)
    planes = cut_planes + zone_hems(hem_specs, rig.heads)
    specs = [s for spec in cut_specs + hem_specs for s in ([spec] * (2 if "{s}" in repr(spec) else 1))]
    specs = [{**s, "region": cfg["regions"].get(s.get("band", "slot2"), cfg["regions"]["main"])} if s.get("band", "slot2") else s
             for s in specs]
    cut(bm, cut_planes)
    relax_boundary(bm, planes[len(cut_planes):])
    smooth(bm, int(cfg["smooth"]))
    early = apply_features(bm, rig, cfg.get("features", []), regions, "before_decimate")
    obj = to_object(bm, item["id"], [g.name for g in rig.body.vertex_groups])
    bm.free()
    shell_target = int(budget * float(cfg["shellShare"]) * shell_ratio)
    decimate(obj, shell_target)
    bm = from_object(obj)
    _layers(bm)
    offset(bm, float(cfg["offset_m"]))
    info: dict[str, Any] = {"features": {**early, **apply_features(bm, rig, cfg.get("features", []), regions, "after_offset")}}
    info["bands"] = bands(bm, planes, specs, float(cfg["band_m"]), float(cfg["band_out_m"]), regions, len(cut_planes))
    info["features"].update(apply_features(bm, rig, cfg.get("features", []), regions, "after_bands"))
    info["strayVerticesSnapped"] = snap_strays(bm, rig, float(cfg["offset_m"]),
                                               float(cfg["offset_m"]) + float(cfg["band_m"]) + 0.05)
    # Slivers from the cuts make Solidify's even-thickness offset shoot vertices metres away.
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    orient_outward(bm, rig)
    reg, part = face_regions(bm)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    set_face_attr(obj, names["region"], reg)
    set_face_attr(obj, "__part", part)
    solidify(obj, float(cfg["thickness_m"]))
    inner = inner_faces(obj)
    parts = [int(round(x)) for x in face_attr_values(obj, "__part")]
    regs = face_attr_values(obj, names["region"])
    lining = regions[cfg["regions"].get("lining", cfg["regions"]["main"])]
    regs = [lining if inner[i] and parts[i] == 1 else r for i, r in enumerate(regs)]
    set_face_attr(obj, names["region"], regs)
    set_face_attr(obj, names["mask"], [0.0] * len(regs))
    obj.data.attributes.remove(obj.data.attributes["__part"])
    info["weightsTransferred"] = finish_weights(obj, rig, weights)
    if cfg.get("print"):
        print_uvs(obj, rig, avatar, [not x for x in inner])
    bind(obj, rig)
    info["innerFaces"] = sum(inner)
    return obj, info, inner


def finish_weights(obj: bpy.types.Object, rig: BodyRig, weights: list[dict[str, float]], limit: int = 4) -> int:
    """Skin vertices that came without weights (the hood) from the nearest body face; then keep the
    top `limit` influences per vertex and normalise. Returns how many vertices needed a transfer."""
    names = {g.index: g.name for g in obj.vertex_groups}
    current = [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-4 and not names[g.group].startswith("__")}
               for v in obj.data.vertices]
    bare = [i for i, w in enumerate(current) if not w]
    if bare:
        tmp = obj.copy()
        tmp.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(tmp)
        transfer_weights(tmp, rig, weights, limit)
        tnames = {g.index: g.name for g in tmp.vertex_groups}
        for i in bare:
            current[i] = {tnames[g.group]: g.weight for g in tmp.data.vertices[i].groups}
        me = tmp.data
        bpy.data.objects.remove(tmp, do_unlink=True)
        bpy.data.meshes.remove(me)
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups: dict[str, bpy.types.VertexGroup] = {}
    for i, w in enumerate(current):
        assign(obj, groups, i, w, limit)
    return len(bare)


def face_attr_values(obj: bpy.types.Object, name: str) -> list[float]:
    attr = obj.data.attributes[name]
    vals = [0.0] * len(attr.data)
    attr.data.foreach_get("value", vals)
    return vals
