# Review recovery plan

[README](<../README.md>) · [简体中文](<review-next-plan_ch.md>)

**Pending approval. Not executed.**

In the second check, command permissions stopped the OS probes. The network probe did not run. Neither check proved OS and network isolation. An explicit command allowlist may help, but this is not verified.

## Proposed procedure

1. Obtain approval for the exact permission change.
2. Freeze the current candidate in a separate review clone.
3. Keep the old candidate and reports.
4. Allow only fixed, inspected probe commands and clone-local Node tests.
5. Keep file-access restrictions for the workspace, credentials, and browser profiles.
6. Keep sandbox enforcement and network restrictions.
7. Block delegation and unrelated tools.
8. Run one isolation check.
9. Start the approved review only if isolation checks pass.

Change only the review clone configuration. Do not change global settings. Do not allow arbitrary Bash, `bypassPermissions`, or unsandboxed execution.

The OS probes must execute and demonstrate denied access. A skipped probe, a command-layer denial, or no observed connection is not sufficient evidence.

If the check fails, record the result and stop. Do not weaken the boundary to obtain a passing result.

This plan is not permission to run it. See [review status](<review-status.md>).
