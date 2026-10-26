"""Unit tests for the pure helpers. Run inside Blender's Python:

    blender -b --factory-startup --python-exit-code 1 --python tools/blender/tests/run_tests.py
    (or: pnpm art:test)
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.append(str(HERE.parent))
sys.path.append(str(HERE))

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover(str(HERE), pattern="test_*.py", top_level_dir=str(HERE))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(f"tests run: {result.testsRun}, failures: {len(result.failures)}, errors: {len(result.errors)}")
    if not result.wasSuccessful():
        sys.exit(1)
