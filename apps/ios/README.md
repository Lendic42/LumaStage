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
