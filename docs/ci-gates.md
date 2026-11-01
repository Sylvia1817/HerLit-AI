# CI acceptance and main branch protection

Required status checks (exact job names):

- `Typecheck, lint and tests`
- `Browser approval flow`
- `Secret scan`

A repository administrator must protect `main` in Settings → Rules → Rulesets
(or Settings → Branches): require a pull request, require all checks above,
require the branch to be up to date, and disallow force pushes/deletion. Apply
the rule to administrators as well and keep bypass permissions restricted.
The connected GitHub integration cannot change repository administration settings.
Do not describe these gates as enforced until the settings are applied.

Verify enforcement with a temporary PR containing a failing assertion: the PR
must be blocked. Revert that assertion, rerun CI, and confirm it becomes eligible
for merge. Do not merge the deliberately failing assertion.

## Running the checks locally

```sh
npm ci
npm run typecheck:editorial
npm run lint
npm test
npx playwright install --with-deps chromium
# In a separate terminal after the build performed by npm test:
EDITORIAL_PROVIDER_MODE=mock npm run start -- --port 4173
npm run test:browser
```

`npm test` discovers all `tests/*.test.ts`; the browser test is separate and
requires the built server. The browser job uses mock data and real browser/API
interactions, including downloads and invalidating approval after an edit.
Secret scan checks Git history using Gitleaks. A finding in older history also
fails the check; rotate exposed credentials before considering history cleanup.
Do not add broad allowlists to make a finding pass.

## Remaining content and data boundaries

A valid claim ID does not prove that prose is entailed by its source. Ordinary
facts in titles, hooks, cover copy, hashtags and other free text still require
editorial review. Browser regression verifies workflow behavior, not literary
accuracy or source authority. Fake-key adapter tests verify error-response
redaction for provider failures; they are not a full privacy audit of exports,
logs or every possible exception. Markdown/JSON exports currently include audit
data, and must not receive private information or credentials.

Historical `daily/` packages and `project-data/outputs/` deliverables are not
accepted by the current domain engine merely because CI passes. They need a
separate editorial/source review before reuse. A future content acceptance
suite should maintain reviewed fixtures and inject unsupported facts into each
user-visible field, rejecting or flagging them for explicit review. Do not use
keyword checks as proof of factual grounding.
