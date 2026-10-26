"""art:characters - base bodies -> tintable, contract-named character GLBs with fitted hairs.

For each body found by inspect: verify scale/feet/facing, split clothing regions from bone weights,
assign the contract materials, fit and parent hairs to the head bone, keep within budget, export.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from lib.attributes import label_mesh, vertex_weights, write_body_mask  # noqa: E402
from lib.contract import load_contract  # noqa: E402
from lib.hairfit import fit_hair, set_single_material, strip_extras  # noqa: E402
from lib.discovery import Inventory  # noqa: E402
from lib.export import export_glb  # noqa: E402
from lib.jsonfile import load_or_create  # noqa: E402
from lib.palette import flat_material  # noqa: E402
from lib.regions import compile_region_map, face_regions  # noqa: E402
from lib.report import Report  # noqa: E402
from lib.scene import (  # noqa: E402
    apply_transforms,
    armatures,
    bone_names,
    deform_bone_count,
    delete_objects,
    find_bone,
    import_model,
    meshes,
    purge_orphans,
    reset_scene,
    select_only,
    triangle_count,
    world_bounds,
)
from lib.skeleton import canonical_rest, max_rest_diff, reorient, rest_rotations  # noqa: E402
from lib.step import Ctx, run_step  # noqa: E402

PACK = "universal-base-characters"

REGION_MAP_DEFAULT: dict[str, Any] = {
    "note": "Body faces take the region of their dominant deform bone. Patterns are case-insensitive regexes over the UE mannequin bone names listed in art/reports/inspect.json; the first match wins.",
    "default": "TOP",
    "rules": [
        {"region": "SKIN", "patterns": ["^head$", "^neck_\\d+$"]},
        {"region": "SKIN", "patterns": ["^lowerarm_[lr]$", "^hand_[lr]$", "^(thumb|index|middle|ring|pinky)_\\d+(_leaf)?_[lr]$"]},
        {"region": "TOP", "patterns": ["^spine_\\d+$", "^clavicle_[lr]$", "^upperarm_[lr]$"]},
        {"region": "BOTTOM", "patterns": ["^root$", "^pelvis$", "^thigh_[lr]$", "^calf_[lr]$"]},
        {"region": "SHOES", "patterns": ["^foot_[lr]$", "^ball(_leaf)?_[lr]$"]},
    ],
}

CHARACTERS_DEFAULT: dict[str, Any] = {
    "note": "Knobs for pnpm art:characters. Names are regexes matched against file stems found by art:inspect.",
    "bodyFile": "FullBody$",
    "hairFile": "^Hair_",
    "hairPathPrefer": "rigged to head bone",
    "hairExclude": [],
    "eyebrowsMaxTris": 300,
    "hairFallbackOffsetM": [0, 0, 0.05],
    "hairFit": {"maxCentreOffsetM": 0.12, "minBelowHeadM": 0.2, "maxAboveHeadM": 0.35, "maxWidthM": 0.5},
    "bodyMaxTris": None,
}


def body_id(stem: str) -> str:
    """'Superhero_Male_FullBody' -> 'body_superhero_m'."""
    parts = [p.lower() for p in stem.split("_") if p.lower() != "fullbody"]
    sex = {"male": "m", "female": "f"}
    tail = [sex.get(p, p) for p in parts]
    return "body_" + "_".join(tail)


def decimate_to(obj: bpy.types.Object, max_tris: int) -> float:
    """Collapse-decimate `obj` to at most `max_tris`. Returns the ratio used (1.0 = untouched)."""
    tris = triangle_count(obj)
    if tris <= max_tris:
        return 1.0
    ratio = max(0.05, max_tris / tris * 0.98)
    mod = obj.modifiers.new("fit_budget", "DECIMATE")
    mod.ratio = ratio
    select_only([obj])
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return round(ratio, 3)


def normalise_body(arm: bpy.types.Object, body: bpy.types.Object, eyes: bpy.types.Object | None,
                   contract: dict[str, Any], report: Report, bid: str) -> dict[str, Any]:
    """Height within range, feet on z=0, face toward -Y. Returns what was checked or changed."""
    h = contract["character"]["heightM"]
    family = [arm, *arm.children]
    apply_transforms(family)
    lo, hi = world_bounds([body])
    height = hi.z - lo.z
    changes: list[str] = []
    if not h["min"] <= height <= h["max"]:
        s = h["target"] / height
        arm.scale = (s, s, s)
        apply_transforms(family)
        changes.append(f"scaled x{s:.3f} from {height:.3f} m")
        report.warn(f"{bid}: height {height:.3f} m outside {h['min']}-{h['max']} m; scaled to {h['target']} m")
    lo, hi = world_bounds([body])
    if abs(lo.z) > 0.001:
        arm.location.z -= lo.z
        apply_transforms(family)
        changes.append(f"moved feet {-lo.z:+.3f} m to z=0")
    head = find_bone(arm, "head")
    facing = "-Y"
    if eyes is not None and head is not None:
        eye_c = sum((eyes.matrix_world @ v.co for v in eyes.data.vertices), Vector()) / len(eyes.data.vertices)
        if eye_c.y > (arm.matrix_world @ head.head_local).y:
            arm.rotation_euler = (0, 0, 3.14159265)
            apply_transforms(family)
            facing = "+Y (rotated 180°)"
            changes.append("rotated 180° to face -Y")
    lo, hi = world_bounds([body])
    return {"heightM": round(hi.z - lo.z, 3), "feetZ": round(lo.z, 4), "facing": facing, "changes": changes}


def assign_regions(body: bpy.types.Object, arm: bpy.types.Object, region_cfg: dict[str, Any],
                   contract: dict[str, Any]) -> dict[str, int]:
    rules, default = compile_region_map(region_cfg)
    deform = {b.name for b in arm.data.bones if b.use_deform}
    weights = vertex_weights(body, deform)
    faces = [list(p.vertices) for p in body.data.polygons]
    regions = face_regions(faces, weights, rules, default)
    order = contract["materials"]["bodyRegions"]
    body.data.materials.clear()
    for name in order:
        body.data.materials.append(flat_material(name))
    counts = {name: 0 for name in order}
    for poly, region in zip(body.data.polygons, regions):
        idx = order.index(region) if region in order else order.index(default)
        poly.material_index = idx
        counts[order[idx]] += 1
    return counts


def build_body(path: Path, inv: Inventory, contract: dict[str, Any], region_cfg: dict[str, Any],
               cfg: dict[str, Any], hair_files: list[Path], canonical: dict[str, list[float]] | None,
               ctx: Ctx, report: Report) -> dict[str, Any]:
    bid = body_id(path.stem)
    report.info(f"{bid}: {path.name}")
    reset_scene()
    objs = import_model(path)
    arms = armatures(objs)
    if len(arms) != 1:
        raise RuntimeError(f"{bid}: expected one armature, found {len(arms)}")
    arm = arms[0]
    mesh_objs = meshes(objs)
    eyes = next((m for m in mesh_objs if re.search(r"eye(?!brow)", m.name, re.I)), None)
    brows = next((m for m in mesh_objs if re.search(r"brow", m.name, re.I)), None)
    body = max((m for m in mesh_objs if m not in (eyes, brows)), key=triangle_count)
    norm = normalise_body(arm, body, eyes, contract, report, bid)
    reoriented: dict[str, Any] = {"applied": False}
    if canonical is not None:
        changed, bone = reorient(arm, canonical)
        left, _ = max_rest_diff(rest_rotations(arm), canonical)
        reoriented = {"applied": True, "maxChangeDeg": changed, "maxChangeBone": bone, "residualDeg": left}
        if left > 0.05:
            report.error(f"{bid}: rest frames still {left}° off the clip skeleton after re-orienting")

    body_tris_before = triangle_count(body)
    body_ratio = 1.0
    if cfg.get("bodyMaxTris"):
        body_ratio = decimate_to(body, int(cfg["bodyMaxTris"]))
        report.info(f"{bid}: body decimated {body_tris_before} -> {triangle_count(body)} tris (bodyMaxTris)")
    regions = assign_regions(body, arm, region_cfg, contract)
    avatar = contract["avatar"]
    mask_faces = write_body_mask(body, arm, avatar)
    for zone, n in mask_faces.items():
        if n == 0:
            report.error(f"{bid}: mask zone {zone} has no faces; check avatar.maskRules/maskSplits in contract.json")
    for name, n in regions.items():
        if n == 0:
            report.error(f"{bid}: region {name} has no faces; adjust art/config/region-map.json")
    strip_extras(body)
    body.name = "body"
    hair_mat = flat_material("HAIR")
    if eyes is not None:
        set_single_material(eyes, flat_material("EYES"))
        strip_extras(eyes)
        label_mesh(eyes, avatar, "EYES")
        eyes.name = "eyes"
    else:
        report.warn(f"{bid}: no Eyes mesh found")
    brow_ratio = 1.0
    if brows is not None:
        set_single_material(brows, hair_mat)
        strip_extras(brows)
        brow_ratio = decimate_to(brows, cfg["eyebrowsMaxTris"])
        label_mesh(brows, avatar, "BROWS")
        brows.name = "eyebrows"

    head = find_bone(arm, "head")
    if head is None:
        raise RuntimeError(f"{bid}: no head bone among {bone_names(arm)[:10]}…")
    head_pos = arm.matrix_world @ head.head_local
    budget = contract["budgets"]["characterLod0"]
    base_tris = sum(triangle_count(o) for o in (body, eyes, brows) if o is not None)
    hair_room = budget["triangles"] - base_tris
    hairs: list[tuple[bpy.types.Object, dict[str, Any]]] = []
    rejected: list[dict[str, Any]] = []
    for hf in hair_files:
        hair, info = fit_hair(hf, arm, head_pos, cfg, hair_mat)
        if hair is None:
            rejected.append(info)
            report.warn(f"{bid}: hair {hf.name} rejected ({info.get('rejected')})")
            continue
        hairs.append((hair, info))
    hairs.sort(key=lambda h: triangle_count(h[0]))
    keep = hairs[: contract["character"]["hairMax"]]
    delete_objects([h for h, _ in hairs[len(keep):]])
    hair_list = []
    for n, (hair, info) in enumerate(keep, start=1):
        ratio = decimate_to(hair, hair_room) if hair_room > 0 else 1.0
        if ratio < 1.0:
            report.warn(f"{bid}: {info['file']} decimated to {ratio:.0%} to fit the {budget['triangles']} tri budget")
        hair.name = contract["character"]["hairNames"].format(n=n)
        label_mesh(hair, avatar, "HAIR")
        hair["defaultVisible"] = n == 1
        hair_list.append({"name": hair.name, **info, "triangles": triangle_count(hair), "decimateRatio": ratio})
    purge_orphans()

    max_hair = max((h["triangles"] for h in hair_list), default=0)
    total = base_tris + max_hair
    bones = deform_bone_count(arm)
    if total > budget["triangles"]:
        report.error(f"{bid}: {total} tris (body + largest hair) > {budget['triangles']}")
    if bones > budget["deformBones"]:
        report.error(f"{bid}: {bones} deform bones > {budget['deformBones']}")
    if len(hair_list) < contract["character"]["hairMax"]:
        report.warn(f"{bid}: {len(hair_list)} hairstyles available (target {contract['character']['hairMax']}); the free pack has no more")

    out = ctx.export / "characters" / f"{bid}.glb"
    export_objs = [arm, body] + [o for o in (eyes, brows) if o is not None] + [h for h, _ in keep]
    for o in export_objs:
        o.data.name = o.name  # glTF mesh names follow the data block, not the object
    export_glb(out, export_objs, animations=False, attributes=True)
    report.info(f"{bid}: {total} tris, {bones} bones, regions {regions} -> {out.name}")
    return {
        "id": bid,
        "source": str(path.relative_to(inv.packs_dir)).replace("\\", "/"),
        "export": f"characters/{out.name}",
        "fileKB": round(out.stat().st_size / 1024, 1),
        **norm,
        "triangles": {"body": triangle_count(body), "eyes": triangle_count(eyes) if eyes else 0,
                      "eyebrows": triangle_count(brows) if brows else 0, "eyebrowsDecimateRatio": brow_ratio,
                      "largestHair": max_hair, "totalWithLargestHair": total, "budget": budget["triangles"]},
        "deformBones": bones,
        "boneNames": bone_names(arm),
        "jointFramesToClipSkeleton": reoriented,
        "regionFaces": {**regions, "EYES": len(eyes.data.polygons) if eyes else 0},
        "maskFaces": mask_faces,
        "bodyDecimation": {"before": body_tris_before, "after": triangle_count(body), "ratio": body_ratio},
        "hairs": hair_list,
        "hairsRejected": rejected,
        "materials": sorted({m.name for o in export_objs if o.type == "MESH" for m in o.data.materials}),
    }


def main(ctx: Ctx, report: Report) -> None:
    contract, notes = load_contract(ctx.art)
    for n in notes:
        report.info(n)
    region_cfg, _ = load_or_create(ctx.art / "config" / "region-map.json", REGION_MAP_DEFAULT)
    cfg, _ = load_or_create(ctx.art / "config" / "characters.json", CHARACTERS_DEFAULT)
    inv = Inventory.load(ctx.reports)
    if not inv.has_pack(PACK):
        report.skip(f"pack {PACK} not downloaded")
        return
    bodies = inv.find(PACK, name=cfg["bodyFile"])
    if not bodies:
        report.error(f"no body files matching /{cfg['bodyFile']}/ in {PACK}")
        return
    hair_all = [p for p in inv.find(PACK, name=cfg["hairFile"])
                if not any(re.search(x, p.stem, re.I) for x in cfg["hairExclude"])]
    preferred = [p for p in hair_all if cfg["hairPathPrefer"].lower() in str(p).lower()]
    hair_files = preferred or hair_all
    report.info(f"bodies: {[b.name for b in bodies]}; hairs: {[h.name for h in hair_files]}")
    canonical = canonical_rest(inv, ctx.reports)
    if canonical is None:
        report.warn("animation library missing: bodies keep their own joint frames, so shared clips may pose them slightly wrong")
    report.stats["characters"] = [
        build_body(b, inv, contract, region_cfg, cfg, hair_files, canonical, ctx, report) for b in bodies
    ]


if __name__ == "__main__":
    run_step(main)
