# 棋局参谋 / Board Tactician

[简体中文](#简体中文) | [English](#english)

## 简体中文

面向《Assassin's Creed Black Flag Resynced》（《刺客信条 IV：黑旗》重制版）及原版《刺客信条 IV：黑旗》的本地棋路助手。支持迂棋（Fanorona）、8×8 英式西洋跳棋（English Draughts / Checkers）和莫里斯九子棋（Nine Men's Morris）。

玩家在程序中录入对手的完整行动，内置搜索引擎会在本机计算并标出我方推荐棋路。棋盘固定为对手在上、我方在下，方便和游戏画面直接核对。

> 这个项目起源于拿骚酒馆里输掉的 4000 多金币：[阅读项目的诞生故事](./STORY.md)。

### 直接下载：打包好的离线版本

两个成品都已内置界面、棋规和搜索引擎。运行时不需要联网，不调用 OpenAI 或其他 AI 接口，也不消耗 Token。

| 平台 | 下载 | 运行要求 |
| --- | --- | --- |
| Windows | [Windows x64 便携版 EXE](https://github.com/1902325620-del/fanorona-tactician/releases/latest/download/board-tactician-windows-portable.exe) | Windows 10/11 64 位；无需安装 Node.js 或 .NET |
| Android | [Android APK](https://github.com/1902325620-del/fanorona-tactician/releases/latest/download/board-tactician-android.apk) | Android 7.0 以上 |

[查看最新 Release、更新说明与 SHA-256 校验值](https://github.com/1902325620-del/fanorona-tactician/releases/latest)

项目暂未使用商业代码签名证书，因此 Windows SmartScreen 或 Android 可能显示来源提示。Android 更新包使用同一签名，可覆盖安装旧版本。

### 支持的棋类

- **迂棋 9×5**：必吃、撞吃、拖吃、连续吃子与可选停止。
- **英式西洋跳棋 8×8**：有吃必吃、连续跳吃、单格王棋与升王。游戏使用的不是 10×10 国际跳棋规则。
- **莫里斯九子棋**：摆子、成磨取子、相邻走子、三子飞行与终局判定。

### 主要功能

- 三种棋均使用本地迭代加深 Alpha-Beta 搜索，并提供前三候选棋路。
- 简体中文与英文界面，顶部可快速切换棋类。
- 默认快速搜索，也可选择强力或复仇强度。
- 支持整回合撤销、任意局面编辑、先手切换和棋子颜色自动互换。
- 西洋跳棋可快速取消或切换所选棋子，并明确提示强制吃子与连续跳吃限制。
- Android 适配状态栏、摄像头开孔和底部导航安全区，并提供底部快捷确认与终局提示。
- Windows 便携版只在 `127.0.0.1` 启动本机页面，不对外提供服务。

### 开发说明

本项目主要由 GPT-5.6 AI 在项目发起者的需求设计、实机测试、规则反馈和最终决策指导下开发，包括规则引擎、搜索算法、Web 界面、Windows 便携版与 Android 版本。AI 生成代码已经过自动化测试和实际操作验证，但仍欢迎玩家复核棋规与改进搜索质量。

本项目不包含《刺客信条》或 Ubisoft 的游戏文件、美术资源及代码，也与 Ubisoft 没有隶属、授权或合作关系。

### 本地开发

需要 Node.js 22.13+ 与 pnpm 11：

```bash
pnpm install
pnpm dev
```

验证与构建：

```bash
pnpm test
pnpm run test:mobile
pnpm run lint
pnpm build:launcher
pnpm build:apk
```

Windows 构建需要 .NET 10 SDK；Android 构建还需要 .NET Android workload。`pnpm build:portable` 会生成单 HTML 调试产物，但 `file://` 可能阻止 Web Worker，因此正式离线分享请使用 EXE 或 APK。

### 协议与记录

- [MIT License](./LICENSE)
- [版本维护记录](./CHANGELOG.md)
- [第三方开源许可](./THIRD_PARTY_NOTICES.md)

---

## English

Board Tactician is a local move assistant for *Assassin's Creed Black Flag Resynced* and the original *Assassin's Creed IV: Black Flag*. It supports Fanorona, 8x8 English Draughts / Checkers, and Nine Men's Morris.

Enter the opponent's complete action and the built-in engine calculates recommended replies entirely on your device. The opponent is always shown at the top and your side at the bottom, making the board easy to compare with the game.

> The project began after losing more than 4,000 in-game coins at the Nassau tavern. The full origin story is currently available [in Chinese](./STORY.md).

### Download the ready-to-use offline builds

Both packages include the complete interface, rules, and search engines. They do not require an internet connection at runtime, call OpenAI or any other AI API, or consume tokens.

| Platform | Download | Requirements |
| --- | --- | --- |
| Windows | [Windows x64 portable EXE](https://github.com/1902325620-del/fanorona-tactician/releases/latest/download/board-tactician-windows-portable.exe) | 64-bit Windows 10/11; no Node.js or .NET installation required |
| Android | [Android APK](https://github.com/1902325620-del/fanorona-tactician/releases/latest/download/board-tactician-android.apk) | Android 7.0 or later |

[Open the latest release for notes and SHA-256 checksums](https://github.com/1902325620-del/fanorona-tactician/releases/latest)

The builds are not signed with a commercial code-signing certificate, so Windows SmartScreen or Android may display a source warning. Android updates use the same signing key and can be installed over earlier versions.

### Supported games

- **Fanorona 9x5**: mandatory captures, approach and withdrawal captures, capture chains, and optional stopping.
- **English Draughts 8x8**: mandatory captures, multiple jumps, single-step kings, and promotion. This is not 10x10 International Draughts.
- **Nine Men's Morris**: placement, mills and removals, adjacent movement, flying with three pieces, and terminal-state detection.

### Highlights

- Local iterative-deepening Alpha-Beta search with three ranked candidates for every game.
- Complete Simplified Chinese and English interface with a top game switcher.
- Quick search by default, with Strong and Revenge presets available.
- Full-turn undo, position editing, first-player switching, and automatic piece-color swapping.
- Fast draughts piece selection with clear feedback for mandatory captures and unfinished multiple jumps.
- Android safe-area handling for status bars, display cutouts, and navigation bars, plus quick confirmation and game-over prompts.
- The Windows build only serves the embedded app on `127.0.0.1` and never exposes it to the network.

### Development

This project was developed primarily by GPT-5.6 AI under the project owner's requirements, device testing, rule feedback, and final decisions. The AI contributed the rules engines, search algorithms, Web interface, Windows portable build, and Android app. Generated code has been covered by automated tests and hands-on verification, while rule reviews and search improvements remain welcome.

This project contains no Ubisoft or *Assassin's Creed* game files, artwork, or source code. It is not affiliated with, authorized by, or endorsed by Ubisoft.

### Local development

Node.js 22.13+ and pnpm 11 are required:

```bash
pnpm install
pnpm dev
```

Tests and builds:

```bash
pnpm test
pnpm run test:mobile
pnpm run lint
pnpm build:launcher
pnpm build:apk
```

The Windows build requires the .NET 10 SDK. The Android build also requires the .NET Android workload. `pnpm build:portable` creates a single-file debugging build, but `file://` pages may block Web Workers; use the EXE or APK for reliable offline sharing.

### License and records

- [MIT License](./LICENSE)
- [Changelog](./CHANGELOG.md)
- [Third-party notices](./THIRD_PARTY_NOTICES.md)
