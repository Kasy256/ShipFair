"""art:booth-kit - procedural booth parts, tier assemblies with SLOT_* empties, AO baked to vertex
colours, exported as art/export/booth-kit/booth_kit.glb and checked against the contract."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent))

import bpy  # noqa: E402

import booth_kit_parts as P  # noqa: E402
from lib.contract import load_contract  # noqa: E402
from lib.export import export_glb  # noqa: E402
from lib.glb import children_by_name, read_glb, strip_name_suffixes  # noqa: E402
from lib.palette import flat_material, load_palette, palette_material  # noqa: E402
from lib.report import Report  # noqa: E402
from lib.scene import import_model, reset_scene, select_only  # noqa: E402
from lib.shapes import PartBuilder  # noqa: E402
from lib.step import Ctx, run_step  # noqa: E402

AO_SAMPLES = 64
AO_DISTANCE_M = 1.2
BAKE_ORDER = ["tier_booth", "tier_pavilion", "tier_stall"]  # first tier holding a part bakes it

FT = P.FLOOR_TOP
WALL_Y = P.FLOOR_D / 2 - 0.1 - P.WALL_T / 2
WALL_FACE_Y = WALL_Y - P.WALL_T / 2
SCREEN_Y = WALL_FACE_Y - P.SCREEN_T / 2
SIGN_Y = WALL_FACE_Y - P.SIGN_T / 2
SIDE_X = P.FLOOR_W / 2 - 0.06 - P.SIDE_T / 2
SIDE_Y = WALL_FACE_Y - P.SIDE_D / 2
ROOF_Y = WALL_Y + P.WALL_T / 2
ROOF_Z = FT + P.WALL_H
RING_Y = 1.2


def ring_z() -> float:
    t = (ROOF_Y - RING_Y) / P.ROOF_D
    return ROOF_Z + P.ROOF_RISE * t * t - P.RING_DROP - P.RING_r * 0.5


def screen_slot_y(scale: float) -> float:
    return SCREEN_Y - P.SCREEN_T / 2 * scale + 0.008 * scale - 0.004


def sign_slot_y(scale: float) -> float:
    return SIGN_Y - P.SIGN_T / 2 * scale + 0.008 * scale - 0.004


def tier_layouts() -> dict[str, dict[str, Any]]:
    """Part placements (name, location, uniform scale) and slots per tier. Origin: lot centre."""
    sw, sh = P.SCREEN_IN
    gw, gh = P.SIGN_IN
    logo_y = WALL_FACE_Y + 0.006
    spawn = {"name": "SLOT_spawn", "loc": (0, -3.3, FT), "point": True}
    stall = {
        "lots": 1,
        "parts": [
            ("kit_floor", (0, 0, 0), 1.0),
            ("kit_wall_back", (0, WALL_Y, FT), 1.0),
            ("kit_counter", (0, -1.6, FT), 1.0),
            ("kit_screen", (2.9, SCREEN_Y, FT + 1.75), 1.0),
            ("kit_sign", (0, SIGN_Y, FT + 2.6), 1.0),
        ],
        "slots": [
            {"name": "SLOT_logo", "loc": (-2.9, logo_y, FT + 1.75), "w": 1.1, "h": 1.1},
            {"name": "SLOT_screen_0", "loc": (2.9, screen_slot_y(1), FT + 1.75), "w": sw, "h": sh},
            {"name": "SLOT_sign", "loc": (0, sign_slot_y(1), FT + 2.6), "w": gw, "h": gh},
            spawn,
            {"name": "SLOT_maker", "loc": (0, -0.7, FT), "point": True},
        ],
    }
    booth = {
        "lots": 1,
        "parts": [
            ("kit_floor", (0, 0, 0), 1.0),
            ("kit_wall_back", (0, WALL_Y, FT), 1.0),
            ("kit_wall_side", (-SIDE_X, SIDE_Y, FT), 1.0),
            ("kit_wall_side", (SIDE_X, SIDE_Y, FT), 1.0),
            ("kit_counter", (0, -1.6, FT), 1.0),
            ("kit_screen", (-2.9, SCREEN_Y, FT + 1.75), 1.0),
            ("kit_screen", (2.9, SCREEN_Y, FT + 1.75), 1.0),
            ("kit_sign", (0, SIGN_Y, FT + 2.6), 1.0),
            ("kit_roof", (0, ROOF_Y, ROOF_Z), 1.0),
            ("kit_ring", (0, RING_Y, ring_z()), 1.0),
        ],
        "slots": [
            {"name": "SLOT_logo", "loc": (0, logo_y, FT + 1.55), "w": 1.1, "h": 1.1},
            {"name": "SLOT_screen_0", "loc": (-2.9, screen_slot_y(1), FT + 1.75), "w": sw, "h": sh},
            {"name": "SLOT_screen_1", "loc": (2.9, screen_slot_y(1), FT + 1.75), "w": sw, "h": sh},
            {"name": "SLOT_sign", "loc": (0, sign_slot_y(1), FT + 2.6), "w": gw, "h": gh},
            spawn,
            {"name": "SLOT_maker", "loc": (0, -0.7, FT), "point": True},
        ],
    }
    s = 1.3
    stage_top = FT + P.STAGE_H
    side2 = P.FLOOR_W + 0.1 - 0.06 - P.SIDE_T / 2
    half = P.FLOOR_W / 2
    pavilion = {
        "lots": 2,
        "parts": [
            ("kit_stage", (0, 0, 0), 1.0),
            ("kit_wall_back", (-half, WALL_Y, FT), 1.0),
            ("kit_wall_back", (half, WALL_Y, FT), 1.0),
            ("kit_wall_side", (-side2, SIDE_Y, FT), 1.0),
            ("kit_wall_side", (side2, SIDE_Y, FT), 1.0),
            ("kit_counter", (-5.5, -1.6, FT), 1.0),
            ("kit_counter", (5.5, -1.6, FT), 1.0),
            ("kit_screen", (-5.0, WALL_FACE_Y - P.SCREEN_T / 2 * s, stage_top + 1.6), s),
            ("kit_screen", (5.0, WALL_FACE_Y - P.SCREEN_T / 2 * s, stage_top + 1.6), s),
            ("kit_sign", (0, WALL_FACE_Y - P.SIGN_T / 2 * s, FT + 2.52), s),
            ("kit_roof", (-half, ROOF_Y, ROOF_Z), 1.0),
            ("kit_roof", (half, ROOF_Y, ROOF_Z), 1.0),
            ("kit_ring", (-half, RING_Y, ring_z()), 1.0),
            ("kit_ring", (half, RING_Y, ring_z()), 1.0),
        ],
        "slots": [
            {"name": "SLOT_logo", "loc": (0, logo_y, FT + 1.3), "w": 1.4, "h": 1.4},
            {"name": "SLOT_screen_0", "loc": (-5.0, WALL_FACE_Y - P.SCREEN_T * s + 0.008 * s - 0.004, stage_top + 1.6), "w": sw * s, "h": sh * s},
            {"name": "SLOT_screen_1", "loc": (5.0, WALL_FACE_Y - P.SCREEN_T * s + 0.008 * s - 0.004, stage_top + 1.6), "w": sw * s, "h": sh * s},
            {"name": "SLOT_sign", "loc": (0, WALL_FACE_Y - P.SIGN_T * s + 0.008 * s - 0.004, FT + 2.52), "w": gw * s, "h": gh * s},
            spawn,
            {"name": "SLOT_maker", "loc": (0, 2.0, stage_top), "point": True},
        ],
    }
    return {"tier_stall": stall, "tier_booth": booth, "tier_pavilion": pavilion}


def build_parts(pal, report: Report, budgets: dict[str, int]) -> tuple[dict[str, bpy.types.Mesh], dict[str, Any]]:
    mats = {"PALETTE": palette_material(pal), "ACCENT": flat_material("ACCENT"),
            "GLOW": flat_material("GLOW", emissive=True)}
    uv = {name: pal.uv(name) for name in pal.names}
    meshes: dict[str, bpy.types.Mesh] = {}
    stats: dict[str, Any] = {}
    for name, fn in P.PARTS.items():
        b = PartBuilder()
        fn(b)
        unknown = [k for k in b.keys if k not in uv and k not in mats]
        if unknown:
            raise ValueError(f"{name}: unknown colour keys {unknown}")
        me = b.to_mesh(name, uv, mats)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        meshes[name] = me
        stats[name] = {"triangles": tris, "budget": budgets[name], "materials": [m.name for m in me.materials]}
        if tris > budgets[name]:
            report.error(f"{name}: {tris} tris > budget {budgets[name]}")
    return meshes, stats


def assemble(meshes: dict[str, bpy.types.Mesh], contract: dict[str, Any]) -> dict[str, bpy.types.Object]:
    tiers: dict[str, bpy.types.Object] = {}
    coll = bpy.context.scene.collection
    lot = contract["lot"]
    for tier, layout in tier_layouts().items():
        root = bpy.data.objects.new(tier, None)
        root.empty_display_type = "PLAIN_AXES"
        root["lots"] = layout["lots"]
        root["widthM"] = lot["widthM"] * layout["lots"]
        root["depthM"] = lot["depthM"]
        coll.objects.link(root)
        for part, loc, scale in layout["parts"]:
            ob = bpy.data.objects.new(part, meshes[part])
            ob.location = loc
            ob.scale = (scale,) * 3
            ob["part"] = part
            coll.objects.link(ob)
            ob.parent = root
        for slot in layout["slots"]:
            ob = bpy.data.objects.new(slot["name"], None)
            ob.location = slot["loc"]
            if slot.get("point"):
                ob.empty_display_type = "SINGLE_ARROW"
                ob.empty_display_size = 0.5
                ob["kind"] = "point"
                ob["facing"] = "+Y in Blender (into the booth); -Z in three.js" if slot["name"] == "SLOT_spawn" else "-Y in Blender (toward visitors); +Z in three.js"
            else:
                ob.empty_display_type = "CUBE"
                ob.empty_display_size = 0.5
                ob.scale = (slot["w"], 0.02, slot["h"])
                ob["kind"] = "rect"
                ob["w"] = round(slot["w"], 4)
                ob["h"] = round(slot["h"], 4)
            coll.objects.link(ob)
            ob.parent = root
        tiers[tier] = root
    return tiers


def bake_ao(tiers: dict[str, bpy.types.Object], report: Report) -> dict[str, float]:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = AO_SAMPLES
    world = bpy.data.worlds.new("bake")
    world.light_settings.distance = AO_DISTANCE_M
    scene.world = world
    done: set[str] = set()
    times: dict[str, float] = {}
    for tier in BAKE_ORDER:
        members = {o for o in tiers[tier].children}
        for o in scene.objects:
            if o.type == "MESH":
                o.hide_render = o not in members
        for ob in tiers[tier].children:
            if ob.type != "MESH" or ob.data.name in done:
                continue
            me = ob.data
            attr = me.color_attributes.get("AO") or me.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
            me.color_attributes.active_color = attr
            if hasattr(me.color_attributes, "render_color_index"):
                me.color_attributes.render_color_index = list(me.color_attributes).index(attr)
            select_only([ob])
            t0 = time.perf_counter()
            report.info(f"baking AO: {me.name} in {tier} …")
            bpy.ops.object.bake(type="AO", target="VERTEX_COLORS", use_clear=True)
            times[me.name] = round(time.perf_counter() - t0, 2)
            report.info(f"baked {me.name} in {times[me.name]} s")
            done.add(me.name)
    for o in scene.objects:
        o.hide_render = False
    return times


def verify_glb(path: Path, contract: dict[str, Any], report: Report) -> dict[str, Any]:
    """Contract check on the exported JSON, plus a clean re-import into a fresh scene."""
    doc, _ = read_glb(path)
    kit = contract["boothKit"]
    names = [n.get("name") for n in doc.get("nodes", [])]
    out: dict[str, Any] = {"tiers": {}}
    for tier in kit["tiers"]:
        if tier not in names:
            report.error(f"{path.name}: tier node {tier} missing")
            continue
        kids = children_by_name(doc, tier)
        kid_names = [k.get("name") for k in kids]
        for slot in kit["tierSlots"][tier]:
            if slot not in kid_names:
                report.error(f"{path.name}: {tier} has no {slot}")
        out["tiers"][tier] = {
            "parts": sorted({n for n in kid_names if n.startswith("kit_")}),
            "slots": {k["name"]: k.get("extras", {}) for k in kids if k.get("name", "").startswith("SLOT_")},
        }
    mats = sorted(m.get("name") for m in doc.get("materials", []))
    allowed = {contract["materials"]["palette"], contract["materials"]["accent"], contract["materials"]["glow"]}
    if set(mats) - allowed:
        report.error(f"{path.name}: unexpected materials {sorted(set(mats) - allowed)}")
    mesh_names = sorted(m.get("name") for m in doc.get("meshes", []))
    missing_parts = sorted(set(kit["parts"]) - set(mesh_names))
    if missing_parts:
        report.error(f"{path.name}: part meshes missing {missing_parts}")
    has_ao = all("COLOR_0" in p["attributes"] for m in doc.get("meshes", []) for p in m["primitives"])
    if not has_ao:
        report.error(f"{path.name}: some primitives lack COLOR_0 (AO)")
    reset_scene()
    objs = import_model(path)
    out.update({"materials": mats, "meshes": mesh_names, "aoAttribute": "COLOR_0" if has_ao else None,
                "reimportedObjects": len(objs)})
    return out


def main(ctx: Ctx, report: Report) -> None:
    contract, _ = load_contract(ctx.art)
    reset_scene()
    pal = load_palette(ctx.art)
    meshes, part_stats = build_parts(pal, report, contract["boothKit"]["parts"])
    total = sum(s["triangles"] for s in part_stats.values())
    if total > contract["budgets"]["boothKit"]["triangles"]:
        report.error(f"booth kit: {total} tris > {contract['budgets']['boothKit']['triangles']}")
    tiers = assemble(meshes, contract)
    bake_times = bake_ao(tiers, report)
    out = ctx.export / "booth-kit" / "booth_kit.glb"
    objs = [o for t in tiers.values() for o in (t, *t.children)]
    export_glb(out, objs, animations=False, colors=True)
    renamed = strip_name_suffixes(out, ("SLOT_", "kit_"))
    check = verify_glb(out, contract, report)
    slot_sizes = {
        tier: {k: v for k, v in info["slots"].items() if v.get("kind") == "rect"}
        for tier, info in check["tiers"].items()
    }
    report.stats.update({
        "export": "booth-kit/booth_kit.glb",
        "fileKB": round(out.stat().st_size / 1024, 1),
        "parts": part_stats,
        "totalTriangles": total,
        "bakeSeconds": bake_times,
        "bakeTotalSeconds": round(sum(bake_times.values()), 2),
        "slotSizes": slot_sizes,
        "namesNormalised": renamed,
        "check": check,
    })
    report.info(f"{len(meshes)} parts, {total} tris, bake {sum(bake_times.values()):.1f} s -> {out.name}")


if __name__ == "__main__":
    run_step(main)
