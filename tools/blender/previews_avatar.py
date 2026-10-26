"""Avatar sections of art:previews: item thumbnails, wardrobe grid, hair catalogue, skin x hair matrix,
facial hair and headwear sheets, random outfits, pose sheet, palette swatches.

Line-ups put many avatars side by side under an orthographic camera (one render per row), which keeps
Cycles CPU time reasonable. Thumbnails are 256 px, 12 samples + denoise, on a tone-6 mannequin.
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import bpy
import numpy as np
from mathutils import Vector

import previews as P
from lib.colors import hex_to_rgb
from lib.dress import Catalogue, Dressed, dress
from lib.harmony import random_outfit
from lib.imaging import grid, save_rgba
from lib.report import Report
from lib.rig import load_clips
from lib.scene import purge_orphans, reset_scene
from lib.step import Ctx

THUMB, THUMB_SAMPLES, SAMPLES = 256, 12, 12
MANNEQUIN_SKIN = 5  # "Tone 6"
NEUTRAL = {"top": {"item": "tshirt", "color": 0, "color2": 0}, "bottom": {"item": "jeans", "color": 2, "color2": 2},
           "shoes": {"item": "sneakers", "color": 3, "color2": 1}, "hair": {"item": "crew_cut", "color": 1}}
HIGHLIGHT = (8, 12)  # violet, sun
MATRIX_STYLES = ["long_straight", "wavy_medium", "curly_mop", "afro_round", "box_braids_long", "buzz"]
CAP_HAIRS = ["side_part_short", "wavy_medium", "curly_short_top", "twa_coils"]
VIEW = {"front": Vector((0, -1, 0.08)), "back": Vector((0, 1, 0.12)), "tq": Vector((0.75, -1.0, 0.35))}


class Studio:
    """One scene for many renders: clip actions loaded once, avatars spawned and removed."""

    def __init__(self, ctx: Ctx, avatar: Mapping[str, Any], report: Report, counter: list[int]) -> None:
        self.ctx, self.avatar, self.report, self.n = ctx, avatar, report, counter
        self.cat = Catalogue.load(ctx.art, ctx.export)
        self.reset()

    def reset(self) -> None:
        reset_scene()
        P.setup_studio()
        bpy.context.scene.cycles.samples = SAMPLES
        self.actions = load_clips(self.ctx.export / "animations" / "humanoid_clips.glb")

    def spawn(self, styles: Sequence[Mapping[str, Any]], spacing: float, clip: str | None = "idle", at: float = 0.3) -> list[Dressed]:
        out = []
        x0 = -spacing * (len(styles) - 1) / 2
        for i, s in enumerate(styles):
            d = dress(self.cat, self.avatar, s, Vector((x0 + i * spacing, 0, 0)))
            act = self.actions.get(clip) if clip else None
            if act is not None:
                d.rig.arm.animation_data_create()
                d.rig.arm.animation_data.action = act
            out.append(d)
        act = self.actions.get(clip) if clip else None
        if act is not None:
            s0, e0 = act.frame_range
            bpy.context.scene.frame_set(int(s0 + (e0 - s0) * at))
        bpy.context.view_layer.update()
        return out

    def clear(self, ds: Sequence[Dressed]) -> None:
        for d in ds:
            d.remove()
        purge_orphans()

    def ortho(self, centre: Vector, width: float, height: float, view: str, px_per_m: float) -> None:
        P.frame(centre, max(width, height) / 2, VIEW[view], 64)
        cam = bpy.context.scene.camera
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = max(width, height)
        r = bpy.context.scene.render
        r.resolution_x, r.resolution_y = int(width * px_per_m), int(height * px_per_m)

    def persp(self, centre: Vector, radius: float, view: str, res: int) -> None:
        bpy.context.scene.camera.data.type = "PERSP"
        P.frame(centre, radius, VIEW[view], res)

    def render(self, path: Path, label: str) -> Path:
        return P.render(path, self.report, label, self.n)


def style(body: str, **parts: Any) -> dict[str, Any]:
    s: dict[str, Any] = {"body": body, "skin": MANNEQUIN_SKIN, **{k: dict(v) for k, v in NEUTRAL.items()}}
    s.update(parts)
    return s


# -- thumbnails ----------------------------------------------------------------------------------


def thumb_framing(st: Studio, d: Dressed, kind: str, slot: str, item: str) -> tuple[Vector, float, str]:
    rig = d.rig
    bpy.context.view_layer.update()
    head = rig.arm.matrix_world @ rig.arm.pose.bones["Head"].head  # posed, not rest: idle moves the head
    if kind in ("hair", "facial", "headwear") or item in ("glasses", "headphones"):
        long = kind == "hair" and st.cat.hair.get(item, {}).get("length") in ("long", "medium")
        return head + Vector((0, 0, 0.06 - (0.08 if long else 0))), 0.27 if long else 0.19, "back" if item == "backpack" else "tq"
    if slot == "bottom":
        return Vector((0, 0, 0.6)), 0.6, "tq"
    if slot == "shoes":
        return Vector((0, -0.03, 0.1)), 0.24, "tq"
    if item == "backpack":
        return rig.bone("spine_02"), 0.42, "back"
    return rig.bone("spine_02") + Vector((0, 0, 0.05)), 0.45, "tq"


def thumbnails(st: Studio) -> dict[str, int]:
    out = {}
    jobs: list[tuple[str, str, str]] = [("wardrobe", e["slot"], i) for i, e in st.cat.wardrobe.items()]
    jobs += [(k, k, i) for k in ("hair", "facial", "headwear") for i in getattr(st.cat, k)]
    bpy.context.scene.cycles.samples = THUMB_SAMPLES
    for kind, slot, item in jobs:
        hl = {"item": item, "color": HIGHLIGHT[0], "color2": HIGHLIGHT[1]}
        if kind == "wardrobe":
            s = style("m", **{slot: hl})
        elif kind == "hair":
            s = style("m", hair={"item": item, "color": 1})
        elif kind == "facial":
            s = style("m", hair={"item": "fade_low", "color": 1}, facial={"item": item, "color": 1})
        else:
            s = style("m", hair={"item": "bald", "color": 1}, headwear=hl)
        ds = st.spawn([s], 1.0)
        centre, radius, view = thumb_framing(st, ds[0], kind, slot, item)
        st.persp(centre, radius, view, THUMB)
        st.render(st.ctx.export / kind / "thumbs" / f"{item}.png", f"thumb {kind}/{item}")
        st.clear(ds)
        out[kind] = out.get(kind, 0) + 1
    bpy.context.scene.cycles.samples = SAMPLES
    return out


# -- line-ups ------------------------------------------------------------------------------------


def lineup(st: Studio, styles: Sequence[Mapping[str, Any]], out: Path, frame: str, view: str = "front",
           clip: str | None = "idle", spacing: float = 0.7) -> Path:
    ds = st.spawn(styles, spacing, clip)
    width = spacing * len(styles) + 0.1
    if frame == "head":
        z = ds[0].rig.bone("Head").z + 0.1
        st.ortho(Vector((0, 0, z)), width, 0.72, view, 300)
    else:
        st.ortho(Vector((0, 0, 1.0)), width, 2.5, view, 230)
    path = st.render(out, out.stem)
    st.clear(ds)
    return path


def stack(paths: Sequence[Path], out: Path) -> Path:
    """Stack row images vertically (each row keeps its own width)."""
    from lib.imaging import load_rgba

    rows = [load_rgba(p) for p in paths if p.exists()]
    width = max(r.shape[1] for r in rows)
    canvas = np.full((sum(r.shape[0] for r in rows) + 4 * len(rows), width, 4), 0.12, dtype=np.float32)
    canvas[..., 3] = 1
    y = canvas.shape[0]
    for r in rows:
        y -= r.shape[0] + 4
        canvas[y:y + r.shape[0], : r.shape[1]] = r
    save_rgba(canvas, out)
    return out


def sections(st: Studio) -> dict[str, list[str]]:
    ctx, cat = st.ctx, st.cat
    pv = ctx.previews
    out: dict[str, list[str]] = {}
    tmp = ctx.reports / "preview_rows"  # intermediate rows: not committed
    tmp.mkdir(parents=True, exist_ok=True)

    rows = []
    for body in ("m", "f"):
        tops = [style(body, top={"item": t, "color": c1, "color2": c2}) for t in cat.ids("top") for c1, c2 in ((8, 1), (10, 3))]
        rows.append(lineup(st, tops, tmp / f"tops_{body}.png", "full", "tq"))
        rest = [style(body, bottom={"item": b, "color": 9, "color2": 3}) for b in cat.ids("bottom")]
        rest += [style(body, shoes={"item": s, "color": 13, "color2": 3}) for s in cat.ids("shoes")]
        rest += [style(body, accessory={"item": a, "color": 12}) for a in cat.ids("accessory")]
        rows.append(lineup(st, rest, tmp / f"bottoms_{body}.png", "full", "tq"))
    out["wardrobe"] = [stack(rows, pv / "wardrobe_grid.png").name]

    fams = ["none", "straight", "wavy", "curly", "coily", "protective"]
    rows = []
    for fam in fams:
        ids = [i for i, e in cat.hair.items() if e.get("family") == fam]
        for body in ("m", "f"):
            for view in ("front", "back"):
                ss = [style(body, hair={"item": i, "color": 1}) for i in ids]
                rows.append(lineup(st, ss, tmp / f"hair_{fam}_{body}_{view}.png", "head", view, spacing=0.5))
    out["hair"] = [stack(rows, pv / "hair_catalogue.png").name]

    rows = []
    for body in ("m", "f"):
        for sid in MATRIX_STYLES:
            ss = [{**style(body, hair={"item": sid, "color": 0}), "skin": k} for k in range(len(cat.skin))]
            rows.append(lineup(st, ss, tmp / f"matrix_{body}_{sid}.png", "head", "front", spacing=0.5))
    out["matrix"] = [stack(rows, pv / "skin_hair_matrix.png").name]

    rows = []
    for tone in (1, 4, 7, 10):
        ss = [{**style("m", hair={"item": "fade_low", "color": 1}, facial={"item": f, "color": 1}), "skin": tone} for f in cat.ids("facial")]
        rows.append(lineup(st, ss, tmp / f"facial_{tone}.png", "head", "front", spacing=0.5))
    out["facial"] = [stack(rows, pv / "facial_sheet.png").name]

    rows = []
    for body in ("m", "f"):
        ss = [style(body, hair={"item": "side_part_short", "color": 1}, headwear={"item": h, "color": 13, "color2": 12}) for h in cat.ids("headwear")]
        rows.append(lineup(st, ss, tmp / f"headwear_{body}.png", "head", "front", spacing=0.55))
        ss = [style(body, hair={"item": hh, "color": 1}, headwear={"item": hw, "color": 9, "color2": 1}) for hw in ("cap", "beanie") for hh in CAP_HAIRS]
        rows.append(lineup(st, ss, tmp / f"capcheck_{body}.png", "head", "front", spacing=0.55))
    out["headwear"] = [stack(rows, pv / "headwear_sheet.png").name]

    groups = cat_groups(ctx)
    rnd = random.Random(2026)
    catalogue = {k: cat.ids(k) for k in ("top", "bottom", "shoes", "accessory", "hair", "facial", "headwear")}
    outfits = []
    for i in range(10):
        o = random_outfit(rnd, groups, catalogue, len(cat.skin), len(cat.hair_colours))
        o["body"] = "m" if i % 2 == 0 else "f"
        outfits.append(o)
    out["random"] = [lineup(st, outfits, pv / "random_outfits.png", "full", "tq").name]
    out["randomStyles"] = [repr({k: v for k, v in o.items()}) for o in outfits]

    rows = []
    for clip in ("idle", "walk", "run", "jump_air", "emote_wave", "emote_dance"):
        use = clip if clip in st.actions else "sit_idle"
        rows.append(lineup(st, outfits[:3], tmp / f"pose_{clip}.png", "full", "tq", clip=use, spacing=0.9))
    out["poses"] = [stack(rows, pv / "pose_sheet.png").name]
    return out


def cat_groups(ctx: Ctx) -> list[dict[str, Any]]:
    import json

    return json.loads((ctx.art / "palette" / "palette.json").read_text(encoding="utf-8"))["harmonyGroups"]


def swatches(ctx: Ctx) -> list[str]:
    """One swatch strip per palette (skin, hair, clothing) plus the harmony groups."""
    import json

    names = []
    for fname in ("skin.json", "hair.json", "palette.json"):
        cols = [c["hex"] for c in json.loads((ctx.art / "palette" / fname).read_text(encoding="utf-8"))["colors"]]
        img = np.ones((64, 64 * len(cols), 4), dtype=np.float32)
        for i, h in enumerate(cols):
            img[:, i * 64:(i + 1) * 64, :3] = hex_to_rgb(h)
        out = ctx.previews / f"swatch_{fname.replace('.json', '')}.png"
        save_rgba(img, out)
        names.append(out.name)
    pal = json.loads((ctx.art / "palette" / "palette.json").read_text(encoding="utf-8"))
    groups = pal["harmonyGroups"]
    img = np.full((40 * len(groups), 3 * 48, 4), 0.12, dtype=np.float32)
    img[..., 3] = 1
    for gi, g in enumerate(groups):
        y = img.shape[0] - (gi + 1) * 40
        for k, ci in enumerate(g["colors"]):
            img[y + 4:y + 36, k * 48 + 4:k * 48 + 44, :3] = hex_to_rgb(pal["colors"][ci]["hex"])
    save_rgba(img, ctx.previews / "swatch_harmony.png")
    names.append("swatch_harmony.png")
    return names


def run(ctx: Ctx, avatar: Mapping[str, Any], report: Report, counter: list[int],
        only: Callable[[str], bool] = lambda _s: True) -> dict[str, Any]:
    if not (ctx.export / "wardrobe" / "manifest.json").exists() or not (ctx.export / "hair" / "manifest.json").exists():
        report.warn("wardrobe or hair manifest missing; run pnpm art:wardrobe and pnpm art:hair")
        return {}
    out: dict[str, Any] = {"swatches": swatches(ctx)}
    st = Studio(ctx, avatar, report, counter)
    if only("thumbs"):
        out["thumbs"] = thumbnails(st)
    if only("sheets"):
        out.update(sections(st))
    return out
