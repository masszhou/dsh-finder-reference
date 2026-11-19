# 验证记录

[中文说明](<../README_ch.md>) · [English](<verification.md>)

## 已记录的结果

以下结果截至 2026-11-19，描述本地开发候选，不代表 GitHub 发布认证。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 协议与客户端单元测试 | 94 项通过 | 不连接真实 DSH Session |
| DSH HTTP bridge 测试 | 1 项通过 | 真实 bridge 代码，mock 协议；不是身份验证测试 |
| 浏览器 fixture | 9 项检查通过 | 真实 React、Chrome 和 DSH CSS；mock Host，合成拖拽 |
| 输入模型 | 5 项检查通过 | 真实 SessionInputShell 和 Lexical；mock Host |
| 插件生命周期 | 5 项检查通过 | 真实 Cordis 和 SlotRegistry；stub 服务 |
| native 自检 | 通过 | 独立临时 pasteboard |
| 安装后的运行文件 | 8 项 hash 一致 | 验证磁盘文件，不证明浏览器已激活插件 |
| 真实 Finder 流程 | 用户确认通过 | 单文件：拖入、路径确认、引用、Agent 读取 |
| 独立安全审阅 | 尚未开始 | 隔离检查尚未完成 |

真实单文件测试不覆盖所有文件类型和批量大小。自动 UI 检查不能替代最终安装版的界面验收。

## 基础检查

在插件源码目录运行：

```sh
npm test
npm run build
npm run test:native
```

native 自检不读取用户的 drag pasteboard 或普通剪贴板。不要将 `snapshot` 用作常规健康检查。

## 本地集成检查

这些脚本包含与开发机器绑定的 DSH checkout 和依赖路径。先按本机环境调整路径。浏览器测试还需要 Google Chrome。这些测试不能保证在新 clone 中直接运行。

```sh
node --test tests/*.test.mjs tests/dsh-bridge.integration.mjs
node tests/browser-smoke.mjs
node scripts/test-real-input.mjs
```

源码：[bridge 测试](<../tests/dsh-bridge.integration.mjs>)、[浏览器 runner](<../tests/browser-smoke.mjs>)、[浏览器 fixture](<../tests/browser-fixture-entry.jsx>)、[输入模型 runner](<../scripts/test-real-input.mjs>)和[输入模型 fixture](<../tests/real-input.integration.mjs>)。

先使用 esbuild 将[生命周期 fixture](<../tests/activation-fixture.mjs>)打包为 Node ESM，再执行测试。

生成的报告和截图保存在 `tests/artifacts/` 中。Git 不包含这些生成物。本文汇总本地证据，不链接无法公开访问的报告。

## 安装检查

```sh
node scripts/verify-installed.mjs /absolute/path/to/installed/dsh-finder-reference
```

[校验脚本](<../scripts/verify-installed.mjs>)将已安装文件与本地构建 hash 比较，不访问浏览器或 pasteboard。

单独检查 Plugin Manager 的结果。刷新现有页面以检查客户端激活状态。最近一次本地更新没有重启 DSH。

多个本地候选使用版本号 `0.1.0`。请记录源码 commit 和安装包 hash；版本号不能单独标识构建。

剩余安全审阅限制见[审阅状态](<review-status_ch.md>)。
