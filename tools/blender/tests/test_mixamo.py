"""Mixamo -> UE mannequin bone names, file picking and resample timing (pure helpers)."""

from __future__ import annotations

import unittest
from pathlib import Path

from lib.mixamo import bone_map, pick_file, resample_times, target_name

TARGET = ["root", "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head", "clavicle_l", "upperarm_l",
          "lowerarm_l", "hand_l", "index_01_l", "index_02_l", "index_03_l", "index_04_leaf_l", "thigh_r",
          "calf_r", "foot_r", "ball_r", "ball_leaf_r"]


class MixamoNameTests(unittest.TestCase):
    def test_body_limbs_and_fingers(self) -> None:
        self.assertEqual(target_name("mixamorig:Hips"), "pelvis")
        self.assertEqual(target_name("mixamorig:Spine2"), "spine_03")
        self.assertEqual(target_name("mixamorig:LeftForeArm"), "lowerarm_l")
        self.assertEqual(target_name("mixamorig:RightUpLeg"), "thigh_r")
        self.assertEqual(target_name("mixamorig:RightToeBase"), "ball_r")
        self.assertEqual(target_name("mixamorig:LeftHandIndex2"), "index_02_l")
        self.assertEqual(target_name("mixamorig1:LeftShoulder"), "clavicle_l")  # numbered prefix

    def test_end_bones_have_no_target(self) -> None:
        for name in ("mixamorig:HeadTop_End", "mixamorig:LeftHandIndex4", "mixamorig:RightToe_End"):
            self.assertIsNone(target_name(name))

    def test_map_matches_case_insensitively_and_skips_missing_bones(self) -> None:
        mapping = bone_map(["mixamorig:Head", "mixamorig:LeftHandIndex1", "mixamorig:LeftHandIndex4",
                            "mixamorig:RightHandPinky1"], TARGET)
        self.assertEqual(mapping, {"mixamorig:Head": "Head", "mixamorig:LeftHandIndex1": "index_01_l"})


class MixamoFileTests(unittest.TestCase):
    def test_pattern_order_wins_then_name(self) -> None:
        files = [Path("Sitting Idle.fbx"), Path("Sitting On Ground.fbx"), Path("Waving.fbx")]
        patterns = ["Sitting.*(Floor|Ground)", "^Sitting Idle"]
        self.assertEqual(pick_file(patterns, files), Path("Sitting On Ground.fbx"))
        self.assertEqual(pick_file(["^waving"], files), Path("Waving.fbx"))
        self.assertIsNone(pick_file(["Clap"], files))


class ResampleTests(unittest.TestCase):
    def test_keeps_duration_at_the_new_rate(self) -> None:
        times = resample_times(1, 88, 30, 24)  # 2.9 s at 30 fps
        self.assertEqual(times[0], 1)
        self.assertAlmostEqual(times[-1], 88, places=6)
        self.assertEqual(len(times), round(87 / 30 * 24) + 1)
        self.assertAlmostEqual(times[1] - times[0], 1.25)

    def test_single_frame_clip(self) -> None:
        self.assertEqual(resample_times(5, 5, 30, 24), [5, 5])


if __name__ == "__main__":
    unittest.main()
