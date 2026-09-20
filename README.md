<p align="center">
  <img src="docs/banner.png" alt="DLSS 5 Swapper" width="100%">
</p>

<h1 align="center">DLSS 5 Swapper</h1>

<p align="center">
  Install and manage DLSS 5 Neural Rendering for compatible games and emulators.
</p>

<p align="center">
  <a href="https://github.com/rakanki911/DLSS5-Swapper/releases/latest"><img src="https://img.shields.io/github/v/release/rakanki911/DLSS5-Swapper?color=8fd400&label=release" alt="Latest release"></a>
  <a href="https://github.com/rakanki911/DLSS5-Swapper/releases"><img src="https://img.shields.io/github/downloads/rakanki911/DLSS5-Swapper/total?color=8fd400&label=downloads&cacheSeconds=300" alt="Total downloads"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-8fd400" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/languages-38-8fd400" alt="38 languages">
  <a href="https://buymeacoffee.com/rakanki911"><img src="https://img.shields.io/badge/support-555" alt="Support"></a>
  <a href="https://buymeacoffee.com/rakanki911"><img height="20" src="https://cdn.buymeacoffee.com/buttons/v2/lato-yellow.png" alt="Buy me a coffee"></a>
</p>

## Download 2.2.2

[**Windows Installer**](https://github.com/rakanki911/DLSS5-Swapper/releases/download/v2.2.2/DLSS5-Swapper-Setup-2.2.2.exe) ·
[**Portable**](https://github.com/rakanki911/DLSS5-Swapper/releases/download/v2.2.2/DLSS5-Swapper-2.2.2-portable.exe) ·
[Checksums](https://github.com/rakanki911/DLSS5-Swapper/releases/download/v2.2.2/SHA256SUMS.txt)

<p align="center">
  <img src="https://raw.githubusercontent.com/rakanki911/DLSS5-Swapper/7415065e5c5437441d0e0b0a0362d0ada6d86e15/docs/screenshots/01-home.png" alt="Home" width="100%">
</p>

## Features

- **Easy installation:** native DLSS games, or compatible non-DLSS games through DLSS5-Feeder.
- **Your library:** Steam, Epic, GOG, modern Xbox Game Pass folders, and manually added games/emulators.
- **Search and filters:** combine title, graphics API, DLSS status/version and add-ons; click counters to filter.
- **Flexible layout:** group by store or show everything in one list, with game artwork and light/dark themes.
- **Controlled scanning:** full-drive scanning is **off by default**. Added folders still scan normally; enable all-drive discovery or remove scan folders in Settings.
- **dgVoodoo2 version:** choose v2.87.4 or v2.87.3 in Settings for DX8/9 games. The choice is saved and used on the next Apply / Install. Each version downloads from its official release with SHA-256 verification; reapply to change an existing installation.
- **Right-click shortcuts:** open/copy folder, rescan, change cover, restore originals or hide a game.
- **Backups and History:** restore original files, keep installation records, and copy History/activity/install logs.
- **ReShade options:** configure DLSS Neural Rendering through ReShade's own in-game options and overlay.
- **Rendering API override:** optional, per game, with **Automatic** as the default; detection is never overwritten.
- **Custom add-ons:** the Add-ons page remains available alongside the integrated installation routes.

## New in 2.2.3

Six faults reported by people using 2.2.2, each fixed at the cause.

### Installs that were refused for no good reason

- **An older card can now try OptiScaler.** OptiScaler itself has always run on
  RTX 40; what needs Blackwell is the neural model file. Upstream 0.2.0 says
  plainly that older architectures work with a modded `nvngx_dlssnr.dll`, so
  the card joins the driver as something said rather than enforced - and a
  modded model already in the game folder is kept, never overwritten.
- **A failed process check no longer refuses the install.** Reading the running
  process list can fail on its own - PowerShell restricted by policy, a cold
  WMI service - and that failure was being reported as "close the game first"
  to people whose game was already closed.
- **A saved backend profile no longer makes a game uninstallable.** ReShade
  lets a preset be named anything, and mod packs ship them as `.txt`: the app
  saved those and then refused to read them back, so the game could not be
  installed again at all until the profile was deleted by hand. This is the
  "Invalid backend profile" report.

### Getting the neural pass to actually run

- **A game's own outdated shader compiler is retired during the install.**
  Spider-Man Remastered ships `D3DCompiler_47.dll` 6.3.9600 from 2013 beside
  its executable, Windows loads that in preference to its own, and the neural
  pass - compiled as Shader Model 5.1 - then silently produces nothing while
  the install, the add-on and the frame counter all report success. The file
  now goes into the backup, the game uses the copy Windows ships, and Restore
  puts it back. Only ever when Windows has a newer copy to fall back on.

### The in-game overlay

- **The panel reaches the game on a display with scaling.** Chromium paints the
  offscreen panel at the desktop's scale factor - 804 pixels wide at 150% for a
  534-pixel panel - and every one of those frames was dropped by a size check,
  on any scaled display, which is most of them. The panel is resampled back to
  its transport size instead of being discarded in silence.

### Wording

- **The Feeder route is named for what it covers**: "No DLSS / Incompatible
  DLSS", in all 38 languages. Thanks to @MaestroMetty (#48).

## New in 2.2.2

A release about the reports people sent, most of them fixed at the cause.

### Games it can now find and install into

- **Executables whose renderer cannot be read are offered anyway.** Protected
  builds, script extenders like `f4se_loader`, and launchers that start the
  real engine name no rendering API at all and were silently dropped - the
  "no 3D executable" report. They now appear in the executable picker, with
  the renderer shown as unknown for you to set.
- **Ubisoft Connect games are discovered**, alongside Steam, Epic, GOG and the
  Xbox folders.
- **DXVK and vkd3d games are reported as Vulkan.** The scanner used to call
  them DirectX and offer a route that installs a Direct3D hook, while the
  installer refused to overwrite the wrapper - a game that could not be
  installed with no explanation.
- **Red Dead Redemption 2 follows the renderer you chose in the game**, read
  from its own `system.xml`, instead of always reporting DirectX 12.

### The in-game overlay

- **A game that crashed no longer locks the overlay out of every game after
  it.** Only one game at a time drives the panel, and a killed game could
  leave its end of the pipe open forever - the panel then said it was waiting
  for a design that never came.
- **The game holds still while the panel is open.** No mouse or keyboard input
  reaches the game, the way ReShade does for its own overlay, so a slider can
  be judged on one fixed shot.
- **The Overlay page says what the service is doing** - listening, connected
  to a game, or not running - with a dot for each state.

### Installing

- **Files are installed writable.** Windows carries the read-only attribute
  across a copy and the payload inside the installed app is read-only, which
  is what "Unable to save configuration and/or current preset ... ReShade.ini"
  on the game's screen means. It also broke a second install and the restore
  after it.
- **Feeder's Vulkan interop layer ships and is installed with a Vulkan game.**
  Some drivers and emulators do not expose the KHR external-interop
  extensions, and the install then looked perfect and did nothing.
- **An older NVIDIA driver no longer blocks OptiScaler.** The neural-rendering
  model file ships with this app rather than being taken from the driver, so
  an older driver still runs - which matters because 616.64 and 616.86 are
  measured upstream to fault inside NVIDIA's own runtime, and people roll back
  deliberately. The ReShade and Feeder routes say so before installing.
- **The professional Blackwell boards are accepted.** OptiScaler needs a
  Blackwell card, and the check asked for a name matching "RTX 50xx" - an
  RTX PRO 6000 Blackwell was refused for being called something else.
- **A component that antivirus quarantines says so.** "Check your connection"
  was shown for every failure, including the one where the connection is fine
  and Defender removed the file after it verified.

### Everyday

- **An update notice** in the sidebar when a newer release exists. One lookup,
  no identifiers sent, nothing downloaded or installed.
- **Hiding a game is reversible**: Settings lists what is hidden with *Show
  again*, and hiding asks first.
- **Closing the window quits.** The overlay service held an offscreen window,
  so the process stayed in Task Manager with nothing on screen.
- **A faster, quieter start.** Drive discovery no longer blocks on a cold WMI
  call, two game cards scanning at once can no longer erase each other's
  results, and the add-ons page does not re-hash every file on each visit.
- **A support button** on the About page, and in this README.

### Components

DLSS5-Feeder **0.14.0-beta.4** (was 0.12.0) · OptiScaler DLSS-NR
**0.2.0-patch1** (was 0.1.1.5) · LumeniteFX updated · ReShade 6.8.0 and
dgVoodoo2 2.87.4 already current.

[Full 2.2.2 notes →](https://github.com/rakanki911/DLSS5-Swapper/releases/tag/v2.2.2) ·
[What arrived in 2.2.1 →](https://github.com/rakanki911/DLSS5-Swapper/releases/tag/v2.2.1)

## New in 2.2.1

- **⭐ In-game overlay:** press **F8** and the app's own panel appears over the
  running game — the same HTML, fonts and sliders as the preview, connected to
  the pinned RenoDX v4.7 build so the controls move the settings that are really
  loaded. **While the panel is open the game receives no mouse or keyboard
  input**, so the camera holds still and a slider can be judged on one fixed
  shot, exactly as ReShade does for its own overlay. Install it together with
  DLSS from one switch, choose your hotkey, or remove it on its own.
  **It supports DLSS5-Feeder and RenoDX v4.7 only** — the panel is built around
  that exact, hash-verified build and is not offered for OptiScaler.
- **Overlay themes, including your own:** Emerald, Azure and Amethyst, plus
  **Create theme** — pick an accent colour and the panel's other shades are
  derived from it, in the app and in the game alike.
- **Per-game rendering API override:** now **optional**, with **Automatic** as
  the default. Pick DirectX 8/9/10/11/12, Vulkan or OpenGL for a game that
  reports the wrong renderer; automatic detection is left untouched.
- **Artwork for everyone:** posters and banners come from Steam's public
  endpoints with no key, so every user sees the same covers and heroes.
- **Some issues were fixed**, including the overlay connection line that
  contradicted the CONNECTED badge, dialogs that stayed dark in the light theme,
  theme cards misaligned in Arabic/Persian/Urdu, and an updated overlay build
  that refused to install over the previous one.

[What arrived in 2.2.0 →](docs/releases/v2.2.0.md)

### The Overlay page

<p><img src="docs/screenshots/07-overlay.png" alt="Overlay page with the Emerald, Azure and Amethyst themes" width="100%"></p>

### Create your own theme

Pick an accent colour and the panel's other shades follow it. The preview is the
real panel, not a colour swatch.

<p><img src="docs/screenshots/08-overlay-create-theme.png" alt="Create a theme dialog with a live panel preview" width="100%"></p>

### Preview before you choose

<p><img src="docs/screenshots/09-overlay-preview.png" alt="Interactive overlay preview" width="100%"></p>

## Compatibility

| Category | Support |
| --- | --- |
| **System** | Windows 10/11 x64; compatible 32-bit and 64-bit games |
| **ReShade / Feeder GPUs** | RTX 20 / 30 / 40 / 50; older-series support is reported by the bundled modified runtime's author |
| **OptiScaler GPUs** | 64-bit games with native DLSS enabled. The bundled neural model runs on **Blackwell** (RTX 50 / RTX PRO Blackwell); an older card needs a modded `nvngx_dlssnr.dll` you supply, which is never overwritten. Driver **616.56** recommended |
| **DirectX 12** | Native DLSS, Feeder, or eligible OptiScaler games |
| **DirectX 10** | 32-bit Feeder through its private D3D11 relay; experimental |
| **DirectX 11** | Feeder for 32/64-bit games; eligible OptiScaler games |
| **DirectX 9 / 8** | DX9: 32/64-bit; DX8: 32-bit, through dgVoodoo2 → DX11 → Feeder |
| **Vulkan / OpenGL** | ReShade/Feeder; eligible Vulkan games can also use OptiScaler |
| **In-game overlay** | 64-bit DirectX 10 / 11 / 12 games with ReShade add-on support; **DLSS5-Feeder and RenoDX v4.7 only** |

OptiScaler's DX11/Vulkan path uses a DX12 bridge with FSR output by default.
For Vulkan backend changes, **restore originals first**. OptiScaler is not the emulator/non-DLSS route.

## Emulators

Select the emulator folder and its active renderer, then use **ReShade/Feeder**.

<table>
  <tr><th colspan="3">Emulators</th></tr>
  <tr><td>DuckStation</td><td>PCSX2</td><td>RPCS3</td></tr>
  <tr><td>Dolphin</td><td>PPSSPP</td><td>Xenia</td></tr>
  <tr><td>Cemu</td><td>Ryujinx</td><td>yuzu / suyu / Eden / Citron / Sudachi</td></tr>
  <tr><td>shadPS4</td><td>Azahar / Citra / Lime3DS</td><td>melonDS</td></tr>
  <tr><td>Flycast</td><td>xemu</td><td>Vita3K</td></tr>
  <tr><td>RetroArch</td><td>mGBA</td><td>Snes9x</td></tr>
  <tr><td>Play!</td><td></td><td></td></tr>
</table>

Compatibility varies by renderer and game. Xenia HUD correction remains experimental.

## 38 languages

<table>
  <tr><th colspan="4">All 38 languages</th></tr>
  <tr><td>English</td><td>العربية</td><td>简体中文</td><td>繁體中文</td></tr>
  <tr><td>Español</td><td>Português</td><td>Русский</td><td>Deutsch</td></tr>
  <tr><td>Français</td><td>日本語</td><td>한국어</td><td>Italiano</td></tr>
  <tr><td>Türkçe</td><td>Polski</td><td>Українська</td><td>Nederlands</td></tr>
  <tr><td>Čeština</td><td>Magyar</td><td>Română</td><td>Ελληνικά</td></tr>
  <tr><td>Svenska</td><td>Dansk</td><td>Norsk</td><td>Suomi</td></tr>
  <tr><td>ไทย</td><td>Tiếng Việt</td><td>Bahasa Indonesia</td><td>Bahasa Melayu</td></tr>
  <tr><td>Filipino</td><td>हिन्दी</td><td>বাংলা</td><td>فارسی</td></tr>
  <tr><td>اردو</td><td>Български</td><td>Српски</td><td>Hrvatski</td></tr>
  <tr><td>Slovenčina</td><td>Català</td><td></td><td></td></tr>
</table>

**Arabic, Persian and Urdu support right-to-left layout.**

## Screenshots

<p><img src="https://raw.githubusercontent.com/rakanki911/DLSS5-Swapper/7415065e5c5437441d0e0b0a0362d0ada6d86e15/docs/screenshots/02-games.png" alt="Games" width="100%"></p>
<p><img src="https://raw.githubusercontent.com/rakanki911/DLSS5-Swapper/7415065e5c5437441d0e0b0a0362d0ada6d86e15/docs/screenshots/03-library.png" alt="Library" width="100%"></p>
<p><img src="https://raw.githubusercontent.com/rakanki911/DLSS5-Swapper/7415065e5c5437441d0e0b0a0362d0ada6d86e15/docs/screenshots/04-game.png" alt="Game details" width="100%"></p>

## Before installing

- **Anti-cheat:** red warning and optional confirmation, not a blanket block. Injection can cause crashes or account bans; the app never bypasses anti-cheat.
- **Requirements:** Feeder needs Visual C++ runtimes (x64, plus x86 for 32-bit games). Some components download on first use.
- **Compatibility is not guaranteed.** Keep backups; existing mods may conflict. Not every reported game crash is fixed.
- **Linux/Proton:** experimental source support only; no Linux binaries in this release.

## Support

DLSS 5 Swapper is free and MIT licensed. If it saved you an evening of
fiddling, you can buy me a coffee.

<p><a href="https://buymeacoffee.com/rakanki911"><img height="44" src="https://cdn.buymeacoffee.com/buttons/v2/lato-yellow.png" alt="Buy me a coffee"></a></p>

## Credits

Parts of the emulator profile table and Vulkan/Feeder installation model were
adapted from [DLSS5-Autopilot](https://github.com/Kizzuwatnaa/DLSS5-Autopilot).
The OptiScaler DLSS-NR route uses the pinned
[DLSS Unlocked](https://github.com/ShyVortex/dlss-unlocked) OptiScaler package.
The optional Pre-SR Multipass OptiScaler route uses
[OptiScaler-DLSSNR-PreSR-Multipass](https://github.com/wilsjo2/OptiScaler-DLSSNR-PreSR-Multipass)
by wilsjo2.
The optional DLSSNR Cost Scaler route uses
[DLSSNR-Cost-Scaler](https://github.com/xenmods/DLSSNR-Cost-Scaler)
by xenmods for the DLSS-NR proxy, companion add-on, and resolution-cost
scaling controls.
Thanks to An0sTheGreat for the standalone
[DLSS 5 Super Anus Manual](https://github.com/An0sTheGreat/DLSS-5-Super-Anus-Manual)
add-on research, documentation, and release notes around RenoDX DLSS neural
rendering workflows.
Optional RTX 40 Multi Frame Generation support uses
[Universal RTXMFG](https://github.com/dashdogy/RTX40MFG-Unlock), downloaded on
demand and checksum-verified for native 64-bit games with existing DLSS Frame
Generation.
See [Third-party credits and licences](THIRD_PARTY_NOTICES.md) for the full
licences and attribution notices.

---

Built by **Rakan Alkhaldi** · MIT · [Third-party credits and licences](THIRD_PARTY_NOTICES.md)
