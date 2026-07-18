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
packages/vts-api   Tested VTube Studio Plugin API compatibility core
docs               Architecture and compatibility notes
```

## Desktop development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

The desktop listens on TCP port `39510` and advertises `_lumastage._tcp` through Bonjour. The first iPhone connection requires the six-digit code displayed by the desktop; successful pairing creates a random per-device token stored locally on both devices. You can run it without an iPhone; the stage stays in its neutral pose.

## Enable Cubism rendering

LumaStage does not redistribute the proprietary Live2D Cubism Core. Download the official **Cubism SDK for Web** from Live2D after reading and accepting its terms. In LumaStage, choose **Install official Cubism Core** and select `live2dcubismcore.min.js` from that SDK. The file is copied into the application's private user-data directory and is never committed to this repository.

After that, import a folder containing one `*.model3.json`. LumaStage serves model assets through a sandboxed read-only protocol, renders physics/pose/expressions/motions through the Cubism adapter and applies either:

- mappings from the matching `*.vtube.json`, including custom Live2D parameter IDs; or
- standard Cubism parameter IDs when no VTube Studio setup exists.

The importer rejects absolute/path-traversal asset references and reports missing files before rendering.

The stage toolbar includes a transparent always-on-top overlay for OBS/window capture. Imported VTube Studio expression and motion hotkeys are shown in the inspector; actions that cannot be mapped safely are reported instead of guessed.

## VTube Studio Plugin API compatibility

LumaStage exposes a localhost-only compatibility server at `ws://127.0.0.1:8001`. Plugins must request access through the normal VTube Studio authentication messages; LumaStage shows a per-plugin approval dialog, stores only a token hash and provides a revoke button. The current tested subset includes:

- `APIStateRequest`, `AuthenticationTokenRequest` and `AuthenticationRequest`;
- `StatisticsRequest`, `CurrentModelRequest` and `FaceFoundRequest`;
- `HotkeysInCurrentModelRequest` and `HotkeyTriggerRequest` for imported expression/motion hotkeys.
- `InputParameterListRequest`, `ParameterValueRequest`, `Live2DParameterListRequest` and one-second `InjectParameterDataRequest` overrides with `set`/`add` modes and weights.

Unsupported request types return the official `APIError` shape instead of silently succeeding. See the compatibility matrix for the remaining API surface.

## Build distributable desktop apps

```bash
npm run package:mac
npm run package:win
```

Electron Builder can cross-package Windows x64 from macOS; the repository CI also builds on native Windows and macOS runners. Runtime validation should still be performed on each target OS before publishing a release.

## License

LumaStage's original source code is licensed under GPL-3.0-only. Live2D Cubism Core, Live2D model assets and third-party models have their own licenses and are not covered by this repository's license. See `THIRD_PARTY_NOTICES.md` for bundled open-source libraries.
