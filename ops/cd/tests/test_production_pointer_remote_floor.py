"""Adversarial remote-floor tests: branch rewrites must not replay old approvals."""

import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd import manifest  # noqa: E402
from test_production_pointer_provenance import (  # noqa: E402
    APPROVAL_RUN,
    FakeResponse,
    GithubApiFixture,
    pointer,
)


def later_run(original, *, offset=1, attempt=1):
    run = copy.deepcopy(original)
    run['id'] = APPROVAL_RUN + offset
    run['run_attempt'] = attempt
    return run


class HistoryFixture(GithubApiFixture):
    def __init__(self, release=None):
        super().__init__(release)
        self.history = [self.run]
        self.approvals_by_run = {APPROVAL_RUN: self.approvals}
        self.reported_count = None
        self.pages_read = []

    def opener(self, request, timeout):
        url = request.full_url
        path = urlsplit(url).path
        if path.endswith(f'/actions/workflows/{manifest.PROMOTION_WORKFLOW_ID}/runs'):
            query = parse_qs(urlsplit(url).query)
            if query.get('event') != ['workflow_dispatch'] or query.get('status') != ['success']:
                raise AssertionError('History query must limit to successful dispatches')
            if query.get('per_page') != ['5']:
                raise AssertionError('History pagination must stay within API byte limits')
            page = int(query.get('page', ['1'])[0])
            self.pages_read.append(page)
            start = (page - 1) * 5
            payload = {
                'total_count': len(self.history) if self.reported_count is None else self.reported_count,
                'workflow_runs': self.history[start:start + 5],
            }
            return FakeResponse(json.dumps(payload).encode())
        if path.endswith('/approvals'):
            run_id = int(path.split('/')[-2])
            if run_id in self.approvals_by_run:
                return FakeResponse(json.dumps(self.approvals_by_run[run_id]).encode())
        return super().opener(request, timeout)


class RemotePromotionFloorTest(unittest.TestCase):
    def test_recommitted_old_v2_pointer_after_restored_state_is_rejected(self):
        fixture = HistoryFixture()
        fixture.commit = 'e' * 40  # The unprotected branch writer recommits old approved bytes.
        newer = later_run(fixture.run)
        fixture.history = [newer, fixture.run]
        fixture.approvals_by_run[newer['id']] = fixture.approvals
        self.assertEqual(fixture.release['previous_commit'], 'b' * 40)
        # Debian can be restored to that same prior source_commit, so its
        # previous_commit equality is insufficient to prevent old approvals.
        with self.assertRaisesRegex(ValueError, 'stale|latest|newer|floor'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_pinned_v1_pointer_cannot_reappear_after_newer_approved_run(self):
        fixture = HistoryFixture(pointer(version=1))
        newer = later_run(fixture.run)
        fixture.history = [newer, fixture.run]
        fixture.approvals_by_run[newer['id']] = fixture.approvals
        with patch.object(manifest, 'LEGACY_POINTER_COMMIT', fixture.commit), patch.object(
            manifest, 'LEGACY_POINTER_BLOB', fixture.blob
        ):
            with self.assertRaisesRegex(ValueError, 'legacy|stale|latest|floor'):
                manifest.fetch_approval(opener=fixture.opener)

    def test_historic_pinned_v1_is_allowed_only_while_latest_approved(self):
        fixture = HistoryFixture(pointer(version=1))
        with patch.object(manifest, 'LEGACY_POINTER_COMMIT', fixture.commit), patch.object(
            manifest, 'LEGACY_POINTER_BLOB', fixture.blob
        ):
            self.assertEqual(manifest.fetch_approval(opener=fixture.opener), fixture.release)

    def test_newer_success_without_environment_approval_is_not_a_trusted_floor(self):
        fixture = HistoryFixture()
        unapproved = later_run(fixture.run)
        fixture.history = [unapproved, fixture.run]
        fixture.approvals_by_run[unapproved['id']] = []
        self.assertEqual(manifest.fetch_approval(opener=fixture.opener), fixture.release)

    def test_no_successful_approved_runs_fail_closed_even_for_pinned_legacy(self):
        fixture = HistoryFixture(pointer(version=1))
        fixture.history = []
        with patch.object(manifest, 'LEGACY_POINTER_COMMIT', fixture.commit), patch.object(
            manifest, 'LEGACY_POINTER_BLOB', fixture.blob
        ):
            with self.assertRaisesRegex(ValueError, 'history|approved|floor|runs'):
                manifest.fetch_approval(opener=fixture.opener)

    def test_out_of_order_or_duplicate_history_never_falls_back_to_old_pointer(self):
        for history in ('out_of_order', 'duplicate'):
            with self.subTest(history=history):
                fixture = HistoryFixture()
                newer = later_run(fixture.run)
                fixture.history = ([fixture.run, newer] if history == 'out_of_order'
                                   else [fixture.run, fixture.run])
                with self.assertRaisesRegex(ValueError, 'order|duplicate|history'):
                    manifest.fetch_approval(opener=fixture.opener)

    def test_successful_newer_rerun_cannot_reuse_an_older_approved_pointer(self):
        fixture = HistoryFixture()
        newer = later_run(fixture.run, attempt=2)
        fixture.history = [newer, fixture.run]
        fixture.approvals_by_run[newer['id']] = fixture.approvals
        with self.assertRaisesRegex(ValueError, 'attempt|stale|latest|floor'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_history_pagination_finds_latest_real_approval_after_unapproved_runs(self):
        fixture = HistoryFixture()
        fixture.history = [later_run(fixture.run, offset=index) for index in range(5, 0, -1)] + [fixture.run]
        for run in fixture.history[:-1]:
            fixture.approvals_by_run[run['id']] = []
        self.assertEqual(manifest.fetch_approval(opener=fixture.opener), fixture.release)
        self.assertEqual(fixture.pages_read, [1, 2])

    def test_inconsistent_history_count_or_missing_page_fails_closed(self):
        fixture = HistoryFixture()
        fixture.reported_count = 6
        with self.assertRaisesRegex(ValueError, 'history|page|count'):
            manifest.fetch_approval(opener=fixture.opener)


if __name__ == '__main__':
    unittest.main()
