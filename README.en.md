**Languages:** [Русский](README.md) · **English** · [日本語](README.ja.md) · [中文](README.zh.md) · [العربية](README.ar.md) · [Српски](README.sr.md)

# LumaStage

**Open-source VTuber studio: desktop for Windows/macOS + Face ID iPhone tracker.**

`Electron` · `React` · `SwiftUI` · `ARKit` · `GPL-3.0`

LumaStage puts Live2D models on stage (Cubism 3/4/5 and VTube Studio folders) and tracks your face from an iPhone over the local network — no account, no cloud, no subscription. Tracking stays on your LAN.

| Part | What it does |
| --- | --- |
| **Desktop** | Model render, parameter mapping, scenes, hotkeys, OBS overlay |
| **Tracker** | TrueDepth + ARKit on Face ID iPhones, low latency, local network |
| **Protocol** | Open TCP/Bonjour protocol (`_lumastage._tcp`, port `39510`) |
| **VTS API** | VTube Studio Plugin API compatibility on `ws://127.0.0.1:8001` |

> Proprietary Live2D Cubism Core is not shipped in this repo. Install it from the app (official Live2D CDN) or from the Cubism SDK for Web. Details: [docs/compatibility.md](docs/compatibility.md).

## Download

Builds are in [Releases](https://github.com/Lendic42/LumaStage/releases/latest).

| File | Platform |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | macOS (installer) |
| `LumaStage-macOS-0.1.0.zip` | macOS (portable) |
| `LumaStage-Windows-0.1.0-Setup.exe` | Windows (installer) |
| `LumaStage-Windows-0.1.0-Portable.exe` | Windows (portable) |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | iPhone (you sign it) |
| `LumaStage-0.1.0-source.zip` | release sources |

### iPhone (Tracker)

The IPA is **unsigned**. Install with Feather, AltStore, Sideloadly, or TrollStore using your own certificate / device.

1. Download `LumaStage-Tracker-0.1.0-unsigned.ipa` from the release.
2. Sign and install on a Face ID iPhone.
3. Start Desktop and pair with the six-digit code on screen.
4. Keep both devices on the same Wi‑Fi network.

First connection: code on desktop → confirm on iPhone. After that a local device token is stored.

### Desktop

1. Install the macOS or Windows build from the release.
2. On first Live2D model import the app offers Cubism Core download (Live2D license acceptance required).
3. Import a folder with `*.model3.json` (optional `*.vtube.json` from VTube Studio).
4. Connect the Tracker, or run in neutral pose without an iPhone.

## What's included

- Cubism 3/4/5 import and VTube Studio metadata (mappings, expressions, motions, hotkeys)
- Tracking calibration/smoothing and a live face → Live2D mapping editor
- Scenes: background, model transform, PNG/JPG/GIF items, ArtMesh pin
- Transparent always-on-top overlay for OBS capture
- Local VTS Plugin API (models, hotkeys, items, physics, post-processing, and more)
- No cloud: pairing is LAN-only, tokens stay on the devices

Full API matrix and limits: [docs/compatibility.md](docs/compatibility.md). Architecture: [docs/architecture.md](docs/architecture.md).

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev          # desktop
npm test
npm run package:mac  # dmg / zip
npm run package:win  # setup / portable
```

Layout:

```text
apps/desktop         Electron + React
apps/ios             SwiftUI + ARKit tracker
packages/protocol    tracking protocol
packages/vts-api     VTS Plugin API compatibility
packages/scene-core  scenes
packages/tracking-core
packages/model-compat
docs/
```

iOS project: `apps/ios`. Building the IPA is easiest on a Mac with Xcode.

## License

LumaStage original source is **GPL-3.0-only**. Live2D Cubism Core, models, and third-party assets keep their own licenses — see `THIRD_PARTY_NOTICES.md` and [docs/compatibility.md](docs/compatibility.md).
