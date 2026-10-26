"""art:wardrobe - generated tops, bottoms, shoes and accessories for every body, pose-tested.

Item definitions live in `art/config/wardrobe.json` only (no defaults in code).
Exports `art/export/wardrobe/<id>_<m|f>.glb` + `manifest.json`; budgets come from contract.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent))

from lib.accessories import build_modelled  # noqa: E402
from lib.attributes import face_attr  # noqa: E402
from lib.avatar import bits, budget_for, zone_names  # noqa: E402
from lib.avatar_palettes import load_hair, load_harmony, load_skin  # noqa: E402
from lib.contract import load_contract  # noqa: E402
from lib.garment import build_garment  # noqa: E402
from lib.glbcheck import check_glb  # noqa: E402
from lib.headframe import measure  # noqa: E402
from lib.jsonfile import write_json  # noqa: E402
from lib.posetest import PoseSet, body_sets, garment_pose, hair_pose, push_garment, run_poses, summarise, under_garment  # noqa: E402
from lib.report import Report  # noqa: E402
from lib.rig import body_vertex_weights, export_item, load_body, load_clips  # noqa: E402
from lib.scene import delete_objects, reset_scene, triangle_count  # noqa: E402
from lib.step import Ctx, run_step  # noqa: E402

FIX_ROUNDS = 3
UNCOVERED_WARN_PCT = 5.0


def region_names(obj: Any, avatar: dict[str, Any]) -> list[str]:
    by_index = {v: k for k, v in avatar["regions"].items()}
    used = {int(round(x)) for x in face_attr(obj, avatar["attributes"]["region"])}
    return [by_index[i] for i in sorted(used)]


def always_hidden(items: list[dict[str, Any]], mask: dict[str, int]) -> int:
    """Zones hidden whatever the outfit: every avatar wears a top, a bottom and shoes."""
    out = 0
    for slot in ("top", "bottom", "shoes"):
        group = [bits(mask, i.get("hides", [])) for i in items if i["slot"] == slot]
        common = group[0] if group else 0
        for g in group[1:]:
            common &= g
        out |= common
    return out


def test_garment(rig: Any, obj: Any, inner: list[bool], hides: int, always: int, poses: PoseSet, limit: float,
                 report: Report, label: str) -> dict[str, Any]:
    """Pose-test; on failure push the shell out locally and test again (up to FIX_ROUNDS).

    Coverage checks this item's own `hides`; poke-through checks skin that is still visible once the
    zones every outfit hides (`always`) are gone, because only that skin can show through a hem.
    """
    outer = [not x for x in inner]
    hidden, _ = body_sets(rig, hides)
    _, visible = body_sets(rig, hides | always)
    under = under_garment(rig, obj, visible, outer)
    fixes = []
    best: tuple[float, list[Any], dict[str, Any]] | None = None
    for round_no in range(FIX_ROUNDS + 1):
        results = run_poses(rig, poses, lambda: garment_pose(rig, obj, outer, hidden, under))
        summary = summarise(results, limit)
        if best is not None and summary["maxPenetrationCm"] >= best[0]:
            obj.data.vertices.foreach_set("co", best[1])  # that push made it worse: keep the best shape
            obj.data.update()
            summary = best[2]
            fixes.append({"round": round_no, "reverted": True})
            break
        coords = [0.0] * (len(obj.data.vertices) * 3)
        obj.data.vertices.foreach_get("co", coords)
        best = (summary["maxPenetrationCm"], coords, summary)
        if summary["pass"] or round_no == FIX_ROUNDS:
            break
        spots = [s for r in results.values() for s in r["_spots"] if s[1] * 100 > limit * 0.5]
        moved = push_garment(obj, spots, margin=0.004)
        fixes.append({"round": round_no + 1, "spots": len(spots), "verticesPushed": moved,
                      "worstCm": summary["maxPenetrationCm"]})
        report.info(f"{label}: {summary['maxPenetrationCm']} cm poke-through; pushed {moved} vertices out")
    summary["fixes"] = fixes
    summary["underVertices"] = len(under)
    worst = max(summary.get("uncoveredPct", {}).values(), default=0.0)
    if worst > UNCOVERED_WARN_PCT:
        report.warn(f"{label}: {worst}% of hidden skin has no garment over it in some pose (check the previews)")
    return summary


def build_one(rig: Any, hf: Any, item: dict[str, Any], cfg: dict[str, Any], avatar: dict[str, Any],
              weights: list[dict[str, float]], poses: PoseSet, always: int, report: Report) -> tuple[Any, dict[str, Any]]:
    kind = item["slot"]
    budget = budget_for(kind, item, avatar["budgets"])
    hides = bits(avatar["bodyMask"], item.get("hides", []))
    limit = float(avatar["poseTest"]["maxPenetrationCm"])
    label = f"{item['id']}_{rig.sex}"
    if item.get("modelled"):
        obj, info = build_modelled(item["modelled"], rig, hf, avatar, weights)
        results = run_poses(rig, poses, lambda: hair_pose(rig, obj, set()))
        info["poseTest"] = summarise(results, limit if hides else 2 * limit)
        info["poseTest"]["note"] = "deepest vertex inside the body"
    else:
        ratio = 1.0
        for attempt in range(4):
            obj, info, inner = build_garment(rig, item, cfg["defaults"], avatar, weights, budget, ratio)
            tris = triangle_count(obj)
            if tris <= budget or attempt == 3:
                break
            report.info(f"{label}: {tris} tris over {budget}; rebuilding with a smaller shell")
            ratio *= 0.95 * budget / tris
            delete_objects([obj])
        info["poseTest"] = test_garment(rig, obj, inner, hides, always, poses, limit, report, label)
    obj.name = item["id"]
    info["tris"] = triangle_count(obj)
    info["budget"] = budget
    if info["tris"] > budget:
        report.error(f"wardrobe {label}: {info['tris']} tris > budget {budget}")
    if not info["poseTest"]["pass"]:
        report.error(f"wardrobe {label}: {info['poseTest']['maxPenetrationCm']} cm poke-through after fixes "
                     f"(limit {limit} cm) in {info['poseTest']['perPose']}")
    return obj, info


def main(ctx: Ctx, report: Report) -> None:
    contract, notes = load_contract(ctx.art)
    for n in notes:
        report.info(n)
    avatar = contract["avatar"]
    palettes = {"skin": len(load_skin(ctx.art).hexes), "hair": len(load_hair(ctx.art).hexes),
                "harmonyGroups": len(load_harmony(ctx.art))}
    report.stats["palettes"] = palettes
    report.info(f"palettes: {palettes}")
    cfg_path = ctx.art / "config" / "wardrobe.json"
    if not cfg_path.exists():
        report.error("art/config/wardrobe.json is missing; it holds every item definition")
        return
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    bodies = sorted((ctx.export / "characters").glob("body_*.glb"))
    if not bodies:
        report.error("no bodies in art/export/characters; run pnpm art:characters first")
        return
    out_dir = ctx.export / "wardrobe"
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = {f"{i['id']}_{b.stem.rsplit('_', 1)[-1]}.glb" for i in cfg["items"] for b in bodies}
    for old in out_dir.glob("*.glb"):
        if old.name not in wanted:
            old.unlink()
    always = always_hidden(cfg["items"], avatar["bodyMask"])
    report.stats["alwaysHidden"] = zone_names(avatar["bodyMask"], always)
    manifest: dict[str, dict[str, Any]] = {}
    tests: dict[str, Any] = {}
    pose_notes: list[str] = []
    for body in bodies:
        reset_scene()
        rig = load_body(body, avatar)
        weights = body_vertex_weights(rig)
        hf = measure(rig, avatar["bodyMask"]["head"])
        poses = PoseSet.resolve(avatar["poseTest"], load_clips(ctx.export / "animations" / "humanoid_clips.glb"))
        pose_notes = poses.notes
        for item in cfg["items"]:
            obj, info = build_one(rig, hf, item, cfg, avatar, weights, poses, always, report)
            path = out_dir / f"{item['id']}_{rig.sex}.glb"
            export_item(path, obj, rig)
            entry = manifest.setdefault(item["id"], {
                "id": item["id"], "slot": item["slot"], "bodies": [], "files": {}, "tris": {},
                "hides": bits(avatar["bodyMask"], item.get("hides", [])), "hidesZones": item.get("hides", []),
                "colorSlots": region_names(obj, avatar), "hasPrint": bool(item.get("print") or info.get("hasPrint")),
                "unlock": item.get("unlock"), "thumb": f"wardrobe/thumbs/{item['id']}.png",
            })
            entry["bodies"].append(rig.bid)
            entry["files"][rig.bid] = f"wardrobe/{path.name}"
            entry["tris"][rig.bid] = info["tris"]
            tests[f"{item['id']}_{rig.sex}"] = {k: v for k, v in info.items() if not k.startswith("_")}
            report.info(f"{item['id']}_{rig.sex}: {info['tris']} tris, max {info['poseTest']['maxPenetrationCm']} cm")
            check = check_glb(path, attributes=[avatar["attributes"]["region"], avatar["attributes"]["mask"]]
                              + ([avatar["attributes"]["uvPrint"]] if entry["hasPrint"] else []), skeleton=rig.joints)
            if check["joints"] != rig.joints:
                check["problems"].append(f"{path.name}: joint order differs from the body skeleton")
            for p in check["problems"]:
                report.error(p)
            tests[f"{item['id']}_{rig.sex}"]["reimport"] = {k: v for k, v in check.items() if k != "joints"}
            delete_objects([obj])
    for n in pose_notes:
        report.warn(n)
    write_json(out_dir / "manifest.json", {"version": 1, "items": list(manifest.values())})
    report.stats.update({"items": list(manifest.values()), "tests": tests, "poseNotes": pose_notes,
                         "zones": {i["id"]: zone_names(avatar["bodyMask"], i["hides"]) for i in manifest.values()}})


if __name__ == "__main__":
    run_step(main)
