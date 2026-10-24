"""Regression for issue #87 O07: a production promotion must be a fast-forward."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "promote-production.yml"


class ProductionPromotionAncestryTests(unittest.TestCase):
    def test_both_target_app_and_live_gate_workflow_have_successful_hosted_checks(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        step = workflow.split("- name: Verify master ancestry", 1)[1].split(
            "- name: Resolve both images", 1
        )[0]
        self.assertIn('for check_sha in "$TARGET_SHA" "$GITHUB_SHA"; do', step)
        self.assertIn('head_sha=$check_sha&event=push', step)
        self.assertIn('.head_sha == $sha and .event == "push"', step)
        self.assertIn('for workflow in CI CodeQL; do', step)

    def test_issue87_is_validated_only_after_both_image_digests_and_before_pointer(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("environment:\n      name: production", workflow)
        self.assertIn("REVIEWED_ISSUE87_BACKUP_SHA256", workflow)
        self.assertIn("REVIEWED_ISSUE87_REHEARSAL_SHA256", workflow)
        self.assertIn("83488ef75d426688fda06feb2333af58c87ad569", workflow)
        self.assertIn("git merge-base --is-ancestor", workflow)
        self.assertIn("$TARGET_SHA", workflow)
        self.assertIn("$PREVIOUS_SHA", workflow)
        self.assertIn("ISSUE87_IMAGE_CHECK_REQUIRED", workflow)
        start = workflow.index("- name: Resolve both images by immutable registry digest")
        check = workflow.index("python3 ops/cd/issue87_release_gate.py", start)
        pointer = workflow.index("- name: Prepare exact production pointer bytes", start)
        self.assertLess(start, check)
        self.assertLess(check, pointer)
        self.assertIn('--backend "$BACKEND_IMAGE"', workflow)
        self.assertIn('--frontend "$FRONTEND_IMAGE"', workflow)

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
