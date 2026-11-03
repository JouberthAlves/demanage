"""C05 regression: live 80/tcp Tunnel target with a hardened nonroot frontend."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
OVERRIDE = ROOT / 'ops/cd/overrides/issue97-c05-prod-security.yml'


class C05ProductionOverlayTests(unittest.TestCase):
    def test_overlay_keeps_live_tunnel_80_and_hardens_only_frontend(self):
        self.assertTrue(OVERRIDE.is_file(), 'C05 production overlay must be version-controlled')
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder) / 'live.yml'
            base.write_text(
                'services:\n'
                '  frontend:\n'
                '    image: ghcr.io/example/demanage-frontend@sha256:' + 'a' * 64 + '\n'
                '    environment:\n      PORT: 80\n      API_HOST: backend\n'
                '    networks: [demanage]\n'
                'networks:\n  demanage: {}\n',
                encoding='utf-8',
            )

            def model(*files: Path) -> dict:
                args = ['docker', 'compose', '--project-name', 'demanage']
                for file in files:
                    args += ['-f', str(file)]
                result = subprocess.run(
                    args + ['config', '--format', 'json'],
                    capture_output=True, text=True, check=True, timeout=30,
                )
                return json.loads(result.stdout)['services']['frontend']

            original = model(base)
            secured = model(base, OVERRIDE)
            self.assertTrue(secured['read_only'], 'C05 requires read-only frontend filesystem')
            self.assertIn('ALL', secured['cap_drop'], 'C05 requires capability drop')
            self.assertIn('no-new-privileges:true', secured['security_opt'])
            self.assertTrue(any('/tmp' in v for v in secured['tmpfs']))
            for key in ('image', 'environment', 'ports', 'networks', 'container_name'):
                self.assertEqual(original.get(key), secured.get(key), f'C05 must not alter {key}')
            self.assertEqual(secured['environment']['PORT'], '80')


if __name__ == '__main__':
    unittest.main()
