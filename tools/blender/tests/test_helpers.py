"""Pure helper tests: regions, palette colours, name matching, drift, colliders, quaternions, GLB."""

from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

from lib.colors import hex_to_rgb, nearest_index, rgb_to_hex, square_centre_uv
from lib.drift import max_drift, net_drift
from lib.geometry import collider_shape
from lib.glb import compact, keep_animation_channels, pack_bin, read_bin, read_glb, strip_name_suffixes, write_glb
from lib.matching import map_bones, pick_name, strip_suffix
from lib.quat import angle_deg
from lib.regions import compile_region_map, dominant_bone, face_regions, region_for_bone

REGION_MAP = {
    "default": "TOP",
    "rules": [
        {"region": "SKIN", "patterns": ["^head$", "^hand_[lr]$", "^lowerarm_[lr]$"]},
        {"region": "TOP", "patterns": ["^spine_\\d+$", "^upperarm_[lr]$"]},
        {"region": "BOTTOM", "patterns": ["^pelvis$", "^thigh_[lr]$", "^calf_[lr]$"]},
        {"region": "SHOES", "patterns": ["^foot_[lr]$", "^ball_[lr]$"]},
    ],
}


class RegionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rules, self.default = compile_region_map(REGION_MAP)

    def test_bone_patterns_are_case_insensitive_and_ordered(self) -> None:
        self.assertEqual(region_for_bone("Head", self.rules, self.default), "SKIN")
        self.assertEqual(region_for_bone("hand_l", self.rules, self.default), "SKIN")
        self.assertEqual(region_for_bone("upperarm_r", self.rules, self.default), "TOP")
        self.assertEqual(region_for_bone("calf_l", self.rules, self.default), "BOTTOM")
        self.assertEqual(region_for_bone("ball_r", self.rules, self.default), "SHOES")
        self.assertEqual(region_for_bone("mystery", self.rules, self.default), "TOP")

    def test_dominant_bone_sums_weights_over_the_face(self) -> None:
        weights = [{"hand_l": 0.6, "lowerarm_l": 0.4}, {"lowerarm_l": 1.0}, {"lowerarm_l": 0.5, "hand_l": 0.5}]
        self.assertEqual(dominant_bone([0, 1, 2], weights), "lowerarm_l")
        self.assertIsNone(dominant_bone([0], [{}]))

    def test_hands_are_skin_not_top(self) -> None:
        weights = [{"hand_r": 1.0}, {"hand_r": 0.9, "lowerarm_r": 0.1}, {"upperarm_r": 1.0}]
        faces = [[0, 1], [2]]
        self.assertEqual(face_regions(faces, weights, self.rules, self.default), ["SKIN", "TOP"])


class ColourTests(unittest.TestCase):
    def test_hex_round_trip(self) -> None:
        self.assertEqual(rgb_to_hex(hex_to_rgb("#7c5cff")), "#7c5cff")
        with self.assertRaises(ValueError):
            hex_to_rgb("#abc")

    def test_nearest_palette_colour_is_perceptual(self) -> None:
        palette = [hex_to_rgb(h) for h in ("#ffffff", "#000000", "#ff0000", "#00a000")]
        self.assertEqual(nearest_index(hex_to_rgb("#f0f0f0"), palette), 0)
        self.assertEqual(nearest_index(hex_to_rgb("#c01010"), palette), 2)
        self.assertEqual(nearest_index(hex_to_rgb("#209020"), palette), 3)

    def test_uv_points_at_square_centres(self) -> None:
        self.assertEqual(square_centre_uv(0), (0.125, 0.875))
        self.assertEqual(square_centre_uv(15), (0.875, 0.125))
        with self.assertRaises(ValueError):
            square_centre_uv(16)


class MatchingTests(unittest.TestCase):
    NAMES = ["Idle_Loop", "Idle_Talking_Loop", "Walk_Loop", "Walk_Formal_Loop", "Jog_Fwd_Loop", "Sprint_Loop"]

    def test_first_pattern_wins_and_alternatives_are_logged(self) -> None:
        pick = pick_name(["^Walk_Loop$", "^Walk"], self.NAMES)
        self.assertEqual(pick.chosen, "Walk_Loop")
        self.assertEqual(pick.alternatives, ["Walk_Formal_Loop"])

    def test_falls_back_to_later_patterns_and_reports_missing(self) -> None:
        self.assertEqual(pick_name(["^Run", "^Jog"], self.NAMES).chosen, "Jog_Fwd_Loop")
        self.assertIsNone(pick_name(["Wave"], self.NAMES).chosen)

    def test_strip_importer_suffix(self) -> None:
        self.assertEqual(strip_suffix("Walk_Loop_Armature", "_Armature"), "Walk_Loop")
        self.assertEqual(strip_suffix("Walk_Loop", "_Armature"), "Walk_Loop")

    def test_bone_mapping_by_name_similarity(self) -> None:
        m = map_bones(["Head", "spine_01", "upperarm_l"], ["head", "spine_01", "upper_arm_l"])
        self.assertEqual(m, {"Head": "head", "spine_01": "spine_01", "upperarm_l": "upper_arm_l"})


class DriftTests(unittest.TestCase):
    def test_drift(self) -> None:
        samples = [(0.0, 0.0), (0.01, 0.0), (0.0, 0.03), (0.0, 0.0)]
        self.assertAlmostEqual(max_drift(samples), 0.03)
        self.assertAlmostEqual(net_drift(samples), 0.0)
        self.assertEqual(max_drift([]), 0.0)


class ColliderTests(unittest.TestCase):
    def test_round_footprint_is_cylinder_square_is_box(self) -> None:
        circle = [(math.cos(a), math.sin(a)) for a in (2 * math.pi * i / 16 for i in range(16))]
        square = [(-1, -1), (1, -1), (1, 1), (-1, 1), (0, 0)]
        long_box = [(-3, -0.5), (3, -0.5), (3, 0.5), (-3, 0.5)]
        self.assertEqual(collider_shape(circle), "cylinder")
        self.assertEqual(collider_shape(square), "box")
        self.assertEqual(collider_shape(long_box), "box")


class QuatTests(unittest.TestCase):
    def test_angle_ignores_sign(self) -> None:
        q = (1.0, 0.0, 0.0, 0.0)
        self.assertAlmostEqual(angle_deg(q, (-1.0, 0.0, 0.0, 0.0)), 0.0)
        half = math.sqrt(0.5)
        self.assertAlmostEqual(angle_deg(q, (half, 0.0, 0.0, half)), 90.0, places=4)


class GlbTests(unittest.TestCase):
    def _fixture(self, path: Path) -> None:
        """Two nodes, one animation with a rotation and a translation channel."""
        payload = bytes(range(16)) * 4  # 4 views x 16 bytes
        doc = {
            "asset": {"version": "2.0"},
            "nodes": [{"name": "SLOT_logo.001"}, {"name": "pelvis"}, {"name": "spine_01"}],
            "accessors": [{"bufferView": i, "componentType": 5126, "count": 1, "type": "VEC4"} for i in range(4)],
            "bufferViews": [{"buffer": 0, "byteOffset": 16 * i, "byteLength": 16} for i in range(4)],
            "buffers": [{"byteLength": len(payload)}],
            "animations": [{
                "name": "walk",
                "samplers": [{"input": 0, "output": 1}, {"input": 2, "output": 3}],
                "channels": [
                    {"sampler": 0, "target": {"node": 2, "path": "rotation"}},
                    {"sampler": 1, "target": {"node": 2, "path": "translation"}},
                ],
            }],
        }
        write_glb(path, doc, pack_bin(payload))

    def test_strip_suffixes_and_filter_channels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.glb"
            self._fixture(p)
            self.assertEqual(strip_name_suffixes(p, ("SLOT_",)), 1)
            kept, dropped = keep_animation_channels(p, lambda node, path: path == "rotation")
            self.assertEqual((kept, dropped), (1, 1))
            doc, rest = read_glb(p)
            self.assertEqual(doc["nodes"][0]["name"], "SLOT_logo")
            self.assertEqual(len(doc["accessors"]), 2)
            self.assertEqual(len(read_bin(rest)), 32)
            self.assertEqual(doc["animations"][0]["channels"][0]["sampler"], 0)
            json.dumps(doc)

    def test_compact_keeps_referenced_data_only(self) -> None:
        doc = {"accessors": [{"bufferView": 0}, {"bufferView": 1}], "bufferViews": [
            {"byteOffset": 0, "byteLength": 4}, {"byteOffset": 4, "byteLength": 4}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 1}}]}]}
        out = compact(doc, b"aaaabbbb")
        self.assertEqual(out, b"bbbb")
        self.assertEqual(doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"], 0)


if __name__ == "__main__":
    unittest.main()
