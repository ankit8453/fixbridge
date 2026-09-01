import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/**
 * Release signing, loaded from `android/key.properties` — which is gitignored,
 * and points at a keystore kept outside the repository entirely.
 *
 * **The key must never change.** Android refuses to install an update over an
 * app signed with a different one, so losing this keystore means every user has
 * to uninstall and reinstall, losing their session. It is the single most
 * important file in this project to back up.
 *
 * When the file is absent — a fresh clone, CI without the secret — the release
 * build falls back to the debug key below. That keeps `flutter build apk`
 * working for anyone, and is why the fallback is loud in the build output
 * rather than silent.
 */
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}
val hasReleaseKey = keystoreProperties.getProperty("storeFile") != null

android {
    namespace = "com.fixbridge.fixbridge_partner"
    compileSdk = flutter.compileSdkVersion

    // No `ndkVersion` on purpose — the same removal the customer app needed.
    // Pinning it makes Gradle fetch that exact NDK through sdkmanager, which
    // this Android Studio has deprecated: the tool crashes rather than
    // downloading. Nothing here ships native code.

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.fixbridge.fixbridge_partner"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Fails rather than falling back to the debug key.
            //
            // A warning was not enough: Flutter filters Gradle's output, so the
            // message never reached anyone, and a silently debug-signed release
            // is the worst possible artefact — it installs fine, so nothing
            // looks wrong until the first update, which every user is then
            // unable to install over it.
            //
            // Set ALLOW_DEBUG_SIGNED_RELEASE=true to build one anyway, for
            // testing the release path without the key at hand. The result is
            // still not publishable.
            val allowDebugSigned =
                (project.findProperty("allowDebugSignedRelease") as String?) == "true" ||
                    System.getenv("ALLOW_DEBUG_SIGNED_RELEASE") == "true"

            signingConfig = when {
                hasReleaseKey -> signingConfigs.getByName("release")
                allowDebugSigned -> signingConfigs.getByName("debug")
                else -> throw GradleException(
                    "Cannot build a release: android/key.properties is missing, so this " +
                        "APK would be signed with the debug key and could never accept an " +
                        "update. Restore key.properties (it points at the keystore kept " +
                        "outside the repo), or set ALLOW_DEBUG_SIGNED_RELEASE=true for a " +
                        "throwaway build."
                )
            }

            // Strips unused code and resources. Roughly halves the APK, which
            // matters when people download it over mobile data.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
