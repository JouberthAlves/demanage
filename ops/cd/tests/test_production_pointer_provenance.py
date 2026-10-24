"""Adversarial tests for production pointer authority, not just JSON shape."""

import base64
import hashlib
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd import manifest  # noqa: E402


TARGET = 'a' * 40
PREVIOUS = 'b' * 40
POINTER_COMMIT = 'c' * 40
APPROVAL_RUN = 39271031757
WORKFLOW_ID = 379924232


def pointer(version=2):
    release = {
        'version': version,
        'source_commit': TARGET,
        'previous_commit': PREVIOUS,
        'backend': 'ghcr.io/bielxdh3/demanage-backend@sha256:' + 'd' * 64,
        'frontend': 'ghcr.io/bielxdh3/demanage-frontend@sha256:' + 'e' * 64,
        'approved_by': 'bielxdh3',
        'approved_at': '2026-10-23T12:00:00Z',
    }
    if version == 2:
        release.update(approval_run_id=APPROVAL_RUN, approval_run_attempt=1)
    return release


class FakeResponse(io.BytesIO):
    pass


class GithubApiFixture:
    def __init__(self, release=None):
        self.release = release or pointer()
        self.raw = (json.dumps(self.release, sort_keys=True) + '\n').encode()
        self.commit = POINTER_COMMIT
        self.blob = hashlib.sha1(b'blob ' + str(len(self.raw)).encode() + b'\0' + self.raw).hexdigest()
        self.run = {
            'id': APPROVAL_RUN, 'workflow_id': WORKFLOW_ID,
            'path': '.github/workflows/promote-production.yml@refs/heads/master',
            'event': 'workflow_dispatch', 'head_branch': 'master',
            'status': 'completed', 'conclusion': 'success', 'run_attempt': 1,
            'actor': {'login': 'bielxdh3'},
            'triggering_actor': {'login': 'bielxdh3'},
            'repository': {'id': 98765},
        }
        self.approvals = [{
            'state': 'approved', 'user': {'login': 'bielxdh3'},
            'environments': [{'name': 'production'}],
        }]
        self.artifacts = {'total_count': 1, 'artifacts': [{
            'name': f'production-pointer-39271031757-1-{hashlib.sha256(self.raw).hexdigest()}',
            'expired': False, 'size_in_bytes': 1,
            'workflow_run': {'id': APPROVAL_RUN, 'repository_id': 98765},
        }]}
        self.urls = []

    def opener(self, request, timeout):
        url = request.full_url
        self.urls.append(url)
        if url == manifest.MANIFEST_URL:
            return FakeResponse(self.raw)
        if url.endswith('/git/ref/heads/production'):
            value = {'ref': 'refs/heads/production', 'object': {'type': 'commit', 'sha': self.commit}}
        elif f'/contents/production.json?ref={self.commit}' in url:
            value = {'type': 'file', 'encoding': 'base64', 'sha': self.blob,
                     'content': base64.b64encode(self.raw).decode()}
        elif f'/actions/runs/{APPROVAL_RUN}/approvals' in url:
            value = self.approvals
        elif f'/actions/runs/{APPROVAL_RUN}/artifacts' in url:
            value = self.artifacts
        elif f'/actions/runs/{APPROVAL_RUN}' in url:
            value = self.run
        else:
            raise AssertionError(f'Unexpected GitHub API request: {url}')
        return FakeResponse(json.dumps(value).encode())


class PointerAuthorityTest(unittest.TestCase):
    def test_valid_approved_run_and_exact_pointer_is_accepted(self):
        fixture = GithubApiFixture()
        self.assertEqual(manifest.fetch_approval(opener=fixture.opener), fixture.release)
        self.assertEqual(len(fixture.urls), 6)

    def test_direct_v1_pointer_edit_with_owner_text_is_rejected(self):
        fixture = GithubApiFixture(pointer(version=1))
        with self.assertRaisesRegex(ValueError, 'provenance|legacy|approval'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_forged_v2_pointer_with_old_run_lacks_artifact_match(self):
        fixture = GithubApiFixture()
        fixture.artifacts['artifacts'][0]['name'] = 'production-pointer-unrelated'
        with self.assertRaisesRegex(ValueError, 'artifact'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_signed_web_flow_commit_without_environment_approval_is_rejected(self):
        fixture = GithubApiFixture()
        fixture.approvals = []
        with self.assertRaisesRegex(ValueError, 'reviewer|approval'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_wrong_workflow_or_actor_is_rejected(self):
        for field, value in [('workflow_id', 1), ('event', 'push'), ('actor', {'login': 'attacker'})]:
            with self.subTest(field=field):
                fixture = GithubApiFixture()
                fixture.run[field] = value
                with self.assertRaisesRegex(ValueError, 'workflow|actor'):
                    manifest.fetch_approval(opener=fixture.opener)

    def test_raw_pointer_differing_from_immutable_commit_is_rejected(self):
        fixture = GithubApiFixture()
        fixture.raw = fixture.raw.replace(b'2026-10-23', b'2026-10-24')
        with self.assertRaisesRegex(ValueError, 'pointer|content'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_artifact_from_another_run_is_rejected(self):
        fixture = GithubApiFixture()
        fixture.artifacts['artifacts'][0]['workflow_run']['id'] = 1
        with self.assertRaisesRegex(ValueError, 'artifact'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_expired_artifact_or_wrong_reviewer_is_rejected(self):
        fixture = GithubApiFixture()
        fixture.artifacts['artifacts'][0]['expired'] = True
        with self.assertRaisesRegex(ValueError, 'artifact'):
            manifest.fetch_approval(opener=fixture.opener)

        fixture = GithubApiFixture()
        fixture.approvals[0]['user']['login'] = 'attacker'
        with self.assertRaisesRegex(ValueError, 'reviewer'):
            manifest.fetch_approval(opener=fixture.opener)

    def test_run_attempt_rerun_cannot_reuse_prior_approval(self):
        fixture = GithubApiFixture()
        fixture.run['run_attempt'] = 2
        with self.assertRaisesRegex(ValueError, 'workflow'):
            manifest.fetch_approval(opener=fixture.opener)

        invalid = pointer()
        invalid['approval_run_attempt'] = 2
        with self.assertRaisesRegex(ValueError, 'attempt'):
            manifest.validate_release(invalid)

    def test_github_api_denial_fails_closed(self):
        fixture = GithubApiFixture()

        def blocked(request, timeout):
            if '/git/ref/heads/production' in request.full_url:
                raise urllib.error.HTTPError(request.full_url, 403, 'rate limited', None, None)
            return fixture.opener(request, timeout)

        with self.assertRaises(urllib.error.HTTPError) as result:
            manifest.fetch_approval(opener=blocked)
        result.exception.close()

    def test_legacy_pin_requires_exact_commit_and_blob(self):
        fixture = GithubApiFixture(pointer(version=1))
        with patch.object(manifest, 'LEGACY_POINTER_COMMIT', fixture.commit), patch.object(
            manifest, 'LEGACY_POINTER_BLOB', fixture.blob
        ):
            self.assertEqual(manifest.fetch_approval(opener=fixture.opener), fixture.release)
            fixture.commit = 'f' * 40
            with self.assertRaisesRegex(ValueError, 'legacy|provenance'):
                manifest.fetch_approval(opener=fixture.opener)


if __name__ == '__main__':
    unittest.main()
