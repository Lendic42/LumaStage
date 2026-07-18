<p align="center">
  <img src="https://github.com/Lendic42/LumaStage/releases/download/v0.1.0/LumaStage-icon.png" alt="LumaStage" width="128" height="128">
</p>

<h1 align="center">LumaStage</h1>

<p align="center">
  <strong>Open-source VTuber studio</strong><br>
  Desktop for Windows / macOS + Face ID iPhone tracker
</p>

<p align="center">
  <a href="#-download"><img src="https://img.shields.io/badge/download-v0.1.0-7c5cff?style=for-the-badge" alt="Download"></a>
  <a href="https://github.com/Lendic42/LumaStage/releases/latest"><img src="https://img.shields.io/github/v/release/Lendic42/LumaStage?style=for-the-badge&color=22c55e" alt="Release"></a>
  <a href="#-license"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <code>Electron</code> · <code>React</code> · <code>SwiftUI</code> · <code>ARKit</code> · <code>GPL-3.0</code>
</p>

<p align="center">
  <a href="README.md">🇷🇺 Русский</a> ·
  🇬🇧 <b>English</b> ·
  <a href="README.ja.md">🇯🇵 日本語</a> ·
  <a href="README.zh.md">🇨🇳 中文</a> ·
  <a href="README.ar.md">🇸🇦 العربية</a> ·
  <a href="README.sr.md">🇷🇸 Српски</a>
</p>

---

## ✨ What is it

LumaStage puts **Live2D models** on stage (Cubism 3/4/5 and VTube Studio folders) and tracks your face from an **iPhone** over the local network.

- 🚫 no account  
- ☁️ no cloud  
- 💳 no subscription  
- 🏠 tracking stays on your LAN  

---

## 🧩 What's inside

| | Part | What it does |
| :---: | --- | --- |
| 🖥️ | **Desktop** | Model render, mapping, scenes, hotkeys, OBS overlay |
| 📱 | **Tracker** | TrueDepth + ARKit on Face ID iPhones, low latency, LAN |
| 📡 | **Protocol** | Open TCP / Bonjour — `_lumastage._tcp`, port `39510` |
| 🔌 | **VTS API** | VTube Studio Plugin API on `ws://127.0.0.1:8001` |

> ⚠️ Proprietary **Live2D Cubism Core** is not shipped in this repo.  
> Install from the app (official Live2D CDN) or from the Cubism SDK for Web.  
> Details → [docs/compatibility.md](docs/compatibility.md)

---

## 📦 Download

Builds → **[Releases](https://github.com/Lendic42/LumaStage/releases/latest)**

| 📁 File | 🖥️ Platform |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | 🍎 macOS · installer |
| `LumaStage-macOS-0.1.0.zip` | 🍎 macOS · portable |
| `LumaStage-Windows-0.1.0-Setup.exe` | 🪟 Windows · installer |
| `LumaStage-Windows-0.1.0-Portable.exe` | 🪟 Windows · portable |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | 📱 iPhone · you sign it |
| `LumaStage-0.1.0-source.zip` | 🧬 release sources |

### 📱 iPhone (Tracker)

The IPA is **unsigned**. Install with Feather / AltStore / Sideloadly / TrollStore using your own certificate.

1. ⬇️ Download `LumaStage-Tracker-0.1.0-unsigned.ipa` from the release  
2. ✍️ Sign and install on a Face ID iPhone  
3. 🖥️ Start Desktop and pair with the **6-digit code**  
4. 📶 Keep both devices on the same Wi‑Fi  

> 🔑 First connection: code on desktop → confirm on iPhone.  
> After that a local device token is stored.

### 🖥️ Desktop

1. ⬇️ Install the macOS / Windows build from the release  
2. 📥 On first model import — download Cubism Core (Live2D license required)  
3. 📂 Import a folder with `*.model3.json` (optional `*.vtube.json` from VTS)  
4. 📱 Connect the Tracker **or** run in neutral pose without an iPhone  

---

## ✅ What's included

| | Feature |
| :---: | --- |
| 🎭 | Cubism 3/4/5 import + VTube Studio metadata (mappings, expressions, motions, hotkeys) |
| 🎚️ | Tracking calibration / smoothing, live face → Live2D mapping editor |
| 🎬 | Scenes: background, model transform, PNG / JPG / GIF items, ArtMesh pin |
| 📹 | Transparent always-on-top overlay for OBS capture |
| 🧩 | Local VTS Plugin API (models, hotkeys, items, physics, post-processing…) |
| 🔒 | No cloud: LAN-only pairing, tokens stay on devices |

📖 Full API matrix → [docs/compatibility.md](docs/compatibility.md)  
🏗️ Architecture → [docs/architecture.md](docs/architecture.md)

---

## 🛠️ Development

Requires **Node.js 22+**.

```bash
npm install
npm run dev          # desktop
npm test
npm run package:mac  # dmg / zip
npm run package:win  # setup / portable
```

### 📁 Layout

```text
apps/desktop           # 🖥️ Electron + React
apps/ios               # 📱 SwiftUI + ARKit tracker
packages/protocol      # 📡 tracking protocol
packages/vts-api       # 🔌 VTS Plugin API compatibility
packages/scene-core    # 🎬 scenes
packages/tracking-core
packages/model-compat
docs/                  # 📖 docs
```

iOS project: `apps/ios`. Building the IPA is easiest on a Mac with Xcode.

---

## 📄 License

LumaStage original source is **GPL-3.0-only**.

Live2D Cubism Core, models, and third-party assets keep their own licenses.  
See `THIRD_PARTY_NOTICES.md` and [docs/compatibility.md](docs/compatibility.md).

---

## ⭐ Star History

[![Star History Chart](./star-history.png)](https://www.star-history.com/#LumaStage&Date)

<p align="center">
  Made with 💜 for VTubers · <a href="https://github.com/Lendic42/LumaStage/releases/latest">Download v0.1.0</a>
</p>
