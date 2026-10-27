"""art:animations - Universal Animation Library -> contract-named, in-place clips in one GLB.

Lists every action, checks the rig matches the base characters, picks clips via
art/config/clip-map.json, pins hips horizontally (keeps Z bob), exports one animation per NLA
track, then re-imports the file to prove every clip survived.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib.contract import load_contract  # noqa: E402
from lib.discovery import Inventory  # noqa: E402
from lib.drift import max_drift, net_drift  # noqa: E402
from lib.export import export_glb  # noqa: E402
from lib.glb import keep_animation_channels  # noqa: E402
from lib.jsonfile import load_or_create  # noqa: E402
from lib.matching import map_bones, pick_name, strip_suffix  # noqa: E402
from lib.mixamo import bone_map, pick_file  # noqa: E402
from lib.retarget import bake  # noqa: E402
from lib.report import Report  # noqa: E402
from lib.scene import armatures, bone_names, delete_objects, find_bone, import_model, meshes, reset_scene  # noqa: E402
from lib.skeleton import max_rest_diff, rest_rotations  # noqa: E402
from lib.step import Ctx, run_step  # noqa: E402

PACK = "universal-animation-library"
BODY_PACK = "universal-base-characters"

CLIP_MAP_DEFAULT: dict[str, Any] = {
    "note": "Contract clip -> candidate action-name regexes (case-insensitive), best first. Names are matched without the importer's '_Armature' suffix. See art/reports/animations.json for every action in the pack.",
    "sourceFile": "^UAL",
    "avoidFile": "_RM$",
    "rootBones": ["root", "pelvis"],
    "clips": {
        "idle": ["^Idle_Loop$", "^Idle"],
        "walk": ["^Walk_Loop$", "^Walk"],
        "run": ["^Jog_Fwd_Loop$", "^Sprint_Loop$", "^Run"],
        "jump_start": ["^Jump_Start$"],
        "jump_air": ["^Jump_Loop$", "^Jump_Air", "^Fall"],
        "jump_land": ["^Jump_Land$"],
        "sit_idle": ["^Sitting_Idle_Loop$", "^Sit.*Idle"],
        "emote_wave": ["Wave", "Waving"],
        "emote_clap": ["Clap"],
        "emote_dance": ["^Dance_Loop$", "Dance"],
        "emote_cheer": ["Cheer", "Victory", "Celebrat"],
        "emote_point": ["Point"],
        "emote_sit": ["Sit_?Floor", "Sit_?Ground", "Ground_?Sit"],
        "talk": ["^Idle_Talking_Loop$", "Talk"],
    },
    "mixamoDir": "mixamo",
    "mixamoFiles": {
        "emote_wave": ["^Waving", "Wave"],
        "emote_clap": ["^Clapping", "Clap"],
        "emote_cheer": ["^Cheering", "Cheer", "Victory"],
        "emote_point": ["^Pointing", "Point"],
        "emote_sit": ["Sitting.*(Floor|Ground)", "Sit.*Ground", "^Sitting Idle"],
    },
    "mixamo": {
        "emote_wave": "Waving",
        "emote_clap": "Clapping",
        "emote_cheer": "Cheering",
        "emote_point": "Pointing",
        "emote_sit": "Sitting Idle (on floor) / Sit To Ground",
        "emote_dance": "Hip Hop Dancing",
        "talk": "Talking",
        "sit_idle": "Sitting Idle",
    },
}


def fps() -> float:
    r = bpy.context.scene.render
    return r.fps / r.fps_base


def set_frame(t: float) -> None:
    whole = int(t // 1)
    bpy.context.scene.frame_set(whole, subframe=t - whole)


def hip_samples(arm: bpy.types.Object, bone: str, action: bpy.types.Action) -> list[tuple[float, float]]:
    """World XY of a bone's head at every frame of the action."""
    arm.animation_data.action = action
    pb = arm.pose.bones[bone]
    start, end = action.frame_range
    out = []
    f = start
    while f <= end + 1e-6:
        set_frame(f)
        p = arm.matrix_world @ pb.head
        out.append((p.x, p.y))
        f += 1.0
    return out


def pin_horizontal(arm: bpy.types.Object, action: bpy.types.Action, bone_name: str) -> bool:
    """Rewrite a bone's location keys so its head stays at its rest XY (Z untouched)."""
    pb = arm.pose.bones.get(bone_name)
    if pb is None:
        return False
    path = f'pose.bones["{bone_name}"].location'
    curves = {fc.array_index: fc for fc in action.fcurves if fc.data_path == path}
    if not curves:
        return False
    times = sorted({round(k.co.x, 4) for fc in curves.values() for k in fc.keyframe_points})
    arm.animation_data.action = action
    bone = pb.bone
    rest_xy = (arm.matrix_world @ bone.head_local).xy
    new_values: dict[float, Vector] = {}
    for t in times:
        set_frame(t)
        head = arm.matrix_world @ pb.head
        d = Vector((head.x - rest_xy.x, head.y - rest_xy.y, 0.0))
        if pb.parent is not None:
            pre = pb.parent.matrix @ pb.parent.bone.matrix_local.inverted() @ bone.matrix_local
        else:
            pre = bone.matrix_local
        world_rot = arm.matrix_world.to_3x3() @ pre.to_3x3()
        new_values[t] = pb.location.copy() + world_rot.inverted() @ (-d)
    for i in range(3):
        fc = curves.get(i) or action.fcurves.new(path, index=i, action_group=bone_name)
        existing = {round(k.co.x, 4): k for k in fc.keyframe_points}
        for t in times:
            v = new_values[t][i]
            k = existing.get(t)
            if k is None:
                fc.keyframe_points.insert(t, v, options={"FAST"})
            else:
                delta = v - k.co.y
                k.co.y = v
                k.handle_left.y += delta
                k.handle_right.y += delta
        fc.update()
    return True


def prepare_for_skeleton(action: bpy.types.Action, hip: str, scale: float) -> None:
    """Drop translation and scale tracks except the hips' translation, which is scaled by `scale`."""
    hip_path = f'pose.bones["{hip}"].location'
    for fc in list(action.fcurves):
        path = fc.data_path
        if path.endswith(".scale") or (path.endswith(".location") and path != hip_path):
            action.fcurves.remove(fc)
        elif path == hip_path and scale != 1.0:
            for kp in fc.keyframe_points:
                kp.co.y *= scale
                kp.handle_left.y *= scale
                kp.handle_right.y *= scale
            fc.update()


def import_mixamo(
    file: Path, target: bpy.types.Object, clip: str, hip: str, dst_fps: float
) -> tuple[bpy.types.Action, dict[str, Any]]:
    """Imports one Mixamo FBX, bakes it onto `target` as `clip`, and removes the FBX rig again."""
    render = bpy.context.scene.render
    fps_before = (render.fps, render.fps_base)
    objs = import_model(file)
    # The FBX importer switches the scene to the file's frame rate; read it, then put ours back.
    src_fps = render.fps / render.fps_base
    render.fps, render.fps_base = fps_before
    src = armatures(objs)[0]
    if src.animation_data is None or src.animation_data.action is None:
        raise RuntimeError(f"{file.name} has no animation")
    mapping = bone_map(bone_names(src), bone_names(target))
    hip_src = next((s for s, t in mapping.items() if t == hip), None)
    if hip_src is None:
        raise RuntimeError(f"{file.name}: no bone maps to {hip}")
    source_action = src.animation_data.action
    action, stats = bake(src, target, mapping, clip, src_fps, dst_fps, hip_src, hip)
    delete_objects(objs)
    bpy.data.actions.remove(source_action)
    return action, stats


def main(ctx: Ctx, report: Report) -> None:
    contract, _ = load_contract(ctx.art)
    cfg, _ = load_or_create(ctx.art / "config" / "clip-map.json", CLIP_MAP_DEFAULT)
    inv = Inventory.load(ctx.reports)
    if not inv.has_pack(PACK):
        report.skip(f"pack {PACK} not downloaded")
        return
    import re

    candidates = inv.find(PACK, name=cfg["sourceFile"])
    preferred = [p for p in candidates if not re.search(cfg["avoidFile"], p.stem, re.I)]
    sources = preferred or candidates
    if not sources:
        report.error(f"no animation file matching /{cfg['sourceFile']}/ in {PACK}")
        return
    src = sources[0]
    report.info(f"source: {src.name}")
    reset_scene()
    bodies = sorted((ctx.export / "characters").glob("body_*_m.glb")) + sorted((ctx.export / "characters").glob("body_*.glb"))
    target: bpy.types.Object | None = None
    if bodies:
        body_objs = import_model(bodies[0])
        target = armatures(body_objs)[0]
        delete_objects(meshes(body_objs))
        target.name = "clips_skeleton"
        report.info(f"clip skeleton: {bodies[0].name} (canonical joint frames, its proportions)")
    else:
        report.warn("no character export yet: clips keep the library skeleton (run art:characters first)")
    objs = import_model(src)
    arms = armatures(objs)
    if len(arms) != 1:
        raise RuntimeError(f"expected one armature in {src.name}, found {len(arms)}")
    arm = arms[0]
    delete_objects(meshes(objs))
    suffix = f"_{arm.name}"
    rate = fps()
    all_actions = [
        {"name": strip_suffix(a.name, suffix), "frames": [round(a.frame_range[0], 2), round(a.frame_range[1], 2)],
         "seconds": round((a.frame_range[1] - a.frame_range[0]) / rate, 3)}
        for a in bpy.data.actions
    ]
    report.info(f"{len(all_actions)} actions at {rate:g} fps: {[a['name'] for a in all_actions]}")

    # Rig match against the base characters (bone names from inspect's body sample).
    anim_bones = bone_names(arm)
    body_sample = next(
        (s for p in [BODY_PACK] if inv.has_pack(p) for s in inv.data["packs"][p]["samples"]
         if "fullbody" in s["path"].lower() and s["armatures"]), None)
    rig: dict[str, Any] = {"animationBones": len(anim_bones)}
    if body_sample is None:
        report.warn("no base character sample in inspect.json; rig match not checked")
    else:
        body_bones = body_sample["armatures"][0]["bones"]
        rig["characterBones"] = len(body_bones)
        if set(body_bones) == set(anim_bones):
            rig["match"] = "identical names; no retargeting"
        else:
            mapping = map_bones(anim_bones, body_bones)
            rig["match"] = "names differ"
            rig["mapping"] = mapping
            unmapped = [b for b in anim_bones if b not in mapping]
            report.error(f"rig mismatch ({len(unmapped)} unmapped: {unmapped[:8]}); retargeting needs matching "
                         "rest poses, so stopping here. See the mapping in the report.")
            report.stats.update({"actions": all_actions, "rig": rig})
            return
    if target is not None:
        diff, bone = max_rest_diff(rest_rotations(target), rest_rotations(arm))
        rig["restFrameDiffDeg"] = {"max": diff, "bone": bone}
        if diff > 0.5:
            report.error(f"clip skeleton joint frames differ from the library by {diff}° ({bone}); "
                         "re-run art:characters so bodies use the canonical frames")
            report.stats.update({"actions": all_actions, "rig": rig})
            return

    # Choose clips.
    by_name = {strip_suffix(a.name, suffix): a for a in bpy.data.actions}
    chosen: dict[str, bpy.types.Action] = {}
    clips_report: dict[str, Any] = {}
    mixamo_dir = inv.packs_dir / cfg.get("mixamoDir", "mixamo")
    mixamo_files = sorted(mixamo_dir.glob("*.fbx")) if mixamo_dir.is_dir() else []
    from_mixamo: dict[str, Path] = {}
    for clip in contract["clips"]:
        pick = pick_name(cfg["clips"].get(clip, []), list(by_name))
        file = pick_file(cfg.get("mixamoFiles", {}).get(clip, []), mixamo_files) if pick.chosen is None else None
        if file is not None:
            from_mixamo[clip] = file
            continue
        if pick.chosen is None:
            hint = cfg["mixamo"].get(clip, clip)
            clips_report[clip] = {"status": "MISSING", "suggestion": f"get '{hint}' from Mixamo; see ART_PIPELINE Step 3"}
            report.warn(f"{clip}: MISSING -> Mixamo '{hint}'")
            continue
        action = by_name[pick.chosen]
        if action in chosen.values():
            action = action.copy()
        chosen[clip] = action
        clips_report[clip] = {"status": "found", "source": pick.chosen, "pattern": pick.pattern,
                              "alternatives": pick.alternatives}
        report.info(f"{clip} <- {pick.chosen}" + (f" (alternatives: {pick.alternatives})" if pick.alternatives else ""))

    # Move the clips onto the clip skeleton: rotations everywhere, translation on the hips only
    # (scaled to this skeleton's hip height), so every body keeps its own proportions.
    hip_name = (find_bone(arm, cfg["rootBones"][-1]) or arm.data.bones[0]).name
    k = 1.0
    if target is not None:
        k = target.data.bones[hip_name].head_local.z / arm.data.bones[hip_name].head_local.z
    for action in chosen.values():
        prepare_for_skeleton(action, hip_name, k)
    rig["hipHeightScale"] = round(k, 4)
    arm = target or arm

    # Clips the library lacks, from Mixamo FBX files in ART_PACKS_DIR/mixamo (ART_PIPELINE Step 3).
    if from_mixamo and target is None:
        report.error("Mixamo clips need the clip skeleton: run art:characters first")
    elif from_mixamo:
        for clip, file in from_mixamo.items():
            action, stats = import_mixamo(file, target, clip, hip_name, rate)
            chosen[clip] = action
            clips_report[clip] = {"status": "found", "source": f"mixamo/{file.name}", **stats}
            report.info(f"{clip} <- mixamo/{file.name} ({stats['mappedBones']} bones, {stats['seconds']} s)")

    # Root motion off: pin hips horizontally for locomotion and emotes.
    if arm.animation_data is None:
        arm.animation_data_create()
    pinned_set = set(contract["rootMotionFreeClips"])
    hip_bone = find_bone(arm, cfg["rootBones"][-1])
    hip = hip_bone.name if hip_bone else cfg["rootBones"][-1]
    for clip, action in chosen.items():
        before = hip_samples(arm, hip, action)
        if clip in pinned_set:
            for b in cfg["rootBones"]:
                bone = find_bone(arm, b)
                if bone is not None:
                    pin_horizontal(arm, action, bone.name)
        after = hip_samples(arm, hip, action)
        drift = max_drift(after)
        clips_report[clip].update({
            "seconds": round((action.frame_range[1] - action.frame_range[0]) / rate, 3),
            "hipDriftCm": {"before": round(max_drift(before) * 100, 2), "after": round(drift * 100, 2),
                           "netAfter": round(net_drift(after) * 100, 2)},
            "rootMotionPinned": clip in pinned_set,
        })
        if clip in pinned_set and drift > contract["hipDriftMaxM"]:
            report.error(f"{clip}: hip drift {drift * 100:.1f} cm > {contract['hipDriftMaxM'] * 100:.0f} cm")

    # Rename, one NLA track per clip, export armature only.
    for a in list(bpy.data.actions):
        if a not in chosen.values():
            bpy.data.actions.remove(a)
    ad = arm.animation_data
    ad.action = None
    for track in list(ad.nla_tracks):  # the glTF importer puts every source clip on a track
        ad.nla_tracks.remove(track)
    for clip, action in chosen.items():
        action.name = clip
        action.use_fake_user = True
        track = ad.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, int(action.frame_range[0]), action)
    out = ctx.export / "animations" / "humanoid_clips.glb"
    arm["pelvisRestHeightM"] = round(arm.data.bones[hip_name].head_local.z, 4)
    arm["note"] = "Rotation tracks for every bone, translation for the hips only. Scale hip translation by bodyHipHeight / pelvisRestHeightM."
    export_glb(out, [arm], animations=True, animation_mode="NLA_TRACKS")
    # Blender samples every channel; keep rotations everywhere and translation on the hips only.
    kept, dropped = keep_animation_channels(
        out, lambda node, path: path == "rotation" or (path == "translation" and node == hip_name))
    report.info(f"channels kept {kept}, dropped {dropped} (bone translation/scale)")

    # Re-import and verify.
    reset_scene()
    objs = import_model(out)
    arm2 = armatures(objs)[0]
    sfx = f"_{arm2.name}"
    exported = {strip_suffix(a.name, sfx): round((a.frame_range[1] - a.frame_range[0]) / fps(), 3)
                for a in bpy.data.actions}
    extra = sorted(set(exported) - set(chosen))
    if extra:
        report.error(f"re-import: {out.name} has clips outside the contract: {extra}")
    for clip in chosen:
        if clip not in exported:
            report.error(f"re-import: clip {clip} missing from {out.name} (found {sorted(exported)})")
        elif abs(exported[clip] - clips_report[clip]["seconds"]) > 1.5 / rate:
            report.error(f"re-import: {clip} lasts {exported[clip]} s, expected {clips_report[clip]['seconds']} s")
    missing = [c for c, r in clips_report.items() if r["status"] == "MISSING"]
    report.stats.update({
        "source": str(src.relative_to(inv.packs_dir)).replace("\\", "/"),
        "fps": rate,
        "actions": all_actions,
        "rig": rig,
        "clips": clips_report,
        "found": len(chosen),
        "required": len(contract["clips"]),
        "missing": missing,
        "maxHipDriftCm": max((r["hipDriftCm"]["after"] for r in clips_report.values()
                              if r.get("rootMotionPinned")), default=0),
        "export": "animations/humanoid_clips.glb",
        "channels": {"kept": kept, "dropped": dropped},
        "fileKB": round(out.stat().st_size / 1024, 1),
        "reimported": exported,
    })
    report.info(f"{len(chosen)}/{len(contract['clips'])} clips -> {out.name}; missing {missing}")


if __name__ == "__main__":
    run_step(main)
