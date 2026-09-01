# APKs served from the site

These are the files `/download` links to. They are **placeholders copied from
debug builds** so the page can be tested end to end — do not ship them.

Before the first public download, replace them with **release** builds signed
by the release keystore:

    flutter build apk --release

Two things matter more than they look:

1. **Same signing key, every time.** Android refuses to install an update over
   an app signed with a different key. Losing the keystore means every user
   must uninstall and reinstall, losing their session.
2. **Keep the version in step.** `APP_CUSTOMER_LATEST_VERSION` and
   `APP_PARTNER_LATEST_VERSION` in the API's env decide what the in-app update
   prompt claims. Publishing an APK without raising them tells nobody, and
   raising them without publishing sends everybody to a file that has not
   changed.
