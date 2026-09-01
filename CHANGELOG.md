# Fly Birdy — Full Project Changelog

---

## v0.1 — Initial Release `af7e633` · 2026-08-30

**Project created from scratch.** Pure HTML5 Canvas game, no external libraries. Packaged as an Android APK via Capacitor + GitHub Actions CI.

### Core Architecture
- HTML5 Canvas with virtual `400×600` coordinate space; CSS scales to fill the WebView
- Web Audio API — all sound generated via oscillators, no audio files required
- State machine: `screen` variable drives which draw/update function runs each frame
- Screens: `LOADING → WELCOME → MODE_SELECT → LEVEL_SELECT → GAME → PAUSED → GAME_OVER / LEVEL_WON`
- `localStorage` persistence (`flybirdy_v1` key) with safe field-by-field merge on load

### Game Features
- **10 Adventure levels** — progressively harder pipe speed, gap size, and backgrounds (day → sunset → night → space)
- **5 playable birds** — each with a unique passive or active skill:
  - **Sparrow** — double coins from pipes
  - **Eagle** — stronger boost when falling hard
  - **Owl** — ghost preview of upcoming pipes; active freeze ability
  - **Parrot** — starts with 2 HP; auto-shield on first hit
  - **Flamingo** — reduced gravity / floats gently
- **Bird shop** — coins unlock birds; 5 purchasable colour skins per bird (25 total skins)
- **Powerups** — Heart (restore HP), Shield (absorb one hit), Magnet (attract coins)
- **Enemies** — spawned from level 5 onward; fire back at the player
- **Boss fight** — level 10 only; player can shoot back using tapped bullets
- **Coin system** — coins collected mid-run, saved to persistent total
- **Top-5 leaderboard** — score entry via hidden `<input>` (native mobile keyboard)
- **Achievements** — 20 achievements with icon, name, description, and coin reward
- **Daily Challenge** — 3 randomly generated objectives refreshed each day
- **Settings** — Music, Sound, Graphics (Low/Med/High), Screen Shake, Vibration toggles
- **High Scores screen**
- **Procedural backgrounds** — day, sunset, night (stars + moon crescent), space (nebula + parallax stars)
- **Screen shake** on hits
- **PWA support** — `manifest.json` + `sw.js` service worker for offline play
- **CI/CD** — GitHub Actions builds a debug APK on every push to `main`

---

## v0.2 — Mobile & UI Fixes `4a476c2 → fe663da` · 2026-08-30–31

- Shield no longer absorbs floor hits (was exploitable)
- Back buttons added to all sub-screens
- All buttons made fully opaque (were semi-transparent, hard to read)
- Coin display opacity fixed
- Full-screen canvas stretch — aspect-ratio letterboxing removed so game fills screen edge-to-edge
- Pause button repositioned to be reachable on mobile

---

## v0.3 — Screen Scaling & World Expansion `443ac31 → b31e552` · 2026-08-31

- **Game world now fills the full real screen** — pipes, bird, coins, bullets use `RW/RH` real pixel coords during gameplay; UI screens remain in virtual `400×600` with uniform scale + letterbox centering
- `BX` (bird X) is `RW * 0.2` — scales with actual device width
- Coin, powerup, and bullet coordinate bug fixed (`W/H` replaced with `RW/RH` in all gameplay draw calls)
- Horizontal stretch artefact fixed — uniform scale applied, UI centred in any window ratio
- Corrupted Unicode symbols in comments fixed

---

## v0.4 — Boss & Pipe Fixes `08bc95e → 4ac2516` · 2026-08-31

- Pipe spawn interval increased ~60% — more breathing room between pipes
- Boss now patrols center-right (55%–85% of screen width) so it is always visible and shootable
- Boss vertical drift fixed — constant-speed bounce replaces gravity accumulation (boss no longer falls off-screen)

---

## v0.5 — name entry, SW cache, APK Icons `bef972c → e346d80` · 2026-08-31

- `prompt()` replaced with a hidden `<input>` element for leaderboard name entry — `prompt()` is blocked in Capacitor WebViews
- Service Worker cache bumped to `v2` to force clients to pick up updated `script.js`
- Android launcher icon fixed — adaptive icon XML files (`mipmap-anydpi-v26`) removed; flat PNGs now show correctly on Android 8+
- CI workflow: `setup-java@v5` and explicit ImageMagick install to fix runner compatibility

---

## v0.6 — Unlimited Mode Expansion `638b1df` · 2026-09-01

### New Game Modes
| Mode | Description |
|---|---|
| **Time Trial** | 60-second countdown; each hit costs 3 seconds; no death |
| **Survival** | 5 HP; no powerups; endless pipes |
| **Gauntlet** | 30 fixed pipes seeded by today's date; same layout for every player each day |

### Unlimited Modifiers (14 total)
*Original 7:* Mirror, Tiny Bird, Zen, Weather, Reverse, Slow-mo, Milestone  
*New 7:* Pipe Rush, Double Gap, Moving Pipes, Low Grav, Fog, Coin Frenzy, Ghost Pipes

- **Dropdown mod selector** in Unlimited Options screen — multi-select with checkboxes; empty = random auto-rotation
- **Mod conflict system** — incompatible pairs greyed out with `"conflicts with X"` label:
  - `zen` ↔ `ghost_pipes`
  - `pipe_rush` ↔ `slow_miss`
  - `double_gap` ↔ `ghost_pipes`
  - `mirror` ↔ `reverse`
- **Multi-mod combinations** — 2, 3, 4+ mods work simultaneously; header shows `"N mods selected"` at 3+; HUD badge strip wraps to a second row

### Practice Mode
- Toggle in Unlimited Options; on death the bird respawns at full HP with invincibility frames instead of ending the run; score not saved to leaderboard; compatible with all mod combinations

### Quality of Life
| Feature | Detail |
|---|---|
| Combo multiplier | Score multiplier activates at 3-pipe streak; toggle in Settings |
| PB toast | `"🔥 New Personal Best!"` popup fires mid-run the moment the record is broken |
| Bird trail | Ghost echo behind the bird; toggle in Settings |
| Screen wake lock | `navigator.wakeLock` prevents screen sleep during gameplay |
| Auto-pause | `visibilitychange` event pauses the game when app is backgrounded |
| Run history | Last 10 runs stored with mode, score, bird, mods, and date; viewable in High Scores → History tab |
| FPS counter | Overlay toggle in Settings |
| Gap preview line | Dashed line showing the centre of the next gap; toggle in Settings |
| Colorblind mode | Pipes rendered orange instead of green; toggle in Settings |
| Particles toggle | Explosion/hit particles can be disabled for performance |
| Haptic Strength | Off / Light / Strong selector (replaces On/Off vibration toggle) |
| Scrollable settings | ▲/▼ arrow buttons scroll the settings list |

### Visual Polish
| Feature | Detail |
|---|---|
| Loading bar | Animated gold fill during the "FLY BIRDY" loading phase |
| Night welcome | Welcome screen uses `drawBg('night')` automatically between 20:00–06:00 |
| Adventure progress bar | Thin vertical bar on left edge fills as `score / targetScore`; count shown below |
| Screen edge glow | Coloured border at combo ≥ 5 (gold) or ≥ 10 (red); intensity scales with streak |
| Confetti burst | 80 coloured rectangles rain down on any non-adventure Personal Best |
| Screen transitions | `drawTransition()` fade-in/out overlay; `goScreen(fn)` helper ready for wiring |

### Audio
- **Master gain nodes** — `masterMusicGain` + `masterSFXGain`; all audio routed through them
- **Volume sliders** — Music and Sound volume (0–100%) in Settings replace On/Off toggles
- **Custom Audio screen** — full IndexedDB-backed system:
  - Upload MP3/OGG for background music with trim bar (draggable start/end handles)
  - Upload custom SFX for each of 7 slots: Flap, Score, Die, Hit, Level Win, High Score, Low HP
  - Remove button per slot; built-in oscillator fallback when no custom audio is loaded
- Fixed vibration: hit = 80 ms (respects haptic strength), death = `[80,30,80,30,160]` ms pattern (On/Off toggle only)

### Settings additions
- **Export Save** — `prompt()` pre-filled with full JSON save string
- **Import Save** — paste JSON to restore a save across devices

---

## Bug Fixes Log (2026-09-01)

| Commit | Fix |
|---|---|
| `e1ed8e1` | `capacitor.config.json` `webDir:"."` rejected by Capacitor — reverted to `"www"` |
| `e1ed8e1` | `scheduleLoop` lost `o.type='triangle'` in master-gain refactor — music played wrong timbre |
| `e1ed8e1` | `all_mods` achievement threshold was 7; updated to 14 |
| `e1ed8e1` | Normal HP-loss hit used raw `navigator.vibrate(80)` bypassing haptic strength helper |
| `e1ed8e1` | `manifest.json` description had garbled `â€"` encoding |
| `e1ed8e1` | `sw.js` bumped to `v4`; icons added to pre-cache list |
| `52330ac` | CI `cp` command missing `icon-192.png` / `icon-512.png` — not copied to `www/` |
| `93a4b08` | Loading bar used native `ctx.roundRect()` — throws on `width=0` at frame 0, crashing game loop → blank screen |
| `d04e442` | Custom audio functions (`loadCustomAudio`, `startCustomMusic`, `stopCustomMusic`, `playCustomOnce`, `trimState`, `trimPointerDown/Move/Up`, `drawAudio`) called but never defined → `ReferenceError` crashed loop on load completion → blank screen |
| `8d94568` | Duplicate `stopMusic` body introduced by bad replacement → `SyntaxError` at line 94 |

---

## v0.7 — Drag-to-Scroll `28e30fb` · 2026-09-01

- **Settings screen drag-to-scroll** — live `pointermove` drag scrolls the list in real time; the scroll delta is converted from real pixels to virtual coords via `uiS`
- Short taps still fire buttons normally
- Vertical drag (`absDy > 12`) suppresses button hit-test to prevent accidental taps while scrolling
- `SCROLLABLE_SCREENS` set (`Settings`, `High Scores`, `Bird Select`, `Unlimited Opts`) marks which screens receive drag-scroll behaviour
- `scrollDragActive` flag prevents a vertical drag from simultaneously triggering swipe-back navigation

---

## Infrastructure

| File | Purpose |
|---|---|
| `index.html` | Canvas + hidden name-entry `<input>`; service worker registration |
| `style.css` | Canvas fills 100vw/100vh; no scrollbars; touch-action none |
| `manifest.json` | PWA manifest — standalone display, portrait lock, theme colour |
| `sw.js` | Cache-first service worker (v4); pre-caches all game files + icons |
| `capacitor.config.json` | Capacitor wrapper — `webDir:"www"`, HTTPS scheme, dark status bar |
| `package.json` | `@capacitor/android ^6`, `@capacitor/cli ^6`, `@capacitor/core ^6` |
| `.github/workflows/build-apk.yml` | CI: install deps → add Android platform → copy web assets to `www/` → `cap sync` → generate launcher icons via ImageMagick → `gradlew assembleDebug` → upload APK artifact |

