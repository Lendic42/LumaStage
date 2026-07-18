<p align="center">
  <img src="https://github.com/Lendic42/LumaStage/releases/download/v0.1.0/LumaStage-icon.png" alt="LumaStage" width="128" height="128">
</p>

<h1 align="center">LumaStage</h1>

<p align="center">
  <strong>开源 VTuber 工作室</strong><br>
  Windows / macOS 桌面端 + 带 Face ID 的 iPhone 追踪器
</p>

<p align="center">
  <a href="#-下载"><img src="https://img.shields.io/badge/download-v0.1.0-7c5cff?style=for-the-badge" alt="Download"></a>
  <a href="https://github.com/Lendic42/LumaStage/releases/latest"><img src="https://img.shields.io/github/v/release/Lendic42/LumaStage?style=for-the-badge&color=22c55e" alt="Release"></a>
  <a href="#-许可"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <code>Electron</code> · <code>React</code> · <code>SwiftUI</code> · <code>ARKit</code> · <code>GPL-3.0</code>
</p>

<p align="center">
  <a href="README.md">🇷🇺 Русский</a> ·
  <a href="README.en.md">🇬🇧 English</a> ·
  <a href="README.ja.md">🇯🇵 日本語</a> ·
  🇨🇳 <b>中文</b> ·
  <a href="README.ar.md">🇸🇦 العربية</a> ·
  <a href="README.sr.md">🇷🇸 Српски</a>
</p>

---

## ✨ 这是什么

LumaStage 在舞台上加载 **Live2D 模型**（Cubism 3/4/5 与 VTube Studio 文件夹），并通过局域网接收 **iPhone** 的面部追踪。

- 🚫 无需账号  
- ☁️ 无需云服务  
- 💳 无需订阅  
- 🏠 追踪数据只留在你的本地网络  

---

## 🧩 组成

| | 部分 | 作用 |
| :---: | --- | --- |
| 🖥️ | **Desktop** | 模型渲染、参数映射、场景、快捷键、OBS 叠加层 |
| 📱 | **Tracker** | Face ID iPhone 上的 TrueDepth + ARKit，低延迟，局域网 |
| 📡 | **Protocol** | 开放 TCP / Bonjour — `_lumastage._tcp`，端口 `39510` |
| 🔌 | **VTS API** | VTube Studio Plugin API — `ws://127.0.0.1:8001` |

> ⚠️ 专有的 **Live2D Cubism Core** 不包含在本仓库中。  
> 可在应用内（官方 Live2D CDN）或从 Cubism SDK for Web 安装。  
> 详见 → [docs/compatibility.md](docs/compatibility.md)

---

## 📦 下载

成品构建 → **[Releases](https://github.com/Lendic42/LumaStage/releases/latest)**

| 📁 文件 | 🖥️ 平台 |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | 🍎 macOS · 安装包 |
| `LumaStage-macOS-0.1.0.zip` | 🍎 macOS · 便携版 |
| `LumaStage-Windows-0.1.0-Setup.exe` | 🪟 Windows · 安装包 |
| `LumaStage-Windows-0.1.0-Portable.exe` | 🪟 Windows · 便携版 |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | 📱 iPhone · 需自行签名 |
| `LumaStage-0.1.0-source.zip` | 🧬 发布源码包 |

### 📱 iPhone（Tracker）

IPA **未签名**。请用 Feather / AltStore / Sideloadly / TrollStore 以你自己的证书安装。

1. ⬇️ 从 Release 下载 `LumaStage-Tracker-0.1.0-unsigned.ipa`  
2. ✍️ 签名并安装到带 Face ID 的 iPhone  
3. 🖥️ 启动 Desktop，用屏幕上的 **六位码** 配对  
4. 📶 两台设备保持同一 Wi‑Fi  

> 🔑 首次连接：桌面端显示代码 → iPhone 确认。  
> 之后会保存本地设备令牌。

### 🖥️ Desktop

1. ⬇️ 安装 Release 中的 macOS / Windows 构建  
2. 📥 首次导入模型时下载 Cubism Core（需同意 Live2D 许可）  
3. 📂 导入包含 `*.model3.json` 的文件夹（可带 VTS 的 `*.vtube.json`）  
4. 📱 连接 Tracker **或** 在没有 iPhone 时以中性姿态使用  

---

## ✅ 已实现

| | 功能 |
| :---: | --- |
| 🎭 | 导入 Cubism 3/4/5 与 VTube Studio 元数据（映射、表情、动作、快捷键） |
| 🎚️ | 追踪校准 / 平滑，face → Live2D 实时映射编辑 |
| 🎬 | 场景：背景、模型变换、PNG / JPG / GIF 物件、ArtMesh 固定 |
| 📹 | 透明置顶叠加层，便于 OBS 捕获 |
| 🧩 | 本地 VTS Plugin API（模型、快捷键、物件、物理、后处理…） |
| 🔒 | 无云端：仅局域网配对，令牌只存在设备上 |

📖 完整 API 矩阵 → [docs/compatibility.md](docs/compatibility.md)  
🏗️ 架构 → [docs/architecture.md](docs/architecture.md)

---

## 🛠️ 开发

需要 **Node.js 22+**。

```bash
npm install
npm run dev          # desktop
npm test
npm run package:mac  # dmg / zip
npm run package:win  # setup / portable
```

### 📁 目录结构

```text
apps/desktop           # 🖥️ Electron + React
apps/ios               # 📱 SwiftUI + ARKit tracker
packages/protocol      # 📡 追踪协议
packages/vts-api       # 🔌 VTS Plugin API 兼容
packages/scene-core    # 🎬 场景
packages/tracking-core
packages/model-compat
docs/                  # 📖 docs
```

iOS 工程在 `apps/ios`。打 IPA 建议在装有 Xcode 的 Mac 上进行。

---

## 📄 许可

LumaStage 原创源码为 **GPL-3.0-only**。

Live2D Cubism Core、模型与第三方资源遵循各自许可。  
见 `THIRD_PARTY_NOTICES.md` 与 [docs/compatibility.md](docs/compatibility.md)。

---

## ⭐ Star History

<a href="https://star-history.com/#Lendic42/LumaStage&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Lendic42/LumaStage&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Lendic42/LumaStage&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Lendic42/LumaStage&type=Date" />
  </picture>
</a>

<p align="center">
  Made with 💜 for VTubers · <a href="https://github.com/Lendic42/LumaStage/releases/latest">Download v0.1.0</a>
</p>
