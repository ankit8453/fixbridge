# APKs

**These files are not served from here.** `/download` links to GitHub
Releases instead — see "Publishing" below. Anything in this directory is a
local build kept for testing; it is gitignored and never deployed.

Build a release with:

    cd apps/mobile   && flutter build apk --release --target-platform android-arm,android-arm64
    cd apps/partner  && flutter build apk --release --target-platform android-arm,android-arm64

The APK lands at `build/app/outputs/flutter-apk/app-release.apk`.

## Why those flags

**One file, not three.** `--split-per-abi` produces a smaller APK per
architecture, which is right for the Play Store because the store picks the
matching one. Downloading from a web page, nothing picks: the customer would
have to know whether their phone is arm64 or armeabi-v7a, and choosing wrong
means an install that fails with no useful message.

**ARM only.** `--target-platform android-arm,android-arm64` drops x86_64,
taking the build from ~56 MB to ~36 MB. x86 Android exists essentially only in
emulators, and 20 MB of mobile data is a real cost to the person downloading.

## Signing — the part that cannot be got wrong

The keystore lives at `C:\Users\HP\fixbridge-keys\fixbridge-release.p12`,
deliberately **outside this repository** so no `git add -A` can sweep it in.
Each app points at it through `android/key.properties`, which is gitignored.

**Back that file up somewhere you cannot lose it.** Android refuses to install
an update over an app signed with a different key. If the keystore is lost,
every existing user has to uninstall and reinstall — losing their session — and
there is no way to recover it.

A release build **fails** rather than falling back to the debug key, because a
silently debug-signed release is the worst possible artefact: it installs
fine, so nothing looks wrong until the first update, which nobody can then
install. Verify before publishing:

    apksigner verify --print-certs app-release.apk

It must print `CN=FixBridge, OU=Engineering, O=FixBridge, L=Jabalpur, ...`.

## Publishing a new version

The APKs are ~36 MB and replaced every release, which is precisely what git is
bad at — committing them would grow the repository's history permanently, per
app, per release, and Vercel would rebuild the whole site to publish a binary
that has nothing to do with the site. GitHub Releases is built for this, costs
nothing, and carries its own version history.

1. Raise `version:` in the app's `pubspec.yaml` (e.g. `0.1.0+1` → `0.2.0+2`).
2. Build both APKs, as above, and verify the signature.
3. Create a GitHub release at
   `https://github.com/ankit8453/fixbridge/releases/new`, tag it `v0.2.0`, and
   attach both files named exactly **`fixbridge.apk`** and
   **`fixbridge-partner.apk`**. The names matter: the download page links to
   `/releases/latest/download/<name>`, which resolves to the newest release
   without the page ever being edited — but only if the filenames are stable.
4. Raise `APP_CUSTOMER_LATEST_VERSION` / `APP_PARTNER_LATEST_VERSION` in the
   API's environment. This is what the in-app update check compares against;
   publishing without raising it tells nobody, and raising it without
   publishing sends everybody to a file that has not changed.
5. Only if an old build would genuinely misread the API — a changed money
   field, a removed status — also raise `APP_*_MIN_VERSION`. That forces every
   older install to a blocking update screen, so it is not for ordinary
   releases.

**The repository must be public** for release assets to download without a
GitHub login. If it is private, either make it public or move the APKs to
Cloudflare R2 and change `RELEASES` in `Download.tsx`.
