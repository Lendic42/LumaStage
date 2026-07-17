# LumaStage

LumaStage is a free and open-source VTuber studio built around two apps:

- **LumaStage Desktop** for Windows and macOS: model rendering, parameter mapping, scenes, hotkeys and OBS output.
- **LumaStage Tracker** for Face ID iPhones: private, low-latency TrueDepth face tracking over the local network.

The project is under active development. The current milestone includes the complete ARKit-to-desktop tracking path, safe Cubism/VTube Studio model import, a Pixi WebGL renderer adapter, calibration/smoothing and cross-platform packaging.

## Principles

- No account, cloud relay or subscription.
- Tracking data stays on the local network.
- Open protocol and open application source.
- Import existing Cubism 3/4/5 `*.model3.json` model folders and preserve VTube Studio metadata where possible.
- The proprietary Live2D Cubism Core is never represented as open-source code. See [compatibility and licensing](docs/compatibility.md).

## Repository

```text
apps/desktop       Electron + React desktop application
apps/ios           Native SwiftUI + ARKit tracker
packages/protocol  Versioned tracking protocol and validation
docs               Architecture and compatibility notes
```

## Desktop development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

The desktop listens on TCP port `39510` and advertises `_lumastage._tcp` through Bonjour. You can run it without an iPhone; the stage stays in its neutral pose.

## Enable Cubism rendering

LumaStage does not redistribute the proprietary Live2D Cubism Core. Download the official **Cubism SDK for Web** from Live2D after reading and accepting its terms. In LumaStage, choose **Install official Cubism Core** and select `live2dcubismcore.min.js` from that SDK. The file is copied into the application's private user-data directory and is never committed to this repository.

After that, import a folder containing one `*.model3.json`. LumaStage serves model assets through a sandboxed read-only protocol, renders physics/pose/expressions/motions through the Cubism adapter and applies either:

- mappings from the matching `*.vtube.json`, including custom Live2D parameter IDs; or
- standard Cubism parameter IDs when no VTube Studio setup exists.

The importer rejects absolute/path-traversal asset references and reports missing files before rendering.

## Build distributable desktop apps

```bash
npm run package:mac
npm run package:win
```

Windows packaging runs on a Windows host; the repository CI builds both Windows and macOS artifacts.

## License

LumaStage's original source code is licensed under GPL-3.0-only. Live2D Cubism Core, Live2D model assets and third-party models have their own licenses and are not covered by this repository's license. See `THIRD_PARTY_NOTICES.md` for bundled open-source libraries.
