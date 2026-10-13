import sys
import unittest
from pathlib import Path

# Make the demanage_cd package (ops/cd) importable when run from any directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd import compose, manifest  # noqa: E402

FIRST = 'b70d556e28832400d1ae07ee7f2d94218736195f'
SECOND = '793247db930eefbfc407c101da6436490111560e'


def valid_release():
    return {
        'version': 1,
        'source_commit': SECOND,
        'previous_commit': FIRST,
        'backend': 'ghcr.io/bielxdh3/demanage-backend@sha256:' + ('a' * 64),
        'frontend': 'ghcr.io/bielxdh3/demanage-frontend@sha256:' + ('b' * 64),
        'approved_by': 'bielxdh3',
        'approved_at': '2026-10-09T17:00:00Z',
    }


class ManifestValidationTest(unittest.TestCase):
    def test_valid_pinned_images(self):
        self.assertEqual(manifest.validate_release(valid_release())['source_commit'], SECOND)

    def test_reject_mutable_tags(self):
        item = valid_release()
        item['backend'] = 'ghcr.io/bielxdh3/demanage-backend:latest'
        with self.assertRaises(ValueError):
            manifest.validate_release(item)

    def test_reject_other_repository_or_image(self):
        item = valid_release()
        item['backend'] = item['backend'].replace('bielxdh3', 'other-user')
        with self.assertRaises(ValueError):
            manifest.validate_release(item)

    def test_reject_unknown_manifest_fields(self):
        item = valid_release()
        item['ignore_checks'] = True
        with self.assertRaises(ValueError):
            manifest.validate_release(item)

    def test_reject_unexpected_approver(self):
        item = valid_release()
        item['approved_by'] = 'dependabot[bot]'
        with self.assertRaises(ValueError):
            manifest.validate_release(item)

    def test_reject_bad_sha(self):
        item = valid_release()
        item['previous_commit'] = 'unknown'
        with self.assertRaises(ValueError):
            manifest.validate_release(item)


class RuntimeTopologyTest(unittest.TestCase):
    def test_no_port_bindings_for_private_services(self):
        service = {'ports': []}
        container = {'HostConfig': {'PortBindings': {}}}
        self.assertEqual(compose.expected_port_bindings(service), [])
        self.assertEqual(compose.actual_port_bindings(container), [])

    def test_detect_unexpected_host_port_exposure(self):
        service = {
            'ports': [
                {'target': 80, 'published': '8080', 'protocol': 'tcp', 'host_ip': '127.0.0.1'}
            ]
        }
        container = {'HostConfig': {'PortBindings': {}}}
        self.assertNotEqual(
            compose.expected_port_bindings(service),
            compose.actual_port_bindings(container),
        )

    def test_require_matching_docker_network(self):
        model = {'networks': {'demanage': {'name': 'demanage_demanage'}}}
        self.assertEqual(
            compose.expected_runtime_networks(model, {'networks': {'demanage': None}}),
            {'demanage_demanage'},
        )

    def test_reject_dynamic_port_bindings(self):
        with self.assertRaises(RuntimeError):
            compose.expected_port_bindings({'ports': [{'target': 80}]})


if __name__ == '__main__':
    unittest.main()
