# dsh-finder-reference

[简体中文](<README_ch.md>)

Drag files from macOS Finder into DSH Web. Confirm each full path to insert native `@file` references.

The plugin does not upload copies, read file contents, or send messages.

**Status:** Development candidate. A user verified the real single-file flow. Independent security review is not complete.

## Requirements

- Run the browser and DSH on the same Mac.
- Use a local-only DSH Web deployment.
- Use DSH `0.2.2-alpha.2` and Node.js `>=24.9.0`.
- Install Xcode Command Line Tools to build the native helper.

Apple Silicon is the verified build target. Other DSH versions and Intel Macs are not verified.

## Build and install

Run these commands from this plugin directory. The build uses no third-party npm dependencies.

```sh
npm test
npm run build
npm run test:native
mkdir -p tests/artifacts
npm pack --ignore-scripts --pack-destination tests/artifacts
```

**Warning:** Disabling or removing the plugin restores DSH's native drag behavior. That behavior can upload files. Do not drag files during a plugin update.

1. Install the generated `.tgz` package through DSH Plugin Manager.
2. Check the installation result.
3. Refresh the existing DSH page.
4. Check for `Finder original references · no uploads` above the input box.

If DSH requires a restart, arrange it before use. Do not stop other sessions to apply this plugin.

## Use

**Warning:** A reference points to the original file. An Agent edit changes that file, not a copy. Session file permissions still apply.

1. Open a Session.
2. Drag 1–32 regular files from Finder into the input box.
3. Check every full path in the confirmation panel.
4. Select **Confirm and reference these originals**.

The references appear in the input box. The plugin shows no success message. It keeps error messages visible.

The panel sits below Goal and above the input box. Its width matches the reading area. Its text uses the Goal body size.

## Limits

- Confirm paths for every drop. Matching metadata does not prove file identity.
- Folders, symbolic links, file promises, ambiguous names, and unsupported path characters are not supported.
- A draft change or file change can cancel insertion. Drag the files again after you check the error.
- Insertion uses the end of the editor selection, not the mouse position. It keeps selected text.
- Multiple references insert one at a time. Partial failure reports the count. The plugin does not retry.
- Images also become file references. The plus menu, normal paste, and valid internal DSH drags keep their native behavior.

## Documentation

The source checkout contains all language files. The package does not include the full documentation set.

| Topic | English | 简体中文 |
| --- | --- | --- |
| Security and data flow | [Security](<docs/security.md>) | [安全边界](<docs/security_ch.md>) |
| Tests and evidence | [Verification](<docs/verification.md>) | [验证记录](<docs/verification_ch.md>) |
| Development status | [Status](<docs/checkpoint.md>) | [开发状态](<docs/checkpoint_ch.md>) |
| Independent review | [Review status](<docs/review-status.md>) | [审阅状态](<docs/review-status_ch.md>) |
| Review recovery | [Pending plan](<docs/review-next-plan.md>) | [待批准方案](<docs/review-next-plan_ch.md>) |
