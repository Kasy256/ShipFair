"""Avatar maths: cut planes from bones, mask bits, region assignment, harmony randomiser, coverage."""

from __future__ import annotations

import random
import unittest

from lib.avatar import (
    AVATAR_DEFAULTS,
    bits,
    budget_for,
    compile_mask_rules,
    face_zone,
    family_coverage,
    hair_zone,
    plane_from_spec,
    planes_from_specs,
    worst_case,
    zone_for_bone,
    zone_names,
)
from lib.avatar_palettes import DEFAULT_HARMONY
from lib.harmony import clothing_colours, outfit_colours, random_outfit

HEADS = {
    "upperarm_l": (0.2, 0.06, 1.46), "lowerarm_l": (0.46, 0.07, 1.46), "hand_l": (0.7, 0.06, 1.46),
    "upperarm_r": (-0.2, 0.06, 1.46), "lowerarm_r": (-0.46, 0.07, 1.46),
    "thigh_l": (0.11, 0.04, 0.98), "calf_l": (0.11, 0.04, 0.55), "foot_l": (0.11, 0.09, 0.1),
    "clavicle_l": (0.03, -0.03, 1.5), "neck_01": (0.0, 0.04, 1.53), "Head": (0.0, 0.02, 1.61),
    "pelvis": (0.0, 0.04, 0.96),
}


class CutPlaneTests(unittest.TestCase):
    def test_midpoint_of_a_bone_cuts_towards_the_child(self) -> None:
        p = plane_from_spec({"from": "upperarm_l", "to": "lowerarm_l", "t": 0.5}, HEADS, "l")
        self.assertAlmostEqual(p.point[0], 0.33, places=3)
        self.assertGreater(p.normal[0], 0.99)
        self.assertTrue(p.outside((0.4, 0.06, 1.46)))     # forearm side is cut away
        self.assertFalse(p.outside((0.25, 0.06, 1.46)))   # shoulder side stays
        self.assertFalse(p.outside((-0.4, 0.06, 1.46)))   # the other arm is untouched

    def test_shift_and_from_end(self) -> None:
        p = plane_from_spec({"from": "calf_l", "to": "foot_l", "fromEndM": 0.12}, HEADS)
        self.assertAlmostEqual(p.distance(HEADS["foot_l"]), 0.12, places=4)
        q = plane_from_spec({"from": "upperarm_l", "to": "lowerarm_l", "t": 0.5, "shiftM": 0.02}, HEADS)
        self.assertAlmostEqual(q.point[0], 0.35, places=3)

    def test_keep_to_flips_the_kept_side(self) -> None:
        p = plane_from_spec({"from": "calf_l", "to": "foot_l", "t": 1.0, "shiftM": -0.03, "keep": "to"}, HEADS)
        self.assertTrue(p.outside((0.11, 0.06, 0.3)))     # calf above the collar is cut
        self.assertFalse(p.outside((0.11, 0.06, 0.05)))   # the foot stays

    def test_levels_radius_and_sides(self) -> None:
        lv = plane_from_spec({"level": "pelvis", "shiftM": 0.09, "keep": "below"}, HEADS)
        self.assertTrue(lv.outside((0.0, 0.0, 1.2)))
        self.assertFalse(lv.outside((0.0, 0.0, 1.0)))
        r = plane_from_spec({"level": "neck_01", "keep": "below", "radiusM": 0.1}, HEADS)
        self.assertTrue(r.outside((0.0, 0.04, 1.6)))
        self.assertFalse(r.outside((0.3, 0.04, 1.6)))     # beyond the radius: untouched
        self.assertEqual(len(planes_from_specs([{"from": "upperarm_{s}", "to": "lowerarm_{s}", "t": 0.5}], HEADS)), 2)
        with self.assertRaises(ValueError):
            plane_from_spec({"level": "pelvis", "keep": "sideways"}, HEADS)
        with self.assertRaises(KeyError):
            plane_from_spec({"from": "tail", "to": "pelvis"}, HEADS)


class MaskTests(unittest.TestCase):
    mask = AVATAR_DEFAULTS["bodyMask"]

    def test_bits_and_names(self) -> None:
        self.assertEqual(bits(self.mask, ["torso", "upperarm"]), 3)
        self.assertEqual(zone_names(self.mask, 1 | 32 | 4096), ["torso", "thigh", "calf_lo"])
        with self.assertRaises(KeyError):
            bits(self.mask, ["tail"])
        values = list(self.mask.values())
        self.assertEqual(len(set(values)), len(values))
        self.assertTrue(all(v & (v - 1) == 0 for v in values))  # one bit each

    def test_zone_from_dominant_bone(self) -> None:
        rules = compile_mask_rules(AVATAR_DEFAULTS)
        cases = {"upperarm_l": "upperarm", "lowerarm_r": "forearm", "thigh_l": "thigh", "calf_r": "calf",
                 "foot_l": "foot", "ball_r": "foot", "ball_leaf_l": "foot", "Head": "head", "neck_01": "neck",
                 "spine_02": "torso", "clavicle_l": "torso", "pelvis": "hips", "index_02_l": "hand"}
        for bone, zone in cases.items():
            self.assertEqual(zone_for_bone(bone, rules), zone, bone)
        self.assertEqual(zone_for_bone(None, rules), "torso")

    def test_split_planes_refine_zones(self) -> None:
        rules = compile_mask_rules(AVATAR_DEFAULTS)
        upper = plane_from_spec({"from": "upperarm_l", "to": "lowerarm_l", "t": 0.5}, HEADS, "l")
        splits = [("upperarm", "upperarm_lo", upper)]
        self.assertEqual(face_zone("upperarm_l", (0.25, 0.06, 1.46), rules, splits), "upperarm")
        self.assertEqual(face_zone("upperarm_l", (0.42, 0.06, 1.46), rules, splits), "upperarm_lo")
        self.assertEqual(face_zone("lowerarm_l", (0.5, 0.06, 1.46), rules, splits), "forearm")

    def test_hair_zones(self) -> None:
        self.assertEqual(hair_zone((0, 0, 1.8), band_z=1.76, ear_z=1.7, centre_y=0.0, centre_x_half=0.05), "crown")
        self.assertEqual(hair_zone((0, 0, 1.6), band_z=1.76, ear_z=1.7, centre_y=0.0, centre_x_half=0.05), "length")
        self.assertEqual(hair_zone((0, 0.08, 1.72), band_z=1.76, ear_z=1.7, centre_y=0.0, centre_x_half=0.05), "back")
        self.assertEqual(hair_zone((0.09, 0.0, 1.72), band_z=1.76, ear_z=1.7, centre_y=0.0, centre_x_half=0.05), "sides")


class RegionTests(unittest.TestCase):
    def test_region_table_is_complete_and_unique(self) -> None:
        r = AVATAR_DEFAULTS["regions"]
        self.assertEqual([r[k] for k in ("SKIN", "TOP", "TOP2", "BOTTOM", "BOTTOM2", "SHOES", "SHOES2", "HAIR",
                                        "BROWS", "EYES", "ACCENT", "ACCENT2")], list(range(12)))
        self.assertTrue(all(0 <= v < AVATAR_DEFAULTS["colorSlots"] for v in r.values()))
        self.assertEqual(len(set(r.values())), len(r))

    def test_budgets(self) -> None:
        b = AVATAR_DEFAULTS["budgets"]
        self.assertEqual(budget_for("top", {}, b), 2500)
        self.assertEqual(budget_for("top", {"budget_tris": 2000}, b), 2000)
        self.assertEqual(budget_for("top", {"budget_tris": 9000}, b), 2500)
        self.assertEqual(budget_for("hair", {"longBudget": True}, b), 3000)
        self.assertEqual(budget_for("facial", {}, b), 800)
        total, picks = worst_case({"body": [13000], "top": [2000, 2400], "hair": []})
        self.assertEqual((total, picks["top"], picks["hair"]), (15400, 2400, 0))


class HarmonyTests(unittest.TestCase):
    catalogue = {"top": ["tshirt", "hoodie"], "bottom": ["jeans"], "shoes": ["boots"], "accessory": ["glasses"],
                 "hair": ["buzz", "afro_round"], "facial": ["goatee"], "headwear": ["cap"]}

    def test_every_clothing_colour_comes_from_one_group(self) -> None:
        rnd = random.Random(5)
        for _ in range(300):
            o = random_outfit(rnd, DEFAULT_HARMONY, self.catalogue, 12, 12)
            group = next(g for g in DEFAULT_HARMONY if g["id"] == o["harmony"])
            self.assertTrue(clothing_colours(o) <= set(group["colors"]))
            self.assertEqual(o["facial"]["color"], o["hair"]["color"])
            self.assertTrue(0 <= o["skin"] < 12)

    def test_seeded_and_two_colour_groups(self) -> None:
        a = random_outfit(random.Random(3), DEFAULT_HARMONY, self.catalogue, 12, 12)
        b = random_outfit(random.Random(3), DEFAULT_HARMONY, self.catalogue, 12, 12)
        self.assertEqual(a, b)
        self.assertEqual(set(outfit_colours([1, 9]).values()), {1, 9})


class CoverageTests(unittest.TestCase):
    def test_family_rule(self) -> None:
        good = [{"family": f, "length": l} for f in ("straight", "wavy") for l in ("short", "long", "medium", "short", "buzz")]
        self.assertEqual(family_coverage(good, ["straight", "wavy"], 5), [])
        thin = [{"family": "curly", "length": "short"}] * 3
        problems = family_coverage(thin, ["curly"], 5)
        self.assertIn("curly: 3 styles (need 5)", problems)
        self.assertIn("curly: no long or large-volume style", problems)
        coily = [{"family": "coily", "length": "short"}] * 4 + [{"family": "coily", "length": "short", "capIncompatible": True}]
        self.assertEqual(family_coverage(coily, ["coily"], 5), [])


if __name__ == "__main__":
    unittest.main()
