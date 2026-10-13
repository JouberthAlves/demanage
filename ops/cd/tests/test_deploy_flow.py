"""Deploy, rollback, journal and initialization paths against a fake Docker runner.

No Docker, network or root privileges are needed. The fake records the order of
operations so the tests can assert that the intent journal exists before the
first container mutation.
"""

import contextlib
import io
import itertools
import json
import re
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demanage_cd import cli, deploy, manifest, state  # noqa: E402
from demanage_cd.runner import CommandError  # noqa: E402

FIRST = 'b70d556e28832400d1ae07ee7f2d94218736195f'
SECOND = '793247db930eefbfc407c101da6436490111560e'
REVISION = manifest.REVISION_LABEL
OLD = {'backend': 'sha256:old-backend', 'frontend': 'sha256:old-frontend'}
NEW = {'backend': 'sha256:new-backend', 'frontend': 'sha256:new-frontend'}
REFS = {
    'backend': 'ghcr.io/bielxdh3/demanage-backend@sha256:' + 'a' * 64,
    'frontend': 'ghcr.io/bielxdh3/demanage-frontend@sha256:' + 'b' * 64,
}


def release_manifest():
    return {
        'version': 1,
        'source_commit': SECOND,
        'previous_commit': FIRST,
        'backend': REFS['backend'],
        'frontend': REFS['frontend'],
        'approved_by': 'bielxdh3',
        'approved_at': '2026-10-10T12:00:00Z',
    }


def compose_model():
    return {
        'networks': {'demanage': {'name': 'demanage_demanage'}},
        'services': {
            'db': {
                'container_name': 'demanage-db',
                'networks': {'demanage': None},
                'ports': [],
            },
            'backend': {
                'container_name': 'demanage-backend',
                'networks': {'demanage': None},
                'ports': [],
            },
            'frontend': {
                'container_name': 'demanage-frontend',
                'networks': {'demanage': None},
                'ports': [
                    {'target': 80, 'published': '8080', 'protocol': 'tcp', 'host_ip': '127.0.0.1'}
                ],
            },
        },
    }


class FakeDocker:
    """Minimal Docker/Compose behaviour needed by the deploy agent."""

    def __init__(self, journal_file, *, running, healthy_ids, fail_up=lambda refs: False):
        self.running = dict(running)
        self.healthy_ids = set(healthy_ids)
        self.fail_up = fail_up
        self.journal_file = journal_file
        self.images = {}
        self.calls = []
        self.journal_present_at_up = []

    def add_image(self, ref, image_id, revision):
        image = {
            'Id': image_id,
            'Architecture': 'amd64',
            'Config': {'Labels': {REVISION: revision}},
        }
        self.images[ref] = image
        self.images.setdefault(image_id, image)

    def run(self, args, *, check=True, timeout=240):
        args = list(args)
        self.calls.append(args)
        if args[:2] == ['docker', 'pull']:
            if args[2] not in self.images:
                raise CommandError('pull failed')
            return ''
        if args[:3] == ['docker', 'image', 'tag']:
            self.images[args[4]] = dict(self.images[args[3]])
            return ''
        if args[:3] == ['docker', 'image', 'inspect']:
            return json.dumps([self.images[args[3]]])
        if args[:2] == ['docker', 'inspect']:
            return json.dumps([self._container(args[2])])
        if args[:2] == ['docker', 'compose']:
            if 'config' in args:
                return json.dumps(compose_model())
            if 'ps' in args:
                return 'cid-' + args[-1]
            if 'up' in args:
                return self._up(args)
        raise AssertionError(f'unexpected command: {args}')

    def _up(self, args):
        last_f = len(args) - 1 - args[::-1].index('-f')
        overlay = Path(args[last_f + 1])
        refs = re.findall(r"image: '([^']+)'", overlay.read_text(encoding='utf-8'))
        self.journal_present_at_up.append(self.journal_file.exists())
        if self.fail_up(refs):
            raise CommandError('compose up failed')
        self.running['backend'] = self.images[refs[0]]['Id']
        self.running['frontend'] = self.images[refs[1]]['Id']
        return ''

    def _container(self, name):
        service = name.removeprefix('demanage-')
        if service == 'db':
            return {
                'Id': 'cid-db',
                'Image': 'sha256:db',
                'Config': {'Labels': {
                    'com.docker.compose.project': 'demanage',
                    'com.docker.compose.service': 'db',
                }},
                'NetworkSettings': {'Networks': {'demanage_demanage': {}}},
                'HostConfig': {'PortBindings': {}},
                'Mounts': [{
                    'Type': 'volume',
                    'Name': 'demanage_pgdata',
                    'Destination': '/var/lib/postgresql',
                }],
                'State': {'Running': True, 'Health': {'Status': 'healthy'}},
            }
        bindings = {}
        if service == 'frontend':
            bindings = {'80/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8080'}]}
        health = 'healthy' if self.running[service] in self.healthy_ids else 'unhealthy'
        return {
            'Id': 'cid-' + service,
            'Image': self.running[service],
            'Config': {'Labels': {
                'com.docker.compose.project': 'demanage',
                'com.docker.compose.service': service,
            }},
            'NetworkSettings': {'Networks': {'demanage_demanage': {}}},
            'HostConfig': {'PortBindings': bindings},
            'Mounts': [],
            'State': {'Running': True, 'Health': {'Status': health}},
        }


class DeployFlowTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.config = {
            'compose_files': ['/srv/demanage/docker-compose.prod.yml'],
            'env_file': '/srv/demanage/.env',
            'project_name': 'demanage',
            'backup_root': str(self.base / 'backups'),
            'state_file': str(self.base / 'state.json'),
            'lock_file': str(self.base / 'release.lock'),
            'public_health_url': manifest.PUBLIC_HEALTH_URL,
        }
        self.journal_file = self.base / state.JOURNAL_FILENAME
        self.state_file = self.base / 'state.json'
        self.lock_patch = mock.patch.object(
            cli, 'exclusive_lock', lambda path: contextlib.nullcontext()
        )
        self.lock_patch.start()

    def tearDown(self):
        self.lock_patch.stop()
        self._tmp.cleanup()

    def write_state(self, source, images):
        state.write_state(self.state_file, {
            'source_commit': source,
            'running_image_ids': images,
            'deployed_at': '2026-10-09T00:00:00+00:00',
        })

    def make_fake(self, *, running=OLD, fail_up=lambda refs: False):
        fake = FakeDocker(
            self.journal_file,
            running=running,
            healthy_ids=set(OLD.values()) | set(NEW.values()),
            fail_up=fail_up,
        )
        fake.add_image(REFS['backend'], NEW['backend'], SECOND)
        fake.add_image(REFS['frontend'], NEW['frontend'], SECOND)
        fake.add_image(OLD['backend'], OLD['backend'], FIRST)
        fake.add_image(OLD['frontend'], OLD['frontend'], FIRST)
        return fake

    def make_ctx(self, fake, *, fetch=lambda: None):
        ticks = itertools.count(0, 10)

        def probe(url):
            if fake.running['backend'] in fake.healthy_ids:
                return {'status': 'ok', 'service': 'demanage-backend'}
            raise RuntimeError('backend down')

        return deploy.Context(
            config=self.config,
            runner=fake,
            probe=probe,
            backup=lambda runner, config, commit: (str(self.base / 'demanage.dump'), 'f' * 64),
            sleep=lambda seconds: None,
            monotonic=lambda: next(ticks),
            health_timeout=60,
            fetch=fetch,
        )

    # --- happy path -------------------------------------------------------

    def test_release_writes_journal_before_mutating_containers(self):
        self.write_state(FIRST, OLD)
        fake = self.make_fake()
        ctx = self.make_ctx(fake, fetch=lambda: manifest.validate_release(release_manifest()))

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.run_agent(ctx), 0)

        self.assertEqual(fake.journal_present_at_up, [True])
        self.assertFalse(self.journal_file.exists())
        saved = state.load_state(self.state_file)
        self.assertEqual(saved['source_commit'], SECOND)
        self.assertEqual(saved['running_image_ids'], NEW)

    def test_pulls_are_checked_for_revision_label(self):
        self.write_state(FIRST, OLD)
        fake = self.make_fake()
        fake.add_image(REFS['backend'], NEW['backend'], FIRST)  # wrong revision label
        ctx = self.make_ctx(fake, fetch=lambda: manifest.validate_release(release_manifest()))

        with self.assertRaises(RuntimeError) as raised:
            cli.run_agent(ctx)
        self.assertIn('revision label', str(raised.exception))
        self.assertEqual(fake.journal_present_at_up, [])
        self.assertEqual(state.load_state(self.state_file)['source_commit'], FIRST)

    # --- failure paths ----------------------------------------------------

    def test_failed_apply_rolls_back_and_keeps_previous_state(self):
        self.write_state(FIRST, OLD)
        fake = self.make_fake(fail_up=lambda refs: refs[0] == REFS['backend'])
        ctx = self.make_ctx(fake, fetch=lambda: manifest.validate_release(release_manifest()))

        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(CommandError):
                cli.run_agent(ctx)

        self.assertEqual(fake.running, OLD)
        self.assertFalse(self.journal_file.exists())
        self.assertEqual(state.load_state(self.state_file)['source_commit'], FIRST)
        rollback_ups = [
            call for call in fake.calls
            if 'up' in call and 'compose' in call
        ]
        self.assertEqual(len(rollback_ups), 2)

    def test_failed_rollback_keeps_journal_and_blocks_next_run(self):
        self.write_state(FIRST, OLD)
        fake = self.make_fake(fail_up=lambda refs: True)
        ctx = self.make_ctx(fake, fetch=lambda: manifest.validate_release(release_manifest()))

        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(CommandError):
                cli.run_agent(ctx)

        journal = state.read_journal(self.journal_file)
        self.assertIsNotNone(journal)
        self.assertEqual(journal['phase'], state.ROLLBACK_FAILED)

        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main(['--config', str(self.base / 'x.json')], ctx=ctx), 1)
        self.assertEqual(state.load_state(self.state_file)['source_commit'], FIRST)

    # --- crash recovery ---------------------------------------------------

    def _journal(self, *, new, previous):
        state.write_journal(self.journal_file, {
            'phase': state.APPLYING,
            'target': SECOND,
            'previous': FIRST,
            'previous_images': previous,
            'new_images': new,
            'rollback_refs': {'backend': 'localhost/x:1', 'frontend': 'localhost/y:1'},
            'backup': str(self.base / 'demanage.dump'),
            'started_at': '2026-10-10T12:00:00+00:00',
        })

    def test_crash_after_apply_is_recovered_on_next_run(self):
        self.write_state(FIRST, OLD)
        self._journal(new=NEW, previous=OLD)
        fake = self.make_fake(running=NEW)
        ctx = self.make_ctx(fake, fetch=lambda: None)

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.run_agent(ctx), 0)

        saved = state.load_state(self.state_file)
        self.assertEqual(saved['source_commit'], SECOND)
        self.assertEqual(saved['running_image_ids'], NEW)
        self.assertTrue(saved.get('recovered_from_journal'))
        self.assertFalse(self.journal_file.exists())

    def test_crash_before_apply_clears_journal_when_previous_release_runs(self):
        self.write_state(FIRST, OLD)
        self._journal(new=NEW, previous=OLD)
        fake = self.make_fake(running=OLD)
        ctx = self.make_ctx(fake, fetch=lambda: None)

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.run_agent(ctx), 0)

        self.assertFalse(self.journal_file.exists())
        self.assertEqual(state.load_state(self.state_file)['source_commit'], FIRST)

    def test_unknown_container_state_blocks_and_keeps_journal(self):
        self.write_state(FIRST, OLD)
        self._journal(new=NEW, previous=OLD)
        fake = self.make_fake(running={'backend': 'sha256:other', 'frontend': OLD['frontend']})
        ctx = self.make_ctx(fake, fetch=lambda: None)

        with self.assertRaises(RuntimeError) as raised:
            cli.run_agent(ctx)
        self.assertIn('operator action needed', str(raised.exception))
        self.assertTrue(self.journal_file.exists())
        self.assertEqual(state.load_state(self.state_file)['source_commit'], FIRST)

    # --- initialization and helpers --------------------------------------

    def test_initialize_requires_matching_revision_labels(self):
        fake = self.make_fake(running=OLD)
        ctx = self.make_ctx(fake)

        with self.assertRaises(RuntimeError) as raised:
            cli.run_agent(ctx, init_sha=SECOND)
        self.assertIn('revision label', str(raised.exception))
        self.assertFalse(self.state_file.exists())

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.run_agent(ctx, init_sha=FIRST), 0)
        saved = state.load_state(self.state_file)
        self.assertEqual(saved['source_commit'], FIRST)
        self.assertEqual(saved['running_image_ids'], OLD)

    def test_healthy_logs_the_reason_instead_of_hiding_it(self):
        self.write_state(FIRST, OLD)
        fake = self.make_fake()
        ctx = self.make_ctx(fake)

        def broken_probe(url):
            raise ValueError('connection reset')

        ctx.probe = broken_probe
        buffer = io.StringIO()
        with contextlib.redirect_stderr(buffer):
            self.assertFalse(deploy.healthy(ctx))
        self.assertIn('health check not passing: ValueError', buffer.getvalue())

    def test_journal_round_trip_and_validation(self):
        self._journal(new=NEW, previous=OLD)
        journal = state.read_journal(self.journal_file)
        self.assertEqual(journal['target'], SECOND)
        state.clear_journal(self.journal_file)
        self.assertIsNone(state.read_journal(self.journal_file))

        self.journal_file.write_text(json.dumps({'phase': 'applying'}), encoding='utf-8')
        with self.assertRaises(RuntimeError):
            state.read_journal(self.journal_file)

    def test_fetch_returns_none_on_404(self):
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 404, 'Not Found', None, None)

        self.assertIsNone(manifest.fetch_approval(opener=opener))


if __name__ == '__main__':
    unittest.main()
