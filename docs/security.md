# Security

[README](<../README.md>) · [简体中文](<security_ch.md>)

## Scope

The plugin inserts references to original files. It does not read file contents, copy files, or send messages.

An Agent can later read or edit an original file if the user request and Session permissions allow it. A reference does not grant file access.

## Data flow

1. The browser intercepts external file drops before the native uploader.
2. It sends file names, sizes, modification times, a Session ID, and a client nonce.
3. DSH authenticates the owner request. The plugin checks the local authority and request origin.
4. A native helper reads file URLs from the macOS drag pasteboard.
5. The Host checks file metadata with `lstat`.
6. The user checks and confirms each full path.
7. The Host consumes a one-use ticket and checks the files again.
8. The client checks the Session and draft revision, then inserts native references.

The helper runs only for a resolve request. It does not monitor the clipboard, scan disks, or run as a daemon.

## Path confirmation

A browser does not provide the original disk path. The Entries API `fullPath` is a virtual path.

Names, sizes, and times can match different files. The drag pasteboard can contain old data. Metadata checks reject inconsistent files. They do not prove identity.

**Check every full path on every drop.**

## Failure behavior

- Unsupported drops do not fall back to uploads while the guard is active.
- The plugin rejects folders, symbolic link files, remote URLs, and file promises.
- It rejects ambiguous names and unsupported paths, including control characters, double quotes, and backslashes.
- File changes, draft changes, Session changes, and expired tickets stop insertion.
- References insert one at a time. A partial failure reports the inserted count. It does not retry.
- Disabling or removing the plugin restores native DSH drag behavior. Uploads can then occur.

## Request limits

| Control | Limit |
| --- | --- |
| Files per drop | 32 |
| Request body | 64 KiB |
| Native helper timeout | 3 seconds |
| Native helper output | 512 KiB |
| Snapshots | 4 per second; one resolve at a time |
| Live tickets | 8 |
| Ticket lifetime | 60 seconds |

The plugin uses authenticated DSH Fetch routes. It does not start another server or enable CORS.

POST requests require a loopback authority, an exact same-origin `Origin`, and `Sec-Fetch-Site: same-origin`. Remote-enabled deployments cannot use the helper. The DSH internal bridge URL is not proof of a local request. The plugin checks its preserved `Host` header and ignores forwarding headers.

Tickets bind the Session ID, client nonce, and file fingerprint. This binding is not a separate multi-tenant access system.

Local administrators, malicious same-origin scripts, and malicious DSH owners are outside this threat model.

## Evidence

See [verification](<verification.md>) and [review status](<review-status.md>). Independent security review is not complete.

Background: [Entries API](https://wicg.github.io/entries-api/) · [Apple file dragging](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/DragandDrop/Tasks/DraggingFiles.html).
