#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
IOS_DIR=${SCRIPT_DIR:h}
REPO_DIR=${IOS_DIR:h:h}
DERIVED_DIR="$REPO_DIR/work/ios-derived"
EXPORT_DIR="$REPO_DIR/outputs"
APP_PATH="$DERIVED_DIR/Build/Products/Release-iphoneos/LumaStage Tracker.app"
IPA_PATH="$EXPORT_DIR/LumaStage-Tracker-0.1.0-unsigned.ipa"
PAYLOAD_DIR=$(mktemp -d)/Payload

mkdir -p "$EXPORT_DIR"
cd "$IOS_DIR"
xcodegen generate --spec project.yml
xcodebuild \
  -project LumaStageTracker.xcodeproj \
  -scheme LumaStageTracker \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DIR" \
  CODE_SIGNING_ALLOWED=NO \
  -quiet \
  build

mkdir -p "$PAYLOAD_DIR"
ditto "$APP_PATH" "$PAYLOAD_DIR/LumaStage Tracker.app"
codesign --force --sign - "$PAYLOAD_DIR/LumaStage Tracker.app"
cd "${PAYLOAD_DIR:h}"
/usr/bin/zip -qry "$IPA_PATH" Payload
unzip -t "$IPA_PATH"
codesign --verify --deep --strict "$PAYLOAD_DIR/LumaStage Tracker.app"
echo "$IPA_PATH"
