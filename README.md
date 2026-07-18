# LumaStage

LumaStage is a free and open-source VTuber studio built around two apps:

- **LumaStage Desktop** for Windows and macOS: model rendering, parameter mapping, scenes, hotkeys and OBS output.
- **LumaStage Tracker** for Face ID iPhones: private, low-latency TrueDepth face tracking over the local network.

The project is under active development. The current milestone includes the complete ARKit-to-desktop tracking path, safe Cubism/VTube Studio model import, a Pixi WebGL renderer adapter, calibration/smoothing, persistent scenes and cross-platform packaging.

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
packages/scene-core  Validated, versioned scene persistence
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

LumaStage does not redistribute the proprietary Live2D Cubism Core. When Core is missing, the model panel shows **Install Cubism Core automatically**. After explicit license confirmation, LumaStage downloads only `live2dcubismcore.min.js` from Live2D's official `cubism.live2d.com` host, validates it and stores it in the application's private user-data directory. If the official download is unavailable, the same flow can open Live2D's SDK page or install the file from a previously downloaded **Cubism SDK for Web** package. The proprietary file is never committed to this repository.

After that, import a folder containing one `*.model3.json`. LumaStage serves model assets through a sandboxed read-only protocol, renders physics/pose/expressions/motions through the Cubism adapter and applies either:

- mappings from the matching `*.vtube.json`, including custom Live2D parameter IDs; or
- standard Cubism parameter IDs when no VTube Studio setup exists.

The importer rejects absolute/path-traversal asset references and reports missing files before rendering.

The **Edit tracking mappings** dialog shows every imported face-input → Live2D-output route and its live value. You can edit input/output ranges, smoothing and clamping, add/remove mappings, or capture the natural minimum/maximum of a connected iPhone signal by moving that part of your face. Overrides are validated and stored per model; **Reset imported** restores the untouched `*.vtube.json` configuration.

The stage toolbar includes a transparent always-on-top overlay for OBS/window capture. Imported VTube Studio expression and motion hotkeys are shown in the inspector with their original trigger keys. Standalone animations referenced only by `*.vtube.json` are loaded from the model's `motions/` folder through a runtime-only manifest view; actions that cannot be mapped safely are reported instead of guessed.

## Scenes

Desktop scene presets persist the selected model, background and model transform. A scene can use a built-in gradient, solid color or local PNG/JPEG/WebP/GIF image, plus scale, X/Y offset, rotation and mirroring. Background files are exposed to the sandboxed renderer through a read-only protocol scoped to the active file; arbitrary filesystem paths cannot be requested from the UI.

Scenes also support visual PNG/JPG/GIF items. Items can render behind or in front of the model, and the inspector controls position, size, rotation, opacity, flip and lock state. The item file catalog persists independently from scene instances, so plugins can unload an item and load the same file later.

## VTube Studio Plugin API compatibility

LumaStage exposes a localhost-only compatibility server at `ws://127.0.0.1:8001`. Plugins must request access through the normal VTube Studio authentication messages; LumaStage shows a per-plugin approval dialog, stores only a token hash and provides a revoke button. The current tested subset includes:

- `APIStateRequest`, `AuthenticationTokenRequest` and `AuthenticationRequest`;
- `StatisticsRequest`, `CurrentModelRequest` and `FaceFoundRequest`;
- `AvailableModelsRequest` and `ModelLoadRequest`, including unloading with an empty model ID. Imported models remain in a private persistent library even when no scene currently uses them.
- `MoveModelRequest` with absolute/relative transforms, the official ranges and timed renderer interpolation;
- `ArtMeshListRequest` and `ColorTintRequest`, using drawable IDs reported by the loaded Cubism model, case-insensitive name/tag matchers and session cleanup;
- `GetCurrentModelPhysicsRequest` and temporary, single-plugin `SetCurrentModelPhysicsRequest` base/group overrides with expiry and disconnect cleanup;
- `HotkeysInCurrentModelRequest` and `HotkeyTriggerRequest` for imported expression/motion hotkeys;
- `ExpressionStateRequest` and `ExpressionActivationRequest`, including expression parameter details parsed from `*.exp3.json`;
- `InputParameterListRequest`, `ParameterValueRequest`, `Live2DParameterListRequest` and one-second `InjectParameterDataRequest` overrides with `set`/`add` modes and weights.
- session-scoped `EventSubscriptionRequest` for test, model load, tracking status, background, model config/movement, hotkey and item events. LumaStage emits live tracking, scene, transform and API-hotkey events rather than requiring polling.
- plugin-owned `ParameterCreationRequest`/`ParameterDeletionRequest`, with the official naming/range limits, per-plugin ownership, persistent storage and cleanup when plugin access is revoked.
- visual `ItemListRequest`, `ItemLoadRequest`, `ItemMoveRequest`, `ItemUnloadRequest` and `ItemPinRequest`. Pins support official Provided/Center/Random modes and follow deformed ArtMesh triangles through barycentric coordinates; API changes update the live canvas and scene editor immediately, emit `ItemEvent`, and honor `unloadWhenPluginDisconnects`.

Unsupported request types return the official `APIError` shape instead of silently succeeding. See the compatibility matrix for the remaining API surface.

## Build distributable desktop apps

```bash
npm run package:mac
npm run package:win
```

Electron Builder can cross-package Windows x64 from macOS; the repository CI also builds on native Windows and macOS runners. Runtime validation should still be performed on each target OS before publishing a release.

## License

LumaStage's original source code is licensed under GPL-3.0-only. Live2D Cubism Core, Live2D model assets and third-party models have their own licenses and are not covered by this repository's license. See `THIRD_PARTY_NOTICES.md` for bundled open-source libraries.
