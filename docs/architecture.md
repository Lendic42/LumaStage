# Architecture

## Product boundary

LumaStage is split so the camera-facing device does only capture and tracking. The desktop owns model files, mappings, rendering, recording integrations and user settings.

```text
TrueDepth camera -> ARKit blend shapes -> LumaLink v1 -> mapping/smoothing -> model parameters -> renderer/OBS
```

No video frames leave the iPhone. A frame contains head pose, gaze and numeric expression coefficients only.

## Desktop

Electron provides one Windows/macOS UI and a Chromium WebGL surface. The main process owns local discovery, WebSocket sessions, model filesystem access and future virtual-camera/NDI integrations. The sandboxed renderer receives validated frames through a narrow preload bridge.

The VTube Studio-compatible plugin API is a second WebSocket server bound only to `127.0.0.1:8001`. Its request/response core is isolated in `packages/vts-api` and tested independently. Authentication tokens are shown only once to an approved plugin; LumaStage persists SHA-256 hashes, requires a visible per-plugin approval and can revoke all plugin sessions from the UI.

Event subscriptions are stored on each authenticated WebSocket session and disappear when it disconnects. The desktop publishes tracking-state, model, scene-background, model-transform and API-hotkey changes through the official event envelope; filters are evaluated before serialization to a client.

Custom tracking parameters are owned by the plugin name/developer identity, persisted separately from authentication tokens and removed when plugin access is revoked. Private ownership keys are never returned in API parameter lists.

Scene documents are validated by the isolated `packages/scene-core` package and persisted as a versioned JSON library in the application's user-data directory. Only the main process sees model/background paths. The renderer receives display metadata and fixed custom-protocol URLs for the active assets.

Visual scene items use the same boundary: absolute item paths remain in main-process persistence while the renderer receives a fixed `lumastage-item://active/<instance-id>` URL. A separate item-file catalog survives unloading scene instances. Local UI and VTube Studio API operations mutate the same validated item state and main broadcasts workspace changes to every renderer window.

User-tuned tracking mappings are stored separately from model assets. The main process validates bounded finite mapping records, keys each override by the SHA-256 digest of the resolved model directory and serializes updates through a write queue. The renderer receives only the active mapping list; resetting removes the override and reuses the original parsed `*.vtube.json` mappings without modifying the model folder.

Imported model directories also live in a private main-process library independent of scenes. `AvailableModelsRequest` reads validated metadata from that library, while `ModelLoadRequest` attaches the selected model to the active scene (or clears it for an empty ID), broadcasts the new workspace and emits model events. Expression state remains in main and activation is forwarded to the renderer through a narrow typed IPC event.

The renderer boundary is an adapter rather than a direct dependency on one model engine:

- `CubismRenderer`: existing `.moc3`/`.model3.json` models through an installed Cubism Core.
- Future open engines may implement the same interface without changing tracking, scenes or UI.

## iPhone

The tracker uses `ARFaceTrackingConfiguration`, so it requires an iPhone or iPad with a TrueDepth front camera. `ARFaceAnchor` supplies head transform, eye transforms and ARKit blend-shape coefficients. Network discovery uses Bonjour and transport uses a local WebSocket.

## LumaLink v1

Every message is UTF-8 JSON. The initial handshake identifies protocol and app versions. Tracking frames are lossy by design: newer frames supersede older frames, and the desktop must never build an unbounded queue.

Security model:

1. Desktop advertises only on the local network.
2. First connection requires approval/pairing.
3. A remembered device receives a random 256-bit token; the desktop persists only its SHA-256 hash and iOS stores the token in the device-only Keychain.
4. Raw camera images are never transmitted.

The current milestone implements discovery, framed transport, persistent pairing and revocation. LumaLink v1 is local-network WebSocket rather than TLS, so a future public release should add encrypted transport for hostile/shared LANs.

## Frame processing

Desktop processing is deterministic and ordered:

1. Validate protocol shape and reject oversized/unknown messages.
2. Drop frames older than the last accepted sequence.
3. Normalize device orientation and calibrated neutral pose.
4. Apply per-channel dead zones and asymmetric smoothing.
5. Evaluate user-editable input-to-parameter mappings.
6. Apply idle/lost-tracking decay and send values to the renderer.

Gaze values are normalized to `[-1, 1]`; ARKit blend-shape coefficients are constrained to `[0, 1]`. Sequence monotonicity is session state and is enforced by the receiver rather than by the per-message schema.
