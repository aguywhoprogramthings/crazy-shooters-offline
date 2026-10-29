# Crazy Shooters Offline

The checked-in Unity 2017 WebGL game, served locally with the existing gameplay
mods and tactical-bot overlay. The Unity project/source is not included; this
package uses the prebuilt game binaries and optimizes the JavaScript around them.

## Download and start

1. On GitHub, open **Actions**, select a successful **Test and package** run for
   the branch you want, and download the `crazy-shooters-offline` artifact.
   The repository's default branch may contain an older game; do not use its
   green **Code → Download ZIP** button as a substitute for the build artifact.
2. Extract the artifact, then extract `crazy-shooters-offline.zip` inside it
   into a **new folder**, separate from any older copy.
3. On Windows, open `crazy_shooters_offline/start_game.bat` in that new folder
   (or `start_game.ps1`). Node.js or Python 3 must be installed. Keep the batch
   console open while playing. If another server already uses port 8088, the
   launcher waits for this copy's server and opens its actual port instead.
4. Check the **bottom-left** of the game for **Optimized v2**, **Offline** and
   the **Graphics** selector. If these are missing, an older copy is open.
5. For a manual launch on any desktop OS, run one of these commands **from the
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
   prints the chosen URL; open the printed URL, not an old browser bookmark.

Use a desktop browser with WebGL support (Chrome or Edge are recommended).
The page defaults to Photon's **local offline mode**; wait for the bottom-right
status to say **Offline**, then choose Start, create a room, continue, and join.
The local room does not provide online multiplayer. To try the original network
startup instead, add `?online=1` to the URL; this depends on the original
external service and is not guaranteed to work.

## Performance settings

The bottom-left **Graphics** menu changes the internal rendering resolution
and remembers your choice for that browser and port:

| Setting | Maximum drawing buffer | Use |
| --- | --- | --- |
| Performance | 960 × 540 | Default for new installations |
| Ultra low | 640 × 360 | Try this if Performance is still too slow |
| Balanced | 1280 × 720 | Sharper, more demanding |
| Native | Browser viewport | Sharpest; most demanding |

The game is stretched to the window at lower resolutions. Reducing resolution
makes the image softer but can reduce GPU work. The **Page fps** indicator is
an estimate of browser animation callbacks, not necessarily the exact Unity
rendered frame rate. It helps identify slowdowns but is not a performance
guarantee.

Also choose **Fastest** in the game's Options, close GPU-heavy applications,
and enable browser hardware acceleration. In a regular Chrome or Edge window,
open `chrome://gpu` or `edge://gpu`: the **Graphics Feature Status** section
should report WebGL as hardware accelerated. Software-only rendering or a
SwiftShader renderer can be much slower; enable acceleration, restart the
browser, and update graphics drivers if needed. Reload after updating the
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
match, checks weapon/physics toggles and the match clock, and exercises input
at reduced resolution, camera tracking, AI controls, and a second room with
newly spawned weapon copies. CI uses software rendering and does not assert an
FPS. GitHub Actions also tests the Windows launchers with a competing server
on the requested port, and packages the prebuilt Unity files and launchers
into a downloadable artifact with a SHA-256 checksum. The workflow does not
recompile Unity because the Unity source project is not in this repository.
