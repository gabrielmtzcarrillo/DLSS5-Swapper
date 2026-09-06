# Issue #169: F8 waits for the panel in 2.2.1

Report: https://github.com/rakanki911/DLSS5-Swapper/issues/169

The report says F8 displays the waiting-for-panel message. The only comment at
investigation time is “Working on it”; no logs or reproduction environment were
provided. This establishes that the native add-on opened, but does not identify
which bridge stage failed.

## Startup and readiness

1. `main.js` waits for Electron readiness, registers overlay IPC, creates the app
   window, and starts `overlay-service.js`.
2. `overlay-bridge.js` creates the hidden offscreen BrowserWindow with the isolated
   preload, loads `overlay-panel.html`, reads preferences, measures the panel, and
   applies fixed-size device emulation.
3. The bridge requests paint and now waits for a valid encoded panel frame before
   listening on the profile-specific named pipe. The entire startup has a 15-second
   deadline, including page loading, measurement, first paint, and pipe listening.
4. Only after successful listening does it publish a random token to
   `<userData>/overlay-bridge.endpoint`. The native add-on reads the token from
   `%APPDATA%/<LAB_OVERLAY_PROFILE>`, constructs the same pipe name, and retries
   connection once a second. `scripts/build-overlay.ps1` sets the release profile
   to `dlss5-swapper`; custom userData paths/build profiles must match.
5. A client receives the cached frame and subsequent frames with ACK flow control.
   `overlay.cpp::draw` shows the reported waiting message whenever disconnected or
   without pixels. A listening pipe alone does not prove a game connected or that
   it successfully uploaded the panel texture.

Previously, startup rejection only reached the console. Renderer/transport loss
closed the bridge without offering recovery, and publication did not require a
first frame. The new recovery dialog offers an explicit retry or continuation
without the overlay. Each failure closes the window, socket, server and IPC /
preference listeners, and removes only the endpoint owned by that attempt.
Late startup completion cannot publish readiness after failure. Runtime renderer,
preload and server failures use the same recovery path. Shutdown suppresses retries.

Diagnostics are saved to `<userData>/overlay-bridge-error.json` (normally
`%APPDATA%/dlss5-swapper/overlay-bridge-error.json`) and shown in the dialog even if
writing fails. They include the timestamp, app version, stage, error/code/stack,
profile path and endpoint/pipe name. This is the last failure record, not a live
health indicator. Retrying does not reset preferences or modify game files.
If retry fails, include this file with the report. A corrupt preferences file is
preserved for diagnosis. F8/Escape closes the native panel; Home opens original
ReShade tools. Restarting Swapper offers another startup attempt after dismissal.

## Automated coverage and limits

`node --test test/overlay-bridge.test.js` executes the production bridge with
mock Electron/transport events and real temporary endpoint files. It covers
load/preferences/measurement/paint/listen failures, bounded hangs, renderer and
transport loss, publication ordering, ownership-safe cleanup, explicit retry,
deduplication, dismissal and shutdown during startup.

These tests do not reproduce the reporter's GPU/game environment or validate
Chromium offscreen rendering and native texture upload in a real game. Profile
mismatch, a second game occupying the connection, and native rendering failure
remain distinct possibilities if the bridge itself starts successfully.
