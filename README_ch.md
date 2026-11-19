# dsh-finder-reference

[English](<README.md>)

从 macOS Finder 拖入文件，在 DSH Web 中确认每个完整路径后，插入原生 `@文件` 引用。

插件不上传副本、不读取文件正文，也不发送消息。

**状态：**开发候选。用户已验收真实的单文件流程。独立安全审阅尚未完成。

## 环境要求

- 浏览器与 DSH 必须运行在同一台 Mac 上。
- 使用仅允许本机访问的 DSH Web 部署。
- 使用 DSH `0.2.2-alpha.2` 和 Node.js `>=24.9.0`。
- 构建 native helper 需要 Xcode Command Line Tools。

已验证的构建目标为 Apple Silicon。其他 DSH 版本和 Intel Mac 尚未验证。

## 构建与安装

在本插件目录运行以下命令。构建不需要第三方 npm 依赖。

```sh
npm test
npm run build
npm run test:native
mkdir -p tests/artifacts
npm pack --ignore-scripts --pack-destination tests/artifacts
```

**警告：**禁用或卸载本插件后，DSH 会恢复原生拖拽行为，该行为可能上传文件。更新插件期间不要拖入文件。

1. 通过 DSH Plugin Manager 安装生成的 `.tgz` 包。
2. 检查安装结果。
3. 刷新现有 DSH 页面。
4. 检查输入框上方是否显示“Finder 原文件引用 · 不上传”。

如果 DSH 要求重启，先安排重启再使用。不要为了应用本插件而停止其他 Session。

## 使用

**警告：**引用指向原文件。Agent 编辑会修改原文件，而非副本。Session 的文件权限限制仍然有效。

1. 打开一个 Session。
2. 从 Finder 向输入框拖入 1–32 个普通文件。
3. 核对确认面板中的每个完整路径。
4. 点击“确认这些原文件并引用”。

引用会出现在输入框内。插件不显示成功提示，但会保留错误提示。

面板位于 Goal 下方、输入框上方。面板宽度与阅读区域一致。文字大小与 Goal 正文一致。

## 限制

- 每次拖入都需要确认路径。元数据一致不能证明文件身份。
- 不支持文件夹、软链接、file promise、存在歧义的同名文件和不支持的路径字符。
- 草稿或原文件发生变化时，插件可能取消插入。检查错误后重新拖入文件。
- 插入点位于编辑器选择末尾，不取决于鼠标位置。插件保留选中的文字。
- 多个引用逐个插入。部分失败时，插件报告已插入数量，不自动重试。
- 图片也采用文件引用。加号菜单、普通粘贴和有效的 DSH 内部拖拽保持原生行为。

## 文档

源码目录包含完整双语文档。当前安装包不包含全部文档。

| 主题 | 简体中文 | English |
| --- | --- | --- |
| 安全与数据流 | [安全边界](<docs/security_ch.md>) | [Security](<docs/security.md>) |
| 测试与证据 | [验证记录](<docs/verification_ch.md>) | [Verification](<docs/verification.md>) |
| 开发状态 | [开发状态](<docs/checkpoint_ch.md>) | [Status](<docs/checkpoint.md>) |
| 独立审阅 | [审阅状态](<docs/review-status_ch.md>) | [Review status](<docs/review-status.md>) |
| 恢复审阅 | [待批准方案](<docs/review-next-plan_ch.md>) | [Pending plan](<docs/review-next-plan.md>) |
