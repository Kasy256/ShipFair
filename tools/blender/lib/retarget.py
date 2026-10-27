"""Bake a Mixamo clip onto our clip skeleton (rest-relative world rotations, scaled hip motion).

Both rigs rest in a T-pose, so each mapped bone takes the source bone's world rotation relative to
its rest and applies it to its own rest: R_target = R_source_pose * R_source_rest^-1 * R_target_rest.
Translation is kept only on the hips, scaled by the hip-height ratio, as the library clips are.
Poses are computed in armature space with our own parent chain, so no depsgraph update per bone.
"""

from __future__ import annotations

from typing import Any

import bpy
from mathutils import Matrix, Quaternion, Vector

from .mixamo import resample_times


def _rot(m: Matrix) -> Quaternion:
    return m.to_3x3().normalized().to_quaternion()


def _depth(bone: bpy.types.Bone) -> int:
    return len(bone.parent_recursive)


def bake(
    src: bpy.types.Object,
    tgt: bpy.types.Object,
    mapping: dict[str, str],
    name: str,
    src_fps: float,
    dst_fps: float,
    hip_src: str,
    hip_tgt: str,
) -> tuple[bpy.types.Action, dict[str, Any]]:
    """Returns a new action on `tgt`'s bones (quaternion rotations + hip location) and stats."""
    action_src = src.animation_data.action
    start, end = action_src.frame_range
    times = resample_times(start, end, src_fps, dst_fps)
    to_tgt = {t: s for s, t in mapping.items()}
    tw = tgt.matrix_world
    tw_rot_inv = _rot(tw).inverted()
    tw_inv = tw.inverted()
    bones = sorted(tgt.data.bones, key=_depth)
    rest = {b.name: b.matrix_local.copy() for b in bones}
    # Rest of each bone relative to its parent's rest: the pose with an identity basis.
    local_rest = {b.name: (rest[b.parent.name].inverted() @ rest[b.name]) if b.parent else rest[b.name] for b in bones}
    src_rest = {s: _rot(src.matrix_world @ src.data.bones[s].matrix_local) for s in mapping}
    tgt_rest = {t: _rot(tw @ rest[t]) for t in to_tgt}
    hip_src_rest = src.matrix_world @ src.data.bones[hip_src].head_local
    hip_tgt_rest = tw @ tgt.data.bones[hip_tgt].head_local
    k = hip_tgt_rest.z / hip_src_rest.z if hip_src_rest.z > 1e-6 else 1.0

    rotations: dict[str, list[Quaternion]] = {b.name: [] for b in bones}
    hip_locs: list[Vector] = []
    min_hip_z = float("inf")
    scene = bpy.context.scene
    for t in times:
        whole = int(t // 1)
        scene.frame_set(whole, subframe=t - whole)
        pose: dict[str, Matrix] = {}
        for b in bones:
            parent = pose[b.parent.name] if b.parent else Matrix.Identity(4)
            unposed = parent @ local_rest[b.name]
            s = to_tgt.get(b.name)
            if s is None:
                m = unposed
            else:
                r_world = _rot(src.matrix_world @ src.pose.bones[s].matrix) @ src_rest[s].inverted() @ tgt_rest[b.name]
                m = Matrix.Translation(unposed.to_translation()) @ (tw_rot_inv @ r_world).to_matrix().to_4x4()
                if b.name == hip_tgt:
                    hip_world = src.matrix_world @ src.pose.bones[s].head
                    world = hip_tgt_rest + (hip_world - hip_src_rest) * k
                    min_hip_z = min(min_hip_z, world.z)
                    m = Matrix.Translation(tw_inv @ world) @ m.to_3x3().to_4x4()
            pose[b.name] = m
            basis = unposed.inverted() @ m
            q = basis.to_quaternion()
            prev = rotations[b.name][-1] if rotations[b.name] else None
            if prev is not None:
                q.make_compatible(prev)
            rotations[b.name].append(q)
            if b.name == hip_tgt:
                hip_locs.append(basis.to_translation())

    action = bpy.data.actions.new(name)
    frames = [float(i + 1) for i in range(len(times))]

    def curve(path: str, index: int, group: str, values: list[float]) -> None:
        fc = action.fcurves.new(path, index=index, action_group=group)
        fc.keyframe_points.add(len(values))
        flat = [v for pair in zip(frames, values) for v in pair]
        fc.keyframe_points.foreach_set("co", flat)
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
        fc.update()

    for b in bones:
        if b.name not in to_tgt and b.name != hip_tgt:
            continue  # unmapped bones stay at rest; no curves needed
        path = f'pose.bones["{b.name}"].rotation_quaternion'
        for i in range(4):
            curve(path, i, b.name, [q[i] for q in rotations[b.name]])
    loc_path = f'pose.bones["{hip_tgt}"].location'
    for i in range(3):
        curve(loc_path, i, hip_tgt, [v[i] for v in hip_locs])
    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"
    stats = {
        "sourceFrames": [round(start, 2), round(end, 2)],
        "sourceFps": src_fps,
        "seconds": round((end - start) / src_fps, 3),
        "frames": len(frames),
        "mappedBones": len(mapping),
        "hipScale": round(k, 4),
        "minHipHeightM": round(min_hip_z, 3),
    }
    return action, stats
