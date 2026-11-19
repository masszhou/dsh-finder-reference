# Development status

[README](<../README.md>) · [简体中文](<checkpoint_ch.md>)

## Current candidate

- Version: `0.1.0`.
- Target: local macOS DSH Web, `0.2.2-alpha.2`.
- Real single-file use: confirmed by the user.
- Independent security review: not started.

## Implemented

- Finder paths require explicit confirmation before insertion.
- External file drops do not use an upload fallback while the guard is active.
- References point to original files. They do not change Session permissions.
- The panel sits below Goal and above the input box.
- Panel width matches the reading area.
- Text uses 13px type and a 20px line height, as in Goal body text.
- Success inserts references without a message. The badge stays visible. Path confirmation and error handling remain available.

## Fixed during validation

| Issue | Correction |
| --- | --- |
| Real DSH requests returned `LOCAL_ONLY` | Validate the preserved local authority behind the DSH HTTP bridge |
| Panel filled the page width | Apply the real reading-column width rules |
| Badge and status text used different sizes | Match Goal body text |
| Success text added an unwanted row | Remove the success row in both languages |

Tests cover the corrected boundaries. See [verification](<verification.md>) for their limits.

## Remaining work

- Complete the [independent review](<review-status.md>) only after an authorized isolation check passes.
- Confirm the final installed UI with the user.
- Adapt machine-specific integration test paths before use on another machine.

## Documentation maintenance

English is the default language. Each Chinese document uses the same name with `_ch` before `.md`.

Update both language files when behavior changes. Keep language links and translated document links consistent. Keep local paths, job IDs, and generated reports out of public documentation.

Run the [documentation checker](<../scripts/check-docs.mjs>) before a documentation commit:

```sh
node scripts/check-docs.mjs
```
