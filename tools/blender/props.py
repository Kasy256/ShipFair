"""art:props - Kenney models picked via art/config/props.json -> palette-coloured, scaled,
bottom-centred GLBs in art/export/props/<id>.glb with extras.collider."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from lib.colors import linear_to_srgb, nearest_index, rgb_to_hex  # noqa: E402
from lib.contract import load_contract  # noqa: E402
from lib.discovery import Inventory  # noqa: E402
from lib.export import export_glb  # noqa: E402
from lib.geometry import collider_shape  # noqa: E402
from lib.glb import read_glb  # noqa: E402
from lib.jsonfile import load_or_create  # noqa: E402
from lib.matching import pick_name  # noqa: E402
from lib.palette import Palette, load_palette, palette_material  # noqa: E402
from lib.report import Report  # noqa: E402
from lib.scene import apply_transforms, delete_objects, import_model, meshes, reset_scene, select_only  # noqa: E402
from lib.scene import triangle_count, world_bounds  # noqa: E402
from lib.step import Ctx, run_step  # noqa: E402

PROPS_DEFAULT: dict[str, Any] = {
    "note": "Props to export. `match` is a regex over model file stems in `pack`. Each kit is scaled uniformly from its reference model; `heightM` or `heightRangeM` on a prop overrides that. `collider` overrides the shape-based guess.",
    "kits": {
        "kenney-city-roads": {"reference": "^road-straight$", "axis": "x", "sizeM": 6.0, "why": "road tile width = STREET_W_M"},
        "kenney-city-suburban": {"sameAs": "kenney-city-roads"},
        "kenney-city-commercial": {"sameAs": "kenney-city-roads"},
        "kenney-furniture": {"reference": "^chair$", "axis": "z", "sizeM": 0.9, "why": "chair height 0.9 m; bench seat lands near 0.45 m"},
        "kenney-food": {"reference": "^barrel$", "axis": "z", "sizeM": 0.9},
    },
    "props": [
        {"id": "bench_01", "pack": "kenney-furniture", "match": "^bench$", "category": "bench"},
        {"id": "bench_02", "pack": "kenney-furniture", "match": "^benchCushion$", "category": "bench"},
        {"id": "chair_01", "pack": "kenney-furniture", "match": "^chair$", "category": "chair"},
        {"id": "chair_02", "pack": "kenney-furniture", "match": "^chairModernCushion$", "category": "chair"},
        {"id": "chair_03", "pack": "kenney-furniture", "match": "^chairRounded$", "category": "chair"},
        {"id": "table_01", "pack": "kenney-furniture", "match": "^tableRound$", "category": "table"},
        {"id": "table_02", "pack": "kenney-furniture", "match": "^table$", "category": "table"},
        {"id": "table_03", "pack": "kenney-furniture", "match": "^tableCoffee$", "category": "table"},
        {"id": "lounge_01", "pack": "kenney-furniture", "match": "^loungeChair$", "category": "chair"},
        {"id": "sofa_01", "pack": "kenney-furniture", "match": "^loungeSofa$", "category": "bench"},
        {"id": "plant_01", "pack": "kenney-furniture", "match": "^pottedPlant$", "category": "planter"},
        {"id": "plant_02", "pack": "kenney-furniture", "match": "^plantSmall1$", "category": "planter"},
        {"id": "bin_01", "pack": "kenney-furniture", "match": "^trashcan$", "category": "bin"},
        {"id": "lamp_floor_01", "pack": "kenney-furniture", "match": "^lampRoundFloor$", "category": "lamp"},
        {"id": "laptop_01", "pack": "kenney-furniture", "match": "^laptop$", "category": "decor", "heightM": 0.23},
        {"id": "tree_01", "pack": "kenney-city-suburban", "match": "^tree-large$", "category": "tree", "heightRangeM": [4, 6], "collider": "cylinder"},
        {"id": "tree_02", "pack": "kenney-city-suburban", "match": "^tree-small$", "category": "tree", "heightRangeM": [4, 6], "collider": "cylinder"},
        {"id": "planter_01", "pack": "kenney-city-suburban", "match": "^planter$", "category": "planter"},
        {"id": "fence_01", "pack": "kenney-city-suburban", "match": "^fence-low$", "category": "fence"},
        {"id": "lamp_01", "pack": "kenney-city-roads", "match": "^light-curved$", "category": "lamp", "heightM": 4.5, "collider": "cylinder"},
        {"id": "lamp_02", "pack": "kenney-city-roads", "match": "^light-square$", "category": "lamp", "heightM": 4.5, "collider": "cylinder"},
        {"id": "cone_01", "pack": "kenney-city-roads", "match": "^construction-cone$", "category": "bollard", "collider": "cylinder"},
        {"id": "barrier_01", "pack": "kenney-city-roads", "match": "^construction-barrier$", "category": "bollard"},
        {"id": "dumpster_01", "pack": "kenney-city-roads", "match": "^dumpster$", "category": "bin"},
        {"id": "road_straight", "pack": "kenney-city-roads", "match": "^road-straight$", "category": "road"},
        {"id": "road_crossroad", "pack": "kenney-city-roads", "match": "^road-crossroad$", "category": "road"},
        {"id": "road_intersection", "pack": "kenney-city-roads", "match": "^road-intersection$", "category": "road"},
        {"id": "road_crossing", "pack": "kenney-city-roads", "match": "^road-crossing$", "category": "road"},
        {"id": "road_end", "pack": "kenney-city-roads", "match": "^road-end$", "category": "road"},
        {"id": "parasol_01", "pack": "kenney-city-commercial", "match": "^detail-parasol-a$", "category": "parasol", "collider": "cylinder"},
    ],
    "wanted": {"fountain": "fountain", "foodCart": "cart|stall", "bollard": "bollard"},
    "excludePaletteGroups": ["glow"],
}


def kit_cfg(cfg: dict[str, Any], pack: str) -> dict[str, Any]:
    kit = cfg["kits"].get(pack, {})
    return cfg["kits"][kit["sameAs"]] if "sameAs" in kit else kit


def kit_scale(inv: Inventory, cfg: dict[str, Any], pack: str, cache: dict[str, float]) -> float:
    """Uniform scale for a kit from its reference model, measured once."""
    if pack in cache:
        return cache[pack]
    kit = kit_cfg(cfg, pack)
    ref_pack = next((p for p, k in cfg["kits"].items() if k is kit), pack)
    files = inv.find(ref_pack, name=kit["reference"]) if kit else []
    if not files:
        cache[pack] = 1.0
        return 1.0
    reset_scene()
    objs = import_model(files[0])
    lo, hi = world_bounds(objs)
    axis = "xyz".index(kit["axis"])
    cache[pack] = kit["sizeM"] / max(hi[axis] - lo[axis], 1e-6)
    return cache[pack]


def face_colours(obj: bpy.types.Object) -> list[tuple[float, float, float]]:
    """sRGB colour per face: sampled from a colour-map texture at the face's UV centre, or the
    material's base colour."""
    me = obj.data
    uv = me.uv_layers.active
    out = []
    cache: dict[str, tuple[Any, int, int]] = {}
    for poly in me.polygons:
        mat = me.materials[poly.material_index] if me.materials else None
        img = None
        bsdf = None
        if mat and mat.use_nodes:
            img = next((n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if img is not None and uv is not None:
            if img.name not in cache:
                cache[img.name] = (list(img.pixels[:]), img.size[0], img.size[1])
            px, w, h = cache[img.name]
            u = sum(uv.data[li].uv.x for li in poly.loop_indices) / poly.loop_total
            v = sum(uv.data[li].uv.y for li in poly.loop_indices) / poly.loop_total
            x = min(w - 1, max(0, int((u % 1.0) * w)))
            y = min(h - 1, max(0, int((v % 1.0) * h)))
            i = (y * w + x) * 4
            out.append((px[i], px[i + 1], px[i + 2]))
        elif bsdf is not None:
            c = bsdf.inputs["Base Color"].default_value
            out.append(tuple(linear_to_srgb(c[k]) for k in range(3)))  # type: ignore[arg-type]
        else:
            out.append((0.8, 0.8, 0.8))
    return out


def recolour(obj: bpy.types.Object, pal: Palette, mat: bpy.types.Material,
             exclude_groups: list[str]) -> dict[str, str]:
    """Point every face's UVs at its nearest allowed palette square; use the single PALETTE material."""
    allowed = [i for i, g in enumerate(pal.groups) if g not in exclude_groups]
    colours = face_colours(obj)
    me = obj.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    uv = me.uv_layers.active or me.uv_layers.new(name="UVMap")
    mapping: dict[str, str] = {}
    for poly, c in zip(me.polygons, colours):
        idx = allowed[nearest_index(c, [pal.rgb[i] for i in allowed])]
        mapping[rgb_to_hex(c)] = pal.names[idx]
        u, v = pal.uv(idx)
        for li in poly.loop_indices:
            uv.data[li].uv = (u, v)
    me.materials.clear()
    me.materials.append(mat)
    for poly in me.polygons:
        poly.material_index = 0
    while len(me.color_attributes):
        me.color_attributes.remove(me.color_attributes[0])
    return dict(sorted(mapping.items()))


def build_prop(spec: dict[str, Any], path: Path, scale: float, pal: Palette, ctx: Ctx,
               contract: dict[str, Any], report: Report, exclude_groups: list[str]) -> dict[str, Any]:
    reset_scene()
    mat = palette_material(pal)
    objs = import_model(path)
    mesh_objs = meshes(objs)
    if not mesh_objs:
        raise RuntimeError(f"{spec['id']}: {path.name} has no mesh")
    apply_transforms(objs)
    if len(mesh_objs) > 1:
        select_only(mesh_objs)
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active if len(mesh_objs) > 1 else mesh_objs[0]
    delete_objects([o for o in list(bpy.data.objects) if o is not obj])
    mapping = recolour(obj, pal, mat, spec.get("excludePaletteGroups", exclude_groups))
    lo, hi = world_bounds([obj])
    native_h = (hi.z - lo.z) * scale
    s = scale
    if "heightM" in spec:
        s = spec["heightM"] / max(hi.z - lo.z, 1e-6)
    elif "heightRangeM" in spec:
        a, b = spec["heightRangeM"]
        clamped = min(max(native_h, a), b)
        s = clamped / max(hi.z - lo.z, 1e-6)
    obj.data.transform(Matrix.Scale(s, 4))
    lo, hi = world_bounds([obj])
    obj.data.transform(Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
    obj.matrix_world = Matrix.Identity(4)
    lo, hi = world_bounds([obj])
    pts = [(v.co.x, v.co.y) for v in obj.data.vertices]
    collider = spec.get("collider") or collider_shape(pts)
    obj.name = spec["id"]
    obj.data.name = spec["id"]
    obj["collider"] = collider
    obj["category"] = spec["category"]
    obj["source"] = f"{spec['pack']}/{path.name}"
    tris = triangle_count(obj)
    out = ctx.export / "props" / f"{spec['id']}.glb"
    export_glb(out, [obj], animations=False)
    budget = contract["budgets"]["prop"]
    if tris > budget["triangles"]:
        report.error(f"{spec['id']}: {tris} tris > {budget['triangles']}")
    if s != scale:
        report.info(f"{spec['id']}: kit scale x{scale:.3f} overridden to x{s:.3f}")
    return {
        "id": spec["id"],
        "source": f"{spec['pack']}/{path.name}",
        "category": spec["category"],
        "triangles": tris,
        "scale": round(s, 4),
        "kitScale": round(scale, 4),
        "sizeM": [round(hi[i] - lo[i], 3) for i in range(3)],
        "collider": collider,
        "colours": mapping,
        "fileKB": round(out.stat().st_size / 1024, 1),
    }


def verify(path: Path, contract: dict[str, Any], report: Report) -> None:
    """Re-read the GLB: one mesh, PALETTE only, triangles within budget, collider extra present."""
    doc, _ = read_glb(path)
    mats = [m.get("name") for m in doc.get("materials", [])]
    if mats != [contract["materials"]["palette"]]:
        report.error(f"{path.name}: materials {mats}, expected [PALETTE]")
    tris = sum(doc["accessors"][p["indices"]]["count"] // 3 for m in doc["meshes"] for p in m["primitives"])
    if tris > contract["budgets"]["prop"]["triangles"]:
        report.error(f"{path.name}: re-read {tris} tris over budget")
    if not any("collider" in n.get("extras", {}) for n in doc.get("nodes", [])):
        report.error(f"{path.name}: no extras.collider")


def main(ctx: Ctx, report: Report) -> None:
    contract, _ = load_contract(ctx.art)
    cfg, _ = load_or_create(ctx.art / "config" / "props.json", PROPS_DEFAULT)
    inv = Inventory.load(ctx.reports)
    reset_scene()
    pal = load_palette(ctx.art)
    scales: dict[str, float] = {}
    results = []
    skipped = []
    for spec in cfg["props"]:
        if not inv.has_pack(spec["pack"]):
            skipped.append(spec["id"])
            continue
        files = inv.find(spec["pack"], name=spec["match"])
        if not files:
            report.warn(f"{spec['id']}: nothing in {spec['pack']} matches /{spec['match']}/")
            continue
        pick = pick_name([spec["match"]], [f.stem for f in files])
        path = next(f for f in files if f.stem == pick.chosen)
        scale = kit_scale(inv, cfg, spec["pack"], scales)
        report.info(f"{spec['id']} <- {spec['pack']}/{path.name}")
        result = build_prop(spec, path, scale, pal, ctx, contract, report,
                            cfg.get("excludePaletteGroups", []))
        verify(ctx.export / "props" / f"{spec['id']}.glb", contract, report)
        results.append(result)
    if skipped:
        report.warn(f"packs missing, props skipped: {skipped}")
    if not results:
        report.skip("no Kenney packs downloaded")
        return
    absent = []
    for label, rx in cfg.get("wanted", {}).items():
        hits = [f for p in inv.data["packs"] if inv.has_pack(p) for f in inv.find(p, name=rx)]
        if not hits:
            absent.append(label)
    if absent:
        report.warn(f"not present in any downloaded pack: {absent}")
    report.stats.update({
        "count": len(results),
        "props": results,
        "kitScales": {k: round(v, 4) for k, v in scales.items()},
        "overBudget": [r["id"] for r in results if r["triangles"] > contract["budgets"]["prop"]["triangles"]],
        "notInPacks": absent,
    })
    report.info(f"{len(results)} props exported")


if __name__ == "__main__":
    run_step(main)
