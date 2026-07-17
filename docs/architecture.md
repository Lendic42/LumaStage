# Architecture

## Product boundary

LumaStage is split so the camera-facing device does only capture and tracking. The desktop owns model files, mappings, rendering, recording integrations and user settings.

```text
TrueDepth camera -> ARKit blend shapes -> LumaLink v1 -> mapping/smoothing -> model parameters -> renderer/OBS
```

No video frames leave the iPhone. A frame contains head pose, gaze and numeric expression coefficients only.

## Desktop

Electron provides one Windows/macOS UI and a Chromium WebGL surface. The main process owns local discovery, WebSocket sessions, model filesystem access and future virtual-camera/NDI integrations. The sandboxed renderer receives validated frames through a narrow preload bridge.

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

The current milestone implements discovery, framed transport and persistent pairing. LumaLink v1 is local-network WebSocket rather than TLS, so a future public release should add encrypted transport and a trusted-device revocation UI for hostile/shared LANs.

## Frame processing

Desktop processing is deterministic and ordered:

1. Validate protocol shape and reject oversized/unknown messages.
2. Drop frames older than the last accepted sequence.
3. Normalize device orientation and calibrated neutral pose.
4. Apply per-channel dead zones and asymmetric smoothing.
5. Evaluate user-editable input-to-parameter mappings.
6. Apply idle/lost-tracking decay and send values to the renderer.

Gaze values are normalized to `[-1, 1]`; ARKit blend-shape coefficients are constrained to `[0, 1]`. Sequence monotonicity is session state and is enforced by the receiver rather than by the per-message schema.
