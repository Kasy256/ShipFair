"""art:previews - Cycles CPU renders of every export, a contact sheet and art/previews/index.html."""

from __future__ import annotations

import math
import sys
import time
from pathlib import Path
from typing import Any, Iterable

sys.path.append(str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from lib.colors import hex_to_rgb, srgb_to_linear  # noqa: E402
from lib.imaging import grid  # noqa: E402
from lib.matching import strip_suffix  # noqa: E402
from lib.report import Report  # noqa: E402
from lib.scene import armatures, delete_objects, import_model, meshes, reset_scene, world_bounds  # noqa: E402
from lib.contract import load_contract  # noqa: E402
from lib.step import Ctx, run_step  # noqa: E402
import previews_avatar  # noqa: E402
from previews_index import write_index  # noqa: E402

SAMPLES = 16
BIG, SMALL = 512, 256
TINTS = {"SKIN": "#d9a37e", "TOP": "#7c5cff", "BOTTOM": "#1f2a52", "SHOES": "#f5f5f5",
         "HAIR": "#3b2a20", "EYES": "#1b1b1b", "ACCENT": "#7c5cff"}
SLOT_COLOURS = {"SLOT_logo": "#ff3b3b", "SLOT_screen_0": "#2f6bff", "SLOT_screen_1": "#2f6bff",
                "SLOT_sign": "#2fd05a", "SLOT_spawn": "#ffd400", "SLOT_maker": "#ff8a00"}
VIEWS = {"front": Vector((0, -1, 0.12)), "three_quarter": Vector((0.75, -1.0, 0.45))}


def lin(hexstr: str) -> tuple[float, float, float, float]:
    return (*(srgb_to_linear(c) for c in hex_to_rgb(hexstr)), 1.0)


def setup_studio() -> None:
    """Cycles CPU, 16 samples + OIDN when available, soft grey ground, neutral world."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    try:
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except (TypeError, AttributeError):
        scene.cycles.use_denoising = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Filmic"  # exists in 3.6 and 4.x; rolls off highlights
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.57, 0.6, 1)
    bg.inputs["Strength"].default_value = 0.5
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "__ground"
    mat = bpy.data.materials.new("__ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.17, 0.19, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    ground.data.materials.append(mat)
    cam_data = bpy.data.cameras.new("__cam")
    cam_data.lens = 35
    cam = bpy.data.objects.new("__cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, factor in (("__key", 1.0), ("__fill", 0.6), ("__rim", 0.7)):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        light["factor"] = factor
        scene.collection.objects.link(light)


def frame(centre: Vector, radius: float, direction: Vector, res: int) -> None:
    """Point the camera at `centre` from `direction`, far enough to fit `radius`; place lights."""
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = res
    cam = scene.camera
    fov = cam.data.angle
    dist = radius / math.sin(fov / 2) * 1.05
    d = direction.normalized()
    cam.location = centre + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = dist * 4
    right = d.cross(Vector((0, 0, 1))).normalized()
    placements = {
        "__key": d.lerp(-right, 0.6) + Vector((0, 0, 0.9)),
        "__fill": d.lerp(right, 0.8) + Vector((0, 0, 0.2)),
        "__rim": -d + Vector((0, 0, 1.0)),
    }
    for name, offset in placements.items():
        light = bpy.data.objects[name]
        ld = radius * 4
        light.location = centre + offset.normalized() * ld
        light.rotation_euler = (-offset).to_track_quat("-Z", "Y").to_euler()
        light.data.size = radius * 2
        light.data.energy = 11 * ld * ld * light["factor"]


def render(path: Path, report: Report, label: str, counter: list[int]) -> Path:
    counter[0] += 1
    t0 = time.perf_counter()
    report.info(f"render {counter[0]}: {label} …")
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    report.info(f"render {counter[0]}: {label} done in {time.perf_counter() - t0:.1f} s")
    return path


def tint(objs: Iterable[bpy.types.Object], colours: dict[str, str]) -> None:
    """Set the runtime tint on contract materials, multiplying over any linked input (e.g. AO)."""
    done: set[str] = set()
    for o in objs:
        if o.type != "MESH":
            continue
        for m in o.data.materials:
            key = m.name.split(".")[0] if m else ""
            if key not in colours or not m.use_nodes or m.name in done:
                continue
            done.add(m.name)
            nt = m.node_tree
            bsdf = nt.nodes.get("Principled BSDF")
            if bsdf is None:
                continue
            base = bsdf.inputs["Base Color"]
            if base.is_linked:
                mix = nt.nodes.new("ShaderNodeMixRGB")
                mix.blend_type = "MULTIPLY"
                mix.inputs["Fac"].default_value = 1.0
                nt.links.new(base.links[0].from_socket, mix.inputs["Color1"])
                mix.inputs["Color2"].default_value = lin(colours[key])
                nt.links.new(mix.outputs["Color"], base)
            else:
                base.default_value = lin(colours[key])


def bounds_of(objs: Iterable[bpy.types.Object]) -> tuple[Vector, float]:
    bpy.context.view_layer.update()
    lo, hi = world_bounds([o for o in objs if o.type == "MESH" and not o.hide_render])
    return (lo + hi) / 2, (hi - lo).length / 2


def characters(ctx: Ctx, report: Report, n: list[int]) -> dict[str, Any]:
    out: dict[str, Any] = {"images": []}
    files = sorted((ctx.export / "characters").glob("body_*.glb")) if (ctx.export / "characters").is_dir() else []
    if not files:
        report.warn("no character exports; run pnpm art:characters")
        return out
    clips = ctx.export / "animations" / "humanoid_clips.glb"
    for f in files:
        reset_scene()
        setup_studio()
        objs = import_model(f)
        tint(objs, TINTS)
        hairs = sorted((o for o in objs if o.name.startswith("hair_")), key=lambda o: o.name)
        for h in hairs:
            h.hide_render = not bool(h.get("defaultVisible", False))
        centre, radius = bounds_of(objs)
        for view, d in VIEWS.items():
            frame(centre, radius, d, BIG)
            p = render(ctx.previews / f"{f.stem}_{view}.png", report, f"{f.stem} {view}", n)
            out["images"].append(p.name)
        if f.stem.endswith("_m") and hairs:
            tiles = []
            for h in hairs:
                for o in hairs:
                    o.hide_render = o is not h
                c, _ = bounds_of([h])
                frame(c - Vector((0, 0, 0.05)), 0.32, VIEWS["three_quarter"], SMALL)
                tiles.append(render(ctx.previews / f"_hair_{h.name}.png", report, f"hair {h.name}", n))
            grid(tiles, 4, (SMALL, SMALL), ctx.previews / "hair_grid.png")
            out["images"].append("hair_grid.png")
            for h in hairs:
                h.hide_render = not bool(h.get("defaultVisible", False))
            if clips.exists():
                arm = armatures(objs)[0]
                before = set(bpy.data.actions)
                clip_objs = import_model(clips)
                actions = {strip_suffix(a.name, f"_{armatures(clip_objs)[0].name}"): a
                           for a in bpy.data.actions if a not in before}
                delete_objects(clip_objs)
                arm.animation_data_create()
                for clip, at in (("walk", 0.25), ("emote_wave", 0.5)):
                    act = actions.get(clip)
                    if act is None:
                        out.setdefault("missingClips", []).append(clip)
                        report.warn(f"preview: clip {clip} not in {clips.name}")
                        continue
                    arm.animation_data.action = act
                    s, e = act.frame_range
                    bpy.context.scene.frame_set(int(s + (e - s) * at))
                    frame(centre, radius, VIEWS["three_quarter"], BIG)
                    p = render(ctx.previews / f"anim_{clip}.png", report, f"clip {clip}", n)
                    out["images"].append(p.name)
                arm.animation_data.action = None
                bpy.context.scene.frame_set(0)
    return out


def slot_marker(slot: bpy.types.Object) -> bpy.types.Object:
    colour = SLOT_COLOURS.get(slot.name.split(".")[0], "#ffffff")
    mat = bpy.data.materials.new(f"__{slot.name}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = lin(colour)
    key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
    bsdf.inputs[key].default_value = lin(colour)
    bsdf.inputs["Emission Strength"].default_value = 0.6
    if slot.get("kind") == "point":
        bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=0.04, location=slot.matrix_world.translation + Vector((0, 0, 0.02)))
        ob = bpy.context.active_object
    else:
        me = bpy.data.meshes.new(f"__{slot.name}")
        me.from_pydata([(-0.5, 0, -0.5), (0.5, 0, -0.5), (0.5, 0, 0.5), (-0.5, 0, 0.5)], [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new(f"__{slot.name}", me)
        bpy.context.scene.collection.objects.link(ob)
        loc, rot, _ = slot.matrix_world.decompose()
        w, h = float(slot.get("w", 1)), float(slot.get("h", 1))
        ob.matrix_world = Matrix.LocRotScale(loc + rot @ Vector((0, -0.003, 0)), rot, Vector((w, 1, h)))
    ob.data.materials.append(mat)
    return ob


def booth_kit(ctx: Ctx, report: Report, n: list[int]) -> dict[str, Any]:
    out: dict[str, Any] = {"images": []}
    f = ctx.export / "booth-kit" / "booth_kit.glb"
    if not f.exists():
        report.warn("no booth kit export; run pnpm art:booth-kit")
        return out
    reset_scene()
    setup_studio()
    objs = import_model(f)
    tint(objs, TINTS)
    tiers = [o for o in objs if o.name.split(".")[0].startswith("tier_")]
    markers: dict[str, list[bpy.types.Object]] = {}
    for t in tiers:
        markers[t.name] = [slot_marker(s) for s in t.children if s.name.startswith("SLOT_")]
    def show_only(tier: bpy.types.Object | None) -> list[bpy.types.Object]:
        visible = []
        for t in tiers:
            for c in t.children_recursive:
                c.hide_render = t is not tier
                if t is tier:
                    visible.append(c)
            for m in markers[t.name]:
                m.hide_render = t is not tier
        return visible
    for t in sorted(tiers, key=lambda t: t.name):
        visible = show_only(t)
        centre, radius = bounds_of(visible)
        frame(centre, radius * 0.92, VIEWS["three_quarter"], BIG)
        p = render(ctx.previews / f"booth_{t.name.split('.')[0]}.png", report, t.name, n)
        out["images"].append(p.name)
    # AO only: the booth tier with every material replaced by its baked vertex colour.
    booth = next(t for t in tiers if t.name.startswith("tier_booth"))
    visible = show_only(booth)
    for m in markers[booth.name]:
        m.hide_render = True
    ao = bpy.data.materials.new("__ao")
    ao.use_nodes = True
    nt = ao.node_tree
    attr = nt.nodes.new("ShaderNodeVertexColor")
    nt.links.new(attr.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    for o in visible:
        if o.type == "MESH":
            if o.data.color_attributes:
                attr.layer_name = o.data.color_attributes[0].name
            o.data.materials.clear()
            o.data.materials.append(ao)
    centre, radius = bounds_of(visible)
    frame(centre, radius * 0.92, VIEWS["three_quarter"], BIG)
    p = render(ctx.previews / "booth_ao_only.png", report, "booth AO only", n)
    out["images"].append(p.name)
    return out


def props(ctx: Ctx, report: Report, n: list[int]) -> dict[str, Any]:
    out: dict[str, Any] = {"images": []}
    folder = ctx.export / "props"
    files = sorted(folder.glob("*.glb")) if folder.is_dir() else []
    if not files:
        report.warn("no prop exports; run pnpm art:props")
        return out
    reset_scene()
    setup_studio()
    ref_file = next(iter(sorted((ctx.export / "characters").glob("body_*_m.glb"))), None)
    figure: list[bpy.types.Object] = []
    if ref_file:
        figure = import_model(ref_file)
        tint(figure, TINTS)
        for o in figure:
            if o.name.startswith("hair_"):
                o.hide_render = not bool(o.get("defaultVisible", False))
    else:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.78, location=(0, 0, 0.89))
        figure = [bpy.context.active_object]
    roots = [o for o in figure if o.parent is None]
    tiles = []
    for f in files:
        objs = import_model(f)
        lo, hi = world_bounds(meshes(objs))
        for r in roots:
            r.location = (hi.x + 0.6, 0, 0)
        bpy.context.view_layer.update()
        everything = [*meshes(objs), *[o for o in meshes(figure) if not o.hide_render]]
        centre, radius = bounds_of(everything)
        frame(centre, radius, VIEWS["three_quarter"], SMALL)
        tiles.append(render(ctx.previews / f"_prop_{f.stem}.png", report, f.stem, n))
        delete_objects(objs)
    cols = 6
    grid(tiles, cols, (SMALL, SMALL), ctx.previews / "props_sheet.png")
    out["images"].append("props_sheet.png")
    out["order"] = [f.stem for f in files]
    return out


def main(ctx: Ctx, report: Report) -> None:
    ctx.previews.mkdir(parents=True, exist_ok=True)
    for old in ctx.previews.glob("*.png"):
        old.unlink()
    n = [0]
    t0 = time.perf_counter()
    sections = {
        "characters": characters(ctx, report, n),
        "booth": booth_kit(ctx, report, n),
        "props": props(ctx, report, n),
    }
    sections["avatar"] = previews_avatar.run(ctx, load_contract(ctx.art)[0]["avatar"], report, n)
    key = [
        "body_superhero_m_front.png", "body_superhero_m_three_quarter.png",
        "body_superhero_f_front.png", "body_superhero_f_three_quarter.png",
        "hair_grid.png", "anim_walk.png", "booth_tier_stall.png", "booth_tier_booth.png",
        "booth_tier_pavilion.png", "booth_ao_only.png", "props_sheet.png", "anim_emote_wave.png",
    ]
    paths = [ctx.previews / k if (ctx.previews / k).exists() else None for k in key]
    if any(paths):
        grid(paths, 4, (384, 384), ctx.previews / "contact_sheet.png")
    write_index(ctx, sections)
    report.stats.update({
        "renders": n[0],
        "seconds": round(time.perf_counter() - t0, 1),
        "sections": sections,
        "files": sorted(p.name for p in ctx.previews.iterdir()),
    })
    report.info(f"{n[0]} renders -> {ctx.previews}")


if __name__ == "__main__":
    run_step(main)
