# Crazy Shooters Offline

The checked-in Unity 2017 WebGL game, served locally with the existing gameplay
mods and tactical-bot overlay. The Unity project/source is not included; this
package uses the prebuilt game binaries and optimizes the JavaScript around them.

## Download and start

1. On GitHub, open **Actions**, select a successful **Test and package** run for
   the branch you want, and download the `crazy-shooters-offline` artifact.
2. Extract the artifact, then extract `crazy-shooters-offline.zip` inside it.
3. On Windows, open `crazy_shooters_offline/start_game.bat` (or
   `start_game.ps1`). Node.js or Python 3 must be installed.
4. For a manual launch on any desktop OS, run one of these commands **from the
   `crazy_shooters_offline` folder**:

   ```sh
   node server.js
   # or
   python3 server.py
   ```

   Open the URL printed by the server, normally
   <http://127.0.0.1:8088/index.html>. Keep the server running while you play.
   The servers bind to loopback by default; `HOST` and `PORT` can override the
   address and port. If a port is in use, the server tries the next one and
   prints the chosen URL. The Windows launchers open port 8088, so use the
   manual command and printed URL if that port is occupied or you set `PORT`.

Use a desktop browser with WebGL support (Chrome or Edge are recommended).
The page defaults to Photon's **local offline mode**; wait for the bottom-right
status to say **Offline**, then choose Start, create a room, continue, and join.
The local room does not provide online multiplayer. To try the original network
startup instead, add `?online=1` to the URL; this depends on the original
external service and is not guaranteed to work.

## Performance settings

The bottom-right **Graphics** menu changes the internal rendering resolution
and remembers your choice:

| Setting | Maximum drawing buffer | Use |
| --- | --- | --- |
| Balanced | 1280 × 720 | Default |
| Performance | 960 × 540 | Try this first on a slow machine |
| Native | Browser viewport | Sharpest; most demanding |

The game is stretched to the window at lower resolutions. Reducing resolution
may make the image softer but reduces GPU work. Also try the game's own lower
quality setting, enable hardware acceleration in your browser, update graphics
drivers, and close other GPU-heavy applications. Reload after updating the
package to avoid running cached scripts.

The old trainer repeatedly scanned the entire 256 MiB Unity heap, blocking the
main thread. Discovery now searches only allocated memory in small scheduled
slices, validates candidates, and stops scanning while the tab is hidden. In one
software-rendered test, the old scanner consumed about **125 seconds of 134
seconds**; the new scanner consumed about **0.26 seconds during a 100-second
real-game smoke test**. These are diagnostic measurements, not an FPS promise:
performance still depends on the browser, GPU, resolution, and scene. Software
rendering can remain slow even when the scanning bottleneck is gone.

## Controls and advantages

| Control | Action |
| --- | --- |
| WASD / arrows, mouse | Move and look |
| Left / right mouse | Fire / aim |
| Space, C, Shift, R | Jump, crouch, sprint, reload |
| 1–9 | Change weapon |
| F6 | Infinite ammo / no reload |
| F7 | Enhanced jump and movement speed |
| F8 | Master toggle for ammo, physics, and rapid fire |
| F9 | Rapid fire (0.75× shot delay, about 33% more shots per second) |
| F10 | Spawn a tactical bot |
| F11 | Pause / resume tactical AI |
| F12 | Show / hide radar |
| Tab / Esc | Scoreboard / options |

The three gameplay mods start enabled and can also be toggled using their
badges. Their original values are tracked and restored when disabled. The
match-time lock is independent of F8 and keeps the local round open while the
mod is running. Two tactical bots are created by default. They are a JavaScript
visual/combat overlay, not native Unity or network players; navigation is
approximate, especially outside the Factory map, and does not reproduce the
actual map's collision mesh.

The trainer targets the memory layout of the **bundled** Unity build. It
validates classes and objects, and recognizes previously boosted copies where
possible, but other Unity builds or ambiguous weapon configurations may not
have the same offsets or baselines. No anti-detection guarantee is made.

## Tests and GitHub build

From the repository root, Node.js 20 or newer runs the automated checks:

```sh
npm ci
npm test
# Requires an installed Chrome/Chromium executable:
CHROMIUM_PATH=/path/to/chrome npm run test:browser
```

The browser smoke test serves the real package, creates a local room, joins a
match, checks weapon/physics toggles and the match clock, and exercises input,
camera tracking, AI controls, and a second room with newly spawned weapon
copies. CI uses software rendering and does not
assert an FPS. GitHub Actions runs both suites, then packages the prebuilt
Unity files and launchers into a downloadable artifact with a SHA-256 checksum.
The workflow does not recompile Unity because the Unity source project is not
in this repository.
