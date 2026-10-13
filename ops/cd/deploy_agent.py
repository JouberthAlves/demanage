#!/usr/bin/env python3
"""Pull-only, fail-closed production deploy agent for deManage (entry point).

Run by demanage-cd.service as:
  /usr/bin/python3 /opt/demanage/cd/deploy_agent.py --config /opt/demanage/cd/config.json

The implementation lives in the demanage_cd package next to this file, so deploy
the directory ops/cd/ (both deploy_agent.py and demanage_cd/) together.

No inbound port, long-lived GitHub token, automatic schema migration approval,
volume deletion, database recreation, or Cloudflare configuration changes.
"""

from __future__ import annotations

import sys

from demanage_cd.cli import main

if __name__ == "__main__":
    sys.exit(main())
