"""art:hair - the hair, facial hair and headwear catalogue for every body, pose-tested.

Styles live in `art/config/hair.json` only. Quaternius pack hairs are re-fitted where the catalogue
maps them (`quaternius` parts); everything else comes from the generator blocks in lib/hairgen.
Exports `art/export/{hair,facial,headwear}/<id>_<m|f>.glb` + a manifest per kind.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent))

from lib.avatar import budget_for, family_coverage  # noqa: E402
from lib.contract import load_contract  # noqa: E402
from lib.discovery import Inventory  # noqa: E402
from lib.glbcheck import check_glb  # noqa: E402
from lib.hairgen.base import make_ctx  # noqa: E402
from lib.hairgen.build import build_style  # noqa: E402
from lib.headframe import measure  # noqa: E402
from lib.jsonfile import write_json  # noqa: E402
from lib.posetest import PoseSet, hair_pose, push_hair, run_poses, summarise  # noqa: E402
from lib.report import Report  # noqa: E402
from lib.rig import export_item, load_body, load_clips  # noqa: E402
from lib.scene import delete_objects, reset_scene, triangle_count  # noqa: E402
from lib.step import Ctx, run_step  # noqa: E402

PACK = "universal-base-characters"
KINDS = ("hair", "facial", "headwear")
FIX_ROUNDS = 3


def pack_hairs(ctx: Ctx, cfg_chars: dict[str, Any], report: Report) -> dict[str, Path]:
    """Quaternius hair files by stem, preferring the head-rigged glTFs (found via art:inspect)."""
    try:
        inv = Inventory.load(ctx.reports)
    except FileNotFoundError:
        report.warn("art/reports/inspect.json missing: Quaternius styles skipped (run pnpm art:inspect)")
        return {}
    if not inv.has_pack(PACK):
        report.warn(f"pack {PACK} not downloaded: Quaternius styles skipped")
        return {}
    files = inv.find(PACK, name=cfg_chars.get("hairFile", "^Hair_"))
    pref = cfg_chars.get("hairPathPrefer", "rigged to head bone").lower()
    out: dict[str, Path] = {}
    for f in sorted(files, key=lambda f: pref not in str(f).lower()):
        out.setdefault(f.stem, f)
    return out


def ignored_faces(rig: Any, hf: Any, avatar: dict[str, Any], kind: str) -> set[int]:
    """Body faces the test skips: limbs (arms swing through long hair; the rule covers shoulders, chest
    and face), plus the scalp for hair or the whole head for facial hair and headwear (they sit on it)."""
    head = avatar["bodyMask"]["head"]
    limbs = sum(avatar["bodyMask"][z] for z in ("upperarm", "upperarm_lo", "forearm", "hand", "thigh", "knee", "calf", "calf_lo", "foot"))
    mw = rig.body.matrix_world
    out = {p.index for p in rig.body.data.polygons if rig.face_mask[p.index] & limbs}
    for p in rig.body.data.polygons:
        if not rig.face_mask[p.index] & head:
            continue
        c = mw @ p.center
        if kind != "hair" or c.z > hf.hairline_z(c) - 0.012:
            out.add(p.index)
    return out


def test_style(rig: Any, obj: Any, ignore: set[int], poses: PoseSet, limit: float, report: Report, label: str) -> dict[str, Any]:
    fixes = []
    for round_no in range(FIX_ROUNDS + 1):
        results = run_poses(rig, poses, lambda: hair_pose(rig, obj, ignore))
        summary = summarise(results, limit)
        if summary["pass"] or round_no == FIX_ROUNDS:
            break
        spots = {}
        for r in results.values():
            for i, d in r["_spots"]:
                spots[i] = max(spots.get(i, 0.0), d)
        moved = push_hair(rig, obj, sorted(spots.items()))
        fixes.append({"round": round_no + 1, "worstCm": summary["maxPenetrationCm"], "verticesMoved": moved})
        report.info(f"{label}: {summary['maxPenetrationCm']} cm into the body; moved {moved} vertices out")
    summary["fixes"] = fixes
    return summary


def main(ctx: Ctx, report: Report) -> None:
    contract, notes = load_contract(ctx.art)
    for n in notes:
        report.info(n)
    avatar = contract["avatar"]
    path = ctx.art / "config" / "hair.json"
    if not path.exists():
        report.error("art/config/hair.json is missing; it holds the whole catalogue")
        return
    cfg = json.loads(path.read_text(encoding="utf-8"))
    chars = json.loads((ctx.art / "config" / "characters.json").read_text(encoding="utf-8"))
    problems = family_coverage(cfg["hair"], avatar["families"]["required"], int(avatar["families"]["minStyles"]))
    for p in problems:
        report.error(f"hair coverage rule: {p}")
    bodies = sorted((ctx.export / "characters").glob("body_*.glb"))
    if not bodies:
        report.error("no bodies in art/export/characters; run pnpm art:characters first")
        return
    pack = pack_hairs(ctx, chars, report)
    limit = float(avatar["poseTest"]["maxPenetrationCm"])
    manifests: dict[str, dict[str, dict[str, Any]]] = {k: {} for k in KINDS}
    tests: dict[str, Any] = {}
    for kind in KINDS:
        out_dir = ctx.export / kind
        out_dir.mkdir(parents=True, exist_ok=True)
        wanted = {f"{s['id']}_{b.stem.rsplit('_', 1)[-1]}.glb" for s in cfg[kind] for b in bodies}
        for old in out_dir.glob("*.glb"):
            if old.name not in wanted:
                old.unlink()
    pose_notes: list[str] = []
    for body in bodies:
        reset_scene()
        rig = load_body(body, avatar)
        hf = measure(rig, avatar["bodyMask"]["head"])
        hctx = make_ctx(rig, hf, avatar)
        poses = PoseSet.resolve(avatar["poseTest"], load_clips(ctx.export / "animations" / "humanoid_clips.glb"))
        pose_notes = poses.notes
        for kind in KINDS:
            ignore = ignored_faces(rig, hf, avatar, kind)
            for style in cfg[kind]:
                label = f"{kind}/{style['id']}_{rig.sex}"
                entry = manifests[kind].setdefault(style["id"], {
                    "id": style["id"], "name": style.get("name", style["id"]), "family": style.get("family"),
                    "length": style.get("length"), "method": style.get("method", "generated"),
                    "bodies": [], "files": {}, "tris": {}, "thumb": f"{kind}/thumbs/{style['id']}.png",
                    "hidesHair": bool(style.get("hidesHair", False)), "hidesHairMask": int(style.get("hidesHairMask", 0)),
                    "capIncompatible": bool(style.get("capIncompatible", False)), "unlock": style.get("unlock"),
                })
                entry["bodies"].append(rig.bid)
                if not style.get("parts"):
                    entry["files"][rig.bid] = None
                    entry["tris"][rig.bid] = 0
                    continue
                budget = budget_for(kind, style, avatar["budgets"])
                try:
                    obj = build_style(hctx, style, kind, budget, pack, chars)
                except Exception as exc:  # noqa: BLE001 - one broken style must not hide the rest
                    report.error(f"{label}: {type(exc).__name__}: {exc}")
                    continue
                tris = triangle_count(obj)
                if tris > budget:
                    report.error(f"{label}: {tris} tris > budget {budget}")
                result = test_style(rig, obj, ignore, poses, limit, report, label)
                if not result["pass"]:
                    report.error(f"{label}: {result['maxPenetrationCm']} cm into the body after fixes (limit {limit} cm)")
                out = ctx.export / kind / f"{style['id']}_{rig.sex}.glb"
                obj.name = style["id"]
                export_item(out, obj, rig)
                check = check_glb(out, attributes=[avatar["attributes"]["region"], avatar["attributes"]["mask"]], skeleton=rig.joints)
                if check["joints"] != rig.joints:
                    check["problems"].append(f"{out.name}: joint order differs from the body skeleton")
                for p in check["problems"]:
                    report.error(p)
                entry["files"][rig.bid] = f"{kind}/{out.name}"
                entry["tris"][rig.bid] = tris
                tests[label] = {"tris": tris, "budget": budget, "poseTest": result,
                                "reimport": {k: v for k, v in check.items() if k != "joints"}}
                report.info(f"{label}: {tris} tris, max {result['maxPenetrationCm']} cm")
                delete_objects([obj])
    for n in pose_notes:
        report.warn(n)
    for kind in KINDS:
        write_json(ctx.export / kind / "manifest.json", {"version": 1, "items": list(manifests[kind].values())})
    counts = {f: sum(1 for s in cfg["hair"] if s.get("family") == f) for f in avatar["families"]["required"]}
    report.stats.update({"tests": tests, "familyCounts": counts, "coverageProblems": problems,
                         "quaternius": sorted(pack), "poseNotes": pose_notes,
                         "manifests": {k: list(v.values()) for k, v in manifests.items()}})


if __name__ == "__main__":
    run_step(main)
