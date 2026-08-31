# Setting up Flutter — Windows

Run these in **PowerShell**. Total download is roughly 8–10 GB and takes a
while on a normal connection; steps 1 and 2 can run at the same time in two
windows.

---

## 1. Android Studio (brings the Android SDK, the emulator and a JDK)

```powershell
winget install --id Google.AndroidStudio --accept-source-agreements --accept-package-agreements
```

**Then open Android Studio once.** This part cannot be scripted: the first-run
wizard is what actually downloads the SDK. Accept the defaults, let it finish,
and close it. Without this the SDK folder never appears and `flutter doctor`
reports a missing Android toolchain.

---

## 2. Flutter itself

Cloning the stable branch is the officially supported install and avoids the
zip-extraction step:

```powershell
New-Item -ItemType Directory -Force C:\src
git clone https://github.com/flutter/flutter.git -b stable C:\src\flutter
```

Put it on your PATH permanently:

```powershell
[Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));C:\src\flutter\bin", "User")
```

**Close the terminal and open a new one** — PATH changes only apply to new
shells. Then confirm:

```powershell
flutter --version
```

The first run is slow: it downloads the Dart SDK and build artifacts.

---

## 3. Accept the Android licences

```powershell
flutter doctor --android-licenses
```

Press `y` at every prompt. Then check the whole toolchain:

```powershell
flutter doctor
```

You want green ticks on **Flutter** and **Android toolchain**. A cross next to
Visual Studio is fine — that is for building Windows desktop apps, which we are
not doing. Chrome is optional too.

---

## 4. A device to run on

**A real phone is better than the emulator** — it starts faster, and it is the
kind of hardware the app is actually for.

On the phone: Settings → About phone → tap *Build number* seven times, then
Settings → Developer options → enable **USB debugging**. Plug it in by USB and
accept the trust prompt. Check it is seen:

```powershell
flutter devices
```

If you would rather use the emulator, create one in Android Studio under
*Device Manager* (a Pixel image is fine), then:

```powershell
flutter emulators --launch <emulator_id>
```

---

## 5. Run the app

The API has to be running first — from the repo root, in its own terminal:

```powershell
npm run start:dev
```

Then, from `apps/mobile`:

```powershell
flutter pub get
flutter run
```

### Pointing the app at your API

This is the step that trips every new Flutter setup, because the right address
depends on where the app is running.

**Android emulator** — `localhost` inside the emulator means the emulator
itself, not your laptop. The alias for the host machine is `10.0.2.2`, which is
already the default, so plain `flutter run` works.

**A real phone** — the phone needs your laptop's address on the Wi-Fi network.
Find it:

```powershell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' }).IPAddress
```

Then run with that address (both devices on the same Wi-Fi):

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3001/api/v1
```

If the phone cannot reach it, Windows Firewall is the usual cause — allow
inbound TCP on port 3001 for private networks.

---

## Everyday commands

| | |
|---|---|
| `flutter run` | Run in debug. `r` hot-reloads, `R` restarts, `q` quits. |
| `flutter analyze` | Static analysis. Run before committing. |
| `flutter test` | Unit and widget tests. |
| `flutter clean` | Wipes build output when something is stuck. |
| `flutter build apk --release` | A release APK for handing to a pilot user. |

---

## Before release: bundle the fonts

The app currently fetches Plus Jakarta Sans, Inter and Noto Sans Devanagari at
runtime through `google_fonts`. That is fine while developing, but on a
dropping connection an unresolved face renders as blank boxes — and Hindi is
the default language, so that is the common case, not the edge case.

Download the three families from [fonts.google.com](https://fonts.google.com),
put the `.ttf` files under `assets/fonts/`, declare them in `pubspec.yaml`, and
switch the two builders in `lib/core/theme/app_typography.dart` from
`GoogleFonts.*` to plain `TextStyle(fontFamily: …)`. That file is written so
this is the only change needed.
