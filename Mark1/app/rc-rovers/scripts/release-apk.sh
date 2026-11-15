#!/usr/bin/env bash
# Build a release-ready RC-Rovers APK and check it can install as an UPDATE.
# Android only updates in place when (1) the signing certificate is identical to
# the installed app's and (2) versionCode is higher. This script refuses to
# produce an APK that breaks either rule.
#   npm run release:apk   →  android/app/build/release/RC-Rovers.apk (+ versioned copy)
set -euo pipefail
cd "$(dirname "$0")/.."

# Certificate every RC-Rovers release since 1.0.0 is signed with.
EXPECTED_CERT="cb547c7fa2ec0113d76ea13dab4eaeb5ea6491a1d795d2586d33afd010295d78"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export PATH="$JAVA_HOME/bin:$PATH"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"

VERSION=$(node -p "require('./package.json').version")
grep -q "APP_VERSION = '$VERSION'" src/rover/protocol.ts || { echo "✗ APP_VERSION in src/rover/protocol.ts is not $VERSION"; exit 1; }
grep -q "versionName \"$VERSION\"" android/app/build.gradle || { echo "✗ versionName in android/app/build.gradle is not $VERSION"; exit 1; }
CODE=$(sed -n 's/.*versionCode \([0-9]*\).*/\1/p' android/app/build.gradle)

# versionCode must beat the latest published release
LAST=$(gh release list -R thrishankkuntimaddi/my-rovers --limit 20 --json tagName -q '.[].tagName' 2>/dev/null | grep '^rc-rovers-v' | head -1 || true)
if [ -n "$LAST" ]; then
  TMP=$(mktemp -d)
  if gh release download "$LAST" -R thrishankkuntimaddi/my-rovers -p RC-Rovers.apk -D "$TMP" >/dev/null 2>&1; then
    PREV=$("$BT/aapt2" dump badging "$TMP/RC-Rovers.apk" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p")
    [ "$CODE" -gt "$PREV" ] || { echo "✗ versionCode $CODE must be higher than $LAST ($PREV)"; exit 1; }
    echo "✓ versionCode $CODE > $PREV ($LAST)"
  fi
  rm -rf "$TMP"
fi

npm run android:apk
APK=android/app/build/outputs/apk/debug/app-debug.apk

CERT=$("$BT/apksigner" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
if [ "$CERT" != "$EXPECTED_CERT" ]; then
  echo "✗ APK is signed with a DIFFERENT key ($CERT)."
  echo "  It would not install over existing copies. Restore ~/.android/debug.keystore from your backup."
  exit 1
fi
echo "✓ signed with the RC-Rovers key"

OUT=android/app/build/release
mkdir -p "$OUT"
cp "$APK" "$OUT/RC-Rovers.apk"
cp "$APK" "$OUT/RC-Rovers-$VERSION.apk"
echo "✓ $OUT/RC-Rovers.apk  ($VERSION, versionCode $CODE)"
