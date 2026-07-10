# 迂棋参谋

一个面向《刺客信条 III》迂棋（Fanorona）小游戏的浏览器棋路助手。棋盘固定为对手在上、我方在下；录入对手完整回合后，本地 Web Worker 会计算并标出我方推荐棋路。

本项目从零实现界面、规则引擎和搜索算法，不包含《刺客信条》或 Ubisoft 的游戏文件、美术资源及代码，也与 Ubisoft 没有隶属或授权关系。

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
