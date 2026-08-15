# Universal Dashboard JS Update

This package is based on the original JavaScript/JSX 360degrees application, not the later TypeScript branch.

Updated frontend files:
- `client/src/App.jsx`
- `client/src/styles.css`
- `client/src/main.jsx`
- `client/index.html`

Desktop and tablet now use the shared dashboard shell for every authenticated role/module already exposed by the application. The shell has a fixed logo, independently scrollable hidden-scrollbar navigation, fixed profile area, icon-only collapsed state, hover expansion on pointer devices, and persistent pin/collapse preference.

Mobile keeps the existing drawer/mobile interaction. Capacitor native mode (or `?mobileApp=1`) forces the existing phone presentation so the APK cannot switch to the desktop/tablet shell because of a wide WebView.

The pre-existing APK binary has been renamed `CI360degrees-debug-PREEXISTING-OLD.apk` because it was built before these source changes and must not be mistaken for a rebuilt APK.

Validation completed in this environment:
- JavaScript/JSX syntax parsed successfully for all source files.
- Node syntax checks passed for server/client `.js` files.
- Existing RBAC test suite: 4/4 passed.

A complete Vite production build could not be executed here because dependency installation did not complete in the sandbox. On a normal development machine run:

```bash
npm ci
npm run build
npx cap sync android
```

Then build the Android APK from the updated `android/` project.
