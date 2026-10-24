"""Regression for issue #87 O07: a production promotion must be a fast-forward."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "promote-production.yml"


class ProductionPromotionAncestryTests(unittest.TestCase):
    def test_previous_live_commit_must_precede_target_before_image_resolution(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        step = workflow.split("- name: Verify master ancestry", 1)[1].split(
            "- name: Resolve both images", 1
        )[0]
        previous_on_master = 'git merge-base --is-ancestor "$PREVIOUS_SHA" origin/master'
        previous_to_target = 'git merge-base --is-ancestor "$PREVIOUS_SHA" "$TARGET_SHA"'

        self.assertIn(previous_on_master, step)
        self.assertIn(previous_to_target, step)
        self.assertLess(step.index(previous_on_master), step.index(previous_to_target))
        self.assertLess(step.index(previous_to_target), step.index('git diff --quiet'))


if __name__ == "__main__":
    unittest.main()
