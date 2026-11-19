# 安全边界

[中文说明](<../README_ch.md>) · [English](<security.md>)

## 范围

插件插入原文件引用，不读取文件正文、不复制文件，也不发送消息。

如果用户请求和 Session 权限允许，Agent 随后可以读取或编辑原文件。路径引用本身不授予文件访问权限。

## 数据流

1. 浏览器在原生上传处理器之前截获外部文件拖拽。
2. 浏览器发送文件名、大小、修改时间、Session ID 和 client nonce。
3. DSH 验证 owner 请求身份，插件检查本机 authority 和请求来源。
4. native helper 从 macOS drag pasteboard 读取文件 URL。
5. Host 使用 `lstat` 检查文件元数据。
6. 用户核对并确认每个完整路径。
7. Host 消耗一次性 ticket，并重新检查文件。
8. 客户端检查 Session 和草稿 revision，然后插入原生引用。

helper 只在 resolve 请求期间运行。它不监控剪贴板、不扫描磁盘，也不作为 daemon 常驻。

## 路径确认

浏览器不提供原文件的磁盘路径。Entries API 的 `fullPath` 是虚拟路径。

不同文件可能具有相同的名称、大小和时间。drag pasteboard 也可能保留旧数据。元数据检查只能拒绝不一致的文件，不能证明文件身份。

**每次拖入都必须核对每个完整路径。**

## 失败处理

- 拖拽保护生效期间，不支持的拖拽不会降级为上传。
- 插件拒绝文件夹、软链接文件、远程 URL 和 file promise。
- 插件拒绝存在歧义的文件名及不支持的路径，包括控制字符、双引号和反斜杠。
- 文件、草稿或 Session 发生变化，或 ticket 过期时，插件停止插入。
- 引用逐个插入。部分失败时，插件报告已插入数量，不自动重试。
- 禁用或卸载后，DSH 恢复原生拖拽行为，此时可能发生上传。

## 请求限制

| 控制项 | 限制 |
| --- | --- |
| 每次拖入文件数 | 32 |
| 请求体 | 64 KiB |
| native helper 超时 | 3 秒 |
| native helper 输出 | 512 KiB |
| snapshot | 每秒 4 次，同时只允许一个 resolve |
| 有效 ticket | 8 个 |
| ticket 有效期 | 60 秒 |

插件使用 DSH 的 authenticated Fetch routes，不启动额外服务器，也不启用 CORS。

POST 请求必须具有 loopback authority、精确同源的 `Origin` 和 `Sec-Fetch-Site: same-origin`。允许远程访问的部署不能使用 helper。DSH 的内部 bridge URL 不能证明请求来自本机。插件检查 bridge 保留的 `Host` header，不信任 forwarding headers。

ticket 绑定 Session ID、client nonce 和文件 fingerprint。该绑定不是独立的多租户权限系统。

本机管理员、同源恶意脚本和恶意 DSH owner 不在本威胁模型的保护范围内。

## 验证证据

见[验证记录](<verification_ch.md>)和[审阅状态](<review-status_ch.md>)。独立安全审阅尚未完成。

背景资料：[Entries API](https://wicg.github.io/entries-api/) · [Apple 文件拖拽](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/DragandDrop/Tasks/DraggingFiles.html)。
