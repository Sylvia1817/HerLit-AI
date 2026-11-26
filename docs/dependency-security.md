# Dependency security triage

The earlier CI install reported 35 advisories (1 low, 15 moderate, 17 high, 2 critical). That is a historical baseline, not the current confirmed count. The new **Dependency advisory inventory** job runs npm audit against the lockfile, both with all dependencies and with dev dependencies omitted. It prints direct/transitive status, installed paths, vulnerable ranges, advisory URLs and npm's proposed fix. A successful inventory job means the scan ran, **not** that the dependency tree is clean.

Triage order: critical/high advisories reachable by the running service; build, browser and deployment tooling; then lower severities. npm's dev classification is not a complete runtime reachability analysis: this project starts Vinext from devDependencies. Review both reports.

1. Record advisories and affected dependency paths using npm run audit:deps and npm explain <package> after npm ci.
2. Check compatibility and patched versions; make minimal targeted upgrades in a separate branch and regenerate package-lock.json using npm. Do not run npm audit fix --force indiscriminately, fabricate lockfile entries or ignore advisories to make CI green.
3. Run typecheck, lint, build/unit tests, browser approval and secret scanning. Re-run inventory and compare remaining risk before adopting a high/critical gate. Document any temporary exceptions explicitly.

CI uses mock content, no provider credentials. Do not deploy publicly until serious reachable vulnerabilities have been assessed.
