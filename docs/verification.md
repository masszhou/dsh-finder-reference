# Verification

[README](<../README.md>) · [简体中文](<verification_ch.md>)

## Recorded results

These results describe the local development candidate as of 2026-11-19. They do not certify a GitHub release.

| Check | Result | Scope |
| --- | --- | --- |
| Protocol and client unit tests | 94 passed | No live DSH Session |
| DSH HTTP bridge test | 1 passed | Real bridge code; mock protocol; not an authentication test |
| Browser fixture | 9 checks passed | Real React, Chrome, and DSH CSS; mock Host; synthetic drops |
| Input model | 5 checks passed | Real SessionInputShell and Lexical; mock Host |
| Plugin lifecycle | 5 checks passed | Real Cordis and SlotRegistry; stub services |
| Native self-test | Passed | Isolated temporary pasteboard |
| Installed runtime | 8 file hashes matched | Disk files; not proof of browser activation |
| Real Finder flow | User confirmed | One file: drop, path confirmation, reference, Agent read |
| Independent security review | Not started | Isolation checks are incomplete |

The real single-file test does not cover every file type or batch size. Automated UI checks do not replace acceptance of the final installed UI.

## Basic checks

Run from the plugin source directory:

```sh
npm test
npm run build
npm run test:native
```

The native self-test does not read the user's drag pasteboard or normal clipboard. Do not run `snapshot` as a routine health check.

## Local integration checks

These scripts contain machine-specific DSH checkout and dependency paths. Set those paths for your machine first. Browser tests also require Google Chrome. These are not portable clean-clone tests.

```sh
node --test tests/*.test.mjs tests/dsh-bridge.integration.mjs
node tests/browser-smoke.mjs
node scripts/test-real-input.mjs
```

Sources: [bridge test](<../tests/dsh-bridge.integration.mjs>), [browser runner](<../tests/browser-smoke.mjs>), [browser fixture](<../tests/browser-fixture-entry.jsx>), [input runner](<../scripts/test-real-input.mjs>), and [input fixture](<../tests/real-input.integration.mjs>).

Bundle the [lifecycle fixture](<../tests/activation-fixture.mjs>) with esbuild for Node ESM before execution.

Generated reports and screenshots stay in `tests/artifacts/`. Git does not include them. This document summarizes local evidence; it does not link to unavailable reports.

## Installation checks

```sh
node scripts/verify-installed.mjs /absolute/path/to/installed/dsh-finder-reference
```

The [verifier](<../scripts/verify-installed.mjs>) compares installed files with the local build hashes. It does not access the browser or pasteboard.

Check Plugin Manager's result separately. Refresh the existing page to check client activation. The latest local update did not restart DSH.

Several local candidates use version `0.1.0`. Record the source commit and package hash; the version alone is not a build identifier.

See [review status](<review-status.md>) for the remaining security review limit.
