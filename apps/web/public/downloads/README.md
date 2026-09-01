# APKs served from the site

These are the files `/download` links to. They are **release builds, signed
with the real FixBridge key** — not debug builds. Rebuild them with:

    cd apps/mobile   && flutter build apk --release --target-platform android-arm,android-arm64
    cd apps/partner  && flutter build apk --release --target-platform android-arm,android-arm64

then copy `build/app/outputs/flutter-apk/app-release.apk` over
`fixbridge.apk` and `fixbridge-partner.apk` respectively.

## Why those flags

**One file, not three.** `--split-per-abi` produces a smaller APK per
architecture, which is right for the Play Store because the store picks the
matching one. Downloading from a web page, nothing picks: the customer would
have to know whether their phone is arm64 or armeabi-v7a, and choosing wrong
means an install that fails with no useful message. One universal file always
installs.

**ARM only.** `--target-platform android-arm,android-arm64` drops x86_64,
which takes the build from ~56 MB to ~36 MB. x86 Android exists essentially
only in emulators; no phone anyone in Jabalpur owns needs it, and 20 MB of
mobile data is a real cost to the person downloading.

## Signing — the part that cannot be got wrong

The keystore lives at `C:\Users\HP\fixbridge-keys\fixbridge-release.p12`,
deliberately **outside this repository** so no `git add -A` can sweep it in.
Each app points at it through `android/key.properties`, which is gitignored.

**Back that file up somewhere you cannot lose it.** Android refuses to install
an update over an app signed with a different key. If the keystore is lost,
every existing user has to uninstall and reinstall — losing their session — and
there is no way to recover it. It is the single most important file in this
project.

Verify what a built APK is actually signed with before publishing:

    apksigner verify --print-certs fixbridge.apk

It must print `CN=FixBridge, OU=Engineering, O=FixBridge, L=Jabalpur, ...`.
If it prints `CN=Android Debug` then `key.properties` was not found and the
build fell back to the debug key — that APK cannot be published, because
nobody could ever install an update over it.

## Publishing a new version

Four steps, and skipping either of the last two breaks the update prompt:

1. Raise `version:` in the app's `pubspec.yaml` (e.g. `0.1.0+1` → `0.2.0+2`).
2. Build and copy the APK here, as above.
3. Raise `APP_CUSTOMER_LATEST_VERSION` / `APP_PARTNER_LATEST_VERSION` in the
   API's environment. This is what the in-app update check compares against —
   publishing an APK without raising it tells nobody, and raising it without
   publishing sends everybody to a file that has not changed.
4. Only if an old build would genuinely misread the API — a changed money
   field, a removed status — also raise `APP_*_MIN_VERSION`. That forces every
   older install to a blocking update screen, so it is not for ordinary
   releases.

## Note on git

The `.apk` files here are gitignored: ~36 MB each and rebuilt every release,
which is not what git is for. Whatever serves this directory in production
needs them copied in as part of the deploy.
