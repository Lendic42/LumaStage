# LumaStage Tracker for iPhone

The tracker is a native SwiftUI application and does not use third-party dependencies. It requires a TrueDepth-capable iPhone/iPad because ARKit face tracking is not available in the simulator or on devices without the Face ID camera system.

## Generate and build

Install [XcodeGen](https://github.com/yonaskolb/XcodeGen), then:

```bash
cd apps/ios
xcodegen generate
xcodebuild -project LumaStageTracker.xcodeproj -scheme LumaStageTracker \
  -configuration Release -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

For direct Xcode sideloading, open the generated project, select your free or paid Apple development team, change the bundle identifier if necessary, connect the iPhone and press Run.

For a re-signing sideload tool such as AltStore or Feather, build the ad-hoc packaged IPA:

```bash
chmod +x scripts/build-unsigned-ipa.sh
scripts/build-unsigned-ipa.sh
```

The resulting `outputs/LumaStage-Tracker-0.1.0-unsigned.ipa` intentionally contains no personal Apple certificate or provisioning profile. The sideload tool signs it with the user's own identity during installation.

## Connect

### Auto-discovery (Bonjour)

Keep the iPhone and desktop on the same local network. Start LumaStage Desktop, enter its six-digit pairing code in the tracker, then choose the discovered desktop.

### Manual IP / port

If the desktop does not appear (common on **Windows**, guest Wi‑Fi, AP isolation, or missing Bonjour), open **Manual IP & port** in the tracker:

1. On Desktop, copy a host from the **Connect Tracker** panel (for example `192.168.1.42:39510`).
2. Enter the IP, port (default `39510`), and the 6-digit pairing code.
3. Tap **Connect**.

### Wired (USB)

1. Connect iPhone to the PC with a USB cable.
2. Enable **Personal Hotspot** on the iPhone and allow USB tethering (Windows may install the Apple network adapter).
3. On Desktop, note the new host IP shown under Connect Tracker (often a `172.x` address on the USB adapter).
4. In the tracker, use **Manual IP & port** with that PC address and the pairing code.

The tracker stores the returned random device token in the iOS Keychain as a device-only credential, so later connections do not require the code unless desktop trust data is removed.
