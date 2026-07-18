**Languages:** [Русский](README.md) · [English](README.en.md) · [日本語](README.ja.md) · **中文** · [العربية](README.ar.md) · [Српски](README.sr.md)

# LumaStage

**开源 VTuber 工作室：Windows/macOS 桌面端 + 带 Face ID 的 iPhone 追踪器。**

`Electron` · `React` · `SwiftUI` · `ARKit` · `GPL-3.0`

LumaStage 在舞台上加载 Live2D 模型（Cubism 3/4/5 与 VTube Studio 文件夹），并通过局域网接收 iPhone 的面部追踪——无需账号、云服务或订阅。追踪数据只留在你的本地网络。

| 部分 | 作用 |
| --- | --- |
| **Desktop** | 模型渲染、参数映射、场景、快捷键、OBS 叠加层 |
| **Tracker** | Face ID iPhone 上的 TrueDepth + ARKit，低延迟，局域网 |
| **Protocol** | 开放 TCP/Bonjour 协议（`_lumastage._tcp`，端口 `39510`） |
| **VTS API** | 兼容 VTube Studio Plugin API（`ws://127.0.0.1:8001`） |

> 专有的 Live2D Cubism Core 不包含在本仓库中。可在应用内（官方 Live2D CDN）或从 Cubism SDK for Web 安装。详见 [docs/compatibility.md](docs/compatibility.md)。

## 下载

成品构建见 [Releases](https://github.com/Lendic42/LumaStage/releases/latest)。

| 文件 | 平台 |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | macOS（安装包） |
| `LumaStage-macOS-0.1.0.zip` | macOS（便携版） |
| `LumaStage-Windows-0.1.0-Setup.exe` | Windows（安装包） |
| `LumaStage-Windows-0.1.0-Portable.exe` | Windows（便携版） |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | iPhone（需自行签名） |
| `LumaStage-0.1.0-source.zip` | 发布源码包 |

### iPhone（Tracker）

IPA **未签名**。请用 Feather、AltStore、Sideloadly 或 TrollStore 以你自己的证书/设备安装。

1. 从 Release 下载 `LumaStage-Tracker-0.1.0-unsigned.ipa`
2. 签名并安装到带 Face ID 的 iPhone
3. 启动 Desktop，用屏幕上的六位码配对
4. 两台设备保持同一 Wi‑Fi

首次连接：桌面端显示代码 → iPhone 确认。之后会保存本地设备令牌。

### Desktop

1. 安装 Release 中的 macOS 或 Windows 构建
2. 首次导入 Live2D 模型时，应用会提示下载 Cubism Core（需同意 Live2D 许可）
3. 导入包含 `*.model3.json` 的文件夹（可带 VTube Studio 的 `*.vtube.json`）
4. 连接 Tracker，或在没有 iPhone 时以中性姿态使用

## 已实现

- 导入 Cubism 3/4/5 与 VTube Studio 元数据（映射、表情、动作、快捷键）
- 追踪校准/平滑，以及 face → Live2D 实时映射编辑
- 场景：背景、模型变换、PNG/JPG/GIF 物件、ArtMesh 固定
- 透明置顶叠加层，便于 OBS 捕获
- 本地 VTS Plugin API（模型、快捷键、物件、物理、后处理等）
- 无云端：仅局域网配对，令牌只存在设备上

完整 API 矩阵与限制见 [docs/compatibility.md](docs/compatibility.md)。架构见 [docs/architecture.md](docs/architecture.md)。

## 开发

需要 Node.js 22+。

```bash
npm install
npm run dev          # desktop
npm test
npm run package:mac  # dmg / zip
npm run package:win  # setup / portable
```

目录结构：

```text
apps/desktop         Electron + React
apps/ios             SwiftUI + ARKit tracker
packages/protocol    追踪协议
packages/vts-api     VTS Plugin API 兼容
packages/scene-core  场景
packages/tracking-core
packages/model-compat
docs/
```

iOS 工程在 `apps/ios`。打 IPA 建议在装有 Xcode 的 Mac 上进行。

## 许可

LumaStage 原创源码为 **GPL-3.0-only**。Live2D Cubism Core、模型与第三方资源遵循各自许可，见 `THIRD_PARTY_NOTICES.md` 与 [docs/compatibility.md](docs/compatibility.md)。
