# 迂棋参谋

一个面向 2026 年 7 月 9 日发售的《Assassin's Creed Black Flag Resynced》（《刺客信条 IV：黑旗》重制版）迂棋（Fanorona）小游戏的本地棋路助手。棋盘固定为对手在上、我方在下；录入对手完整回合后，本地 Web Worker 会计算并标出我方推荐棋路。

> 从拿骚酒馆输掉 4000 多金币，到造出一个更强的本地 AI：[阅读迂棋参谋的完整诞生故事](./STORY.md)。

## 直接下载：打包好的离线版本

不想配置开发环境时，直接下载对应平台的成品。两个版本都已内置界面、规则和搜索引擎，运行时不需要联网、不调用 AI 接口，也不消耗 Token。

| 平台 | 成品下载 | 运行要求 |
| --- | --- | --- |
| Windows | [下载 Windows x64 便携版 EXE](https://github.com/1902325620-del/fanorona-tactician/releases/latest/download/fanorona-tactician-windows-x64.exe) | Windows 10/11 64 位；双击运行，无需安装 Node.js 或 .NET |
| Android | [下载 Android 64 位 APK](https://github.com/1902325620-del/fanorona-tactician/releases/latest/download/fanorona-tactician-android-arm64.apk) | Android 7.0 以上；安装时允许当前应用“安装未知应用” |

[查看全部版本与校验值](https://github.com/1902325620-del/fanorona-tactician/releases/latest)

这些文件由本仓库源码直接构建，暂未使用商业代码签名证书，因此 Windows SmartScreen 或安卓系统可能显示来源提示。

重制版采用的迂棋规则与传统 9×5 Fanorona 规则一致，因此本项目也可用于原版《刺客信条 IV：黑旗》及其他采用相同规则的游戏。

本项目从零实现界面、规则引擎和搜索算法，不包含《刺客信条》或 Ubisoft 的游戏文件、美术资源及代码，也与 Ubisoft 没有隶属或授权关系。

## 开发说明

本项目主要由 GPT-5.6 AI 在项目发起者的需求设计、测试反馈和最终决策指导下开发，包括规则引擎、搜索算法、Web 界面、Windows 便携版与 Android 版本。AI 生成代码已经过自动化测试，但实际棋局表现仍欢迎玩家复核和改进。

## 能力

- 完整 Fanorona 9×5 规则，包括必吃、撞吃/拖吃、可选停止连吃和首回合连吃
- 迭代加深 Negamax、Alpha-Beta、置换表、安静搜索与走法排序
- 三档思考时间、前三候选、整回合撤销和任意局面校准
- 全部搜索在浏览器本地完成

## 本地运行

需要 Node.js 22.13+ 与 pnpm 11：

```bash
pnpm install
pnpm dev
```

验证：

```bash
pnpm test
pnpm run test:mobile
pnpm run lint
```

## Windows 离线分享

```bash
pnpm build:launcher
```

构建机需要 .NET 10 SDK。该命令会生成 `outputs/fanorona-windows-portable.exe`。EXE 内嵌完整网页和引擎，运行后只在 `127.0.0.1` 启动临时 HTTP 服务并打开默认浏览器。接收者不需要安装 Node.js、.NET、联网或使用 API Token。

`pnpm build:portable` 仍会生成单 HTML，但 `file://` 页面可能被浏览器阻止创建 Web Worker，因此它只作为限制说明和 HTTP/HTTPS 调试产物，不是正式离线入口。

## 手机端

```bash
dotnet workload install android
pnpm build:apk
```

会生成 `outputs/fanorona-android.apk`。APK 在内置 WebView 的本地虚拟 HTTPS 域名中加载界面和 Web Worker，不依赖外部网站。`pnpm build:mobile` 另会生成可部署到 HTTPS 静态网站的 PWA；PWA 首次加载后支持离线使用。

## 开源协议

[MIT](./LICENSE)

版本维护记录见 [CHANGELOG.md](./CHANGELOG.md)。
