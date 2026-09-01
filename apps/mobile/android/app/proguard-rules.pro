# Flutter's engine is reached by reflection from native code, so R8 cannot see
# the references and would otherwise strip classes the app needs at runtime.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Plugins that register through reflection.
-keep class com.baseflow.geolocator.** { *; }
-keep class com.baseflow.permissionhandler.** { *; }

# Line numbers survive shrinking, so a crash report from a real phone still
# points at a line rather than an obfuscated frame.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Play Core: split installs and deferred components.
#
# Flutter's embedding references these classes unconditionally, but the Play
# Core library is not a dependency here and never will be — this app is
# sideloaded from our own site, so there is no Play Store to install a split
# from. Those code paths are unreachable; R8 only needs telling that their
# absence is deliberate rather than an incomplete classpath.
-dontwarn com.google.android.play.core.**
-dontwarn io.flutter.embedding.engine.deferredcomponents.**
-dontwarn io.flutter.embedding.android.FlutterPlayStoreSplitApplication
