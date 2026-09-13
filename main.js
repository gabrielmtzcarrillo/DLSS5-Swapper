'use strict';
// DLSS 5 Swapper
// Finds the games already on the machine and installs DLSS 5 Neural
// Rendering into them, using the scanners in src/core.
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const { scanGame } = require('./src/core/scan.js');
const { discover, folder, dedupe, isInside, steam } = require('./src/library');
const { contextForSteamGame, createSetupRunner } = require('./src/core/proton');
const art = require('./src/steamart');
const { backupRoot } = require('./src/core/apply.js');
const { scanSource } = require('./src/core/scan.js');
const feederReleases = require('./src/core/feeder-release.js');
const FEEDER_VERSIONS = Array.isArray(feederReleases.VERSIONS) ? feederReleases.VERSIONS : [feederReleases];
const pe = require('./src/core/pe.js');
const { ensureLumenite, ensureDgVoodoo, missingVCRuntime, DGVOODOO_VERSIONS, dgVoodooRelease } = require('./src/core/runtime-components.js');
const renodxAddon = require('./src/core/renodx-addon');
const RENODX_VERSIONS = Array.isArray(renodxAddon.VERSIONS) ? renodxAddon.VERSIONS : [renodxAddon];
const { cachePath: renodxCachePath, ensureRenodx } = renodxAddon;
// A component that downloaded and verified, then vanished before it could be
// used, is a security tool quarantining it - never the connection. Saying
// "check your connection" there sends people after the wrong thing.
const componentCode = (error, fallback) => (error && error.code === 'componentRemoved' ? 'componentQuarantined' : fallback);
const installRoutes = require('./src/shared/install-routes');
const renderingApi = require('./src/shared/rendering-api');
const { projectUrl } = require('./src/core/project-links');
const optiscaler = require('./src/core/optiscaler');
const rtxmfg = require('./src/core/rtxmfg');
const MFG_VERSIONS = Array.isArray(rtxmfg.VERSIONS) ? rtxmfg.VERSIONS : [rtxmfg];
const backends = require('./src/core/backend-manager');
const journal = require('./src/core/file-journal');
const guards = require('./src/core/install-guards');
const compatibility = require('./src/core/compatibility');
const antiCheatWarning = require('./src/shared/anti-cheat-warning');
const featureI18n = require('./src/shared/feature-i18n');
const featureText = (key, ...args) => featureI18n.t(loadState().lang, key, ...args);
const vulkanLayer = require('./src/core/vulkan-layer');
const { HistoryStore, knownFolders, fromManifests } = require('./src/core/history');
const gameMenu = require('./src/core/game-menu');
let historyStore;
const history = () => historyStore || (historyStore = new HistoryStore(path.join(app.getPath('userData'), 'history.jsonl')));
const gameName = dir => lastGames.find(game => keyFor(game.dir) === keyFor(dir))?.name || path.basename(dir);
function saveOperation(dir, manifest, action, send) {
  try { history().record(dir, manifest, action, gameName(dir)); }
  catch (error) {
    // The game operation succeeded. Report the separate history write failure.
    // HistoryStore retains the row in memory for a later retry.
    send({ code: 'historySaveWarning', params: { error: error.message } });
  }
}

// ---------- add-on builds ----------
// The integrated RenoDX build is always installed and is not presented as an
// optional add-on. Other bundled or user-added builds still appear in the
// Add-ons screen, and an `addons` folder beside the executable remains valid.
function addonFolders() {
  if (!app.isPackaged) return [path.join(__dirname, 'addons')];
  return [
    path.join(process.resourcesPath, 'addons'),
    path.join(path.dirname(app.getPath('exe')), 'addons')
  ];
}

// What each build is, keyed by the hash of its contents so a build keeps its
// description wherever the file is moved or renamed to. The bullet lists are
// the authors' own release notes from the RenoDX Discord, kept verbatim and
// untranslated for the same reason a changelog is: they are a quote, not our
// wording. Anything unrecognised falls back to the folder it sits in.
const KNOWN = {
  // The build that used to ship. Recognised if someone adds it by hand, but
  // it is no longer the one bundled.
  '189efdee6a327833': { name: 'Stable (previous)' },
  // Superseded by the v4.7 that now ships. Kept recognised so a hand-added copy
  // is still named rather than showing up as its folder.
  '0c0a02578d2aadf2': { name: 'v4.6 (previous)' },
  // Bundled RenoDX build.
  '88116071ef689864': {
    name: 'v4.7',
    shipped: true
  }
};

// An add-on's identity is the hash of its contents, and the add-ons page asks
// for it every time it is opened - which meant reading and hashing several
// megabytes per file on each visit. A file is the same file while its path,
// size and modification time are unchanged, so the answer is kept.
const describedFiles = new Map();

function describe(file, label) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = path.resolve(file).toLowerCase();
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const remembered = describedFiles.get(key);
  let id, version, size;
  if (remembered && remembered.stamp === stamp) {
    ({ id, version, size } = remembered);
  } else {
    let buf;
    try { buf = fs.readFileSync(file); } catch { return null; }
    version = pe.getFileVersion(file);
    id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    size = buf.length;
    describedFiles.set(key, { stamp, id, version, size });
  }
  // This former bundled companion duplicates capabilities now provided by the
  // integrated RenoDX and Feeder routes and can conflict when loaded beside
  // them. Hide stale copies left behind by an older installation too.
  if (id === '76e8a0c90a6b99a7') return null;
  const known = KNOWN[id] || {};
  return {
    ...known,
    // Identity is the content, not the path: the same build sits both in the
    // app payload and loose in the project root, and listing it twice would
    // invite someone to "switch" to the build already running.
    id,
    path: file,
    file: path.basename(file),
    label: known.name || label,
    size,
    // A build with no version resource reports 0.0.0.0, which says nothing.
    version: version && version !== '0.0.0.0' ? version : null
  };
}

// The folder a build sits in is the only description we have of it, and it is
// the one the person writing it chose - "RE Engine games", "dx12 dx 11 dx 9".
function addonLibrary() {
  const found = [];
  const seen = new Set();
  const add = (file, label, own) => {
    if (!/\.addon(64)?$/i.test(file)) return;
    const row = describe(file, label);
    if (row && own) {
      row.custom = true;
      // Hand-added builds are listed exactly as given. Nearly every build is
      // called renodx-dlss.addon64 and several share their contents, so
      // matching on either would refuse files the person deliberately picked.
      // Only the path decides, and the row is always theirs to delete.
      row.id = 'custom:' + path.resolve(file).toLowerCase();
      // A hand-added build is described only by what the person typed. It used
      // to fall back on the recognised build's entry, so an add-on named
      // "tajriba" came back wearing somebody else's release notes and warning.
      row.label = own.name || path.basename(path.dirname(file));
      row.notes = own.notes && own.notes.length ? own.notes : null;
      row.warn = own.tag || null;
      row.caution = null;
      row.shipped = false;
    }
    // The payload copy is added first, so it is the one that survives and the
    // list says "shipped with the app" rather than naming a stray folder.
    if (row && !seen.has(row.id)) { seen.add(row.id); found.push(row); }
  };

  const p = payload(true);
  if (p && p.source.addon) add(p.source.addon, null);

  for (const box of addonFolders()) {
    let dropped = [];
    try { dropped = fs.readdirSync(box); } catch { continue; /* no such folder is normal */ }
    for (const f of dropped) add(path.join(box, f), null);
  }

  for (const e of loadState().addonFiles || []) {
    const row = typeof e === 'string' ? { path: e } : e;
    add(row.path, null, {
      custom: true, name: row.name || null, notes: row.notes || null, tag: row.tag || null
    });
  }

  // The shipped build is the base, not a choice, so it is not offered.
  const base = p && path.basename(p.source.addon).toLowerCase();
  const chosen = new Set(enabledAddons());
  return found
    .filter((r) => !r.shipped)
    .map((r) => ({
      ...r,
      active: chosen.has(r.path),
      // Same file name as the base means it overwrites it rather than joining.
      replaces: path.basename(r.path).toLowerCase() === base
    }));
}

// The payload that ships with the app. `raw` skips the add-on override,
// which is how the library finds the shipped build in the first place.
function payload(raw) {
  // Installed, the payload rides along as an extra resource; from source it
  // sits beside main.js.
  for (const dir of [path.join(process.resourcesPath || '', 'payload'), path.join(__dirname, 'payload')]) {
    const selectedFeeder = loadState().feederVersion;
    const probe = scanSource(dir, selectedFeeder);
    if (probe.ok) {
      const setup = fs.readdirSync(dir).find((f) => /^ReShade_Setup_.*_Addon\.exe$/i.test(f));
      // Point at the chosen build instead of copying files around: the payload
      // folder is what a build ships, and switching must not rewrite it.
      // Only a same-named build changes what applySwap installs; a differently
      // named one is copied in afterwards, beside the base.
      if (!raw) {
        const state = loadState();
        const list = state.addons || (state.addon ? [state.addon] : []);
        const base = path.basename(probe.addon).toLowerCase();
        const over = list.find((f) => fs.existsSync(f) && path.basename(f).toLowerCase() === base);
        if (over) probe.addon = over;
      }
      return { source: probe, reshadeSetup: setup ? path.join(dir, setup) : null };
    }
  }
  return null;
}

let win = null;

const stateFile = () => path.join(app.getPath('userData'), 'library.json');
const posterDir = () => path.join(app.getPath('userData'), 'posters');
const keyFor = (dir) => crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
// Bump when scan metadata or detection changes so an old wrong result is not
// kept forever merely because the folder was scanned by an earlier release.
const SCAN_RULES = 7;

// One live object, not a fresh snapshot per call. Every handler used to parse
// the file, hold that copy across an await, and write the whole thing back:
// two scans running at once each wrote their own stale copy, and whichever
// finished last silently dropped the other's result. Sharing the object means
// every write carries everything already known.
let liveState = null;

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* absent or unreadable: start from the defaults below */ }
  // Nothing seeded: the drive sweep finds game libraries on its own, and a
  // path from the machine this was written on means nothing anywhere else.
  return { folders: [], excludedRoots: [], manual: [], posters: {}, hidden: [], scans: {} };
}

// Share state across handlers awaiting I/O; preserve the existing JSON shape.
let cachedState;
let stateWrites = Promise.resolve(true);
let stateGeneration = 0;
function loadState() {
  if (cachedState) return cachedState;
  try {
    cachedState = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    cachedState = { folders: [], excludedRoots: [], manual: [], posters: {}, hidden: [], scans: {} };
  }
  return cachedState;
}

function saveState(state, generation = stateGeneration) {
  // A handler that built its own object still becomes the live one.
  if (state && state !== cachedState) cachedState = state;
  const file = stateFile();
  const json = JSON.stringify(cachedState);
  // Serialize asynchronous writes, replacing the file only when complete.
  stateWrites = stateWrites.then(async () => {
    if (generation !== stateGeneration) return true;
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file + '.tmp', json, 'utf8');
      await fs.promises.rename(file + '.tmp', file);
      return true;
    } catch { return false; }
  });
  return stateWrites;
}

// A choice belongs to one executable, not every launcher in the same folder.
const apiPreferenceKey = (dir, exe) => crypto.createHash('sha256')
  .update(path.resolve(dir).toLowerCase()).update('\0')
  .update(path.relative(dir, exe).toLowerCase()).digest('hex');
function apiPreference(state, dir, exe) {
  const value = state.apiOverrides?.[apiPreferenceKey(dir, exe)];
  return renderingApi.valid(value) ? value : 'auto';
}

// Renderer can only load what it is handed a URL for.
function posterUrl(game, state) {
  const key = keyFor(game.dir);
  const custom = state.posters[key];
  if (custom && fs.existsSync(custom)) return { url: pathToFileURL(custom).href, tall: true, custom: true };
  // Art fetched earlier is already on disk; use it before the
  // launcher's own cache, which is often only a wide header.
  const record = state.art && state.art[key];
  const saved = record?.rules === ART_RULES ? record : null;
  if (saved && saved.cover) return { url: saved.cover, tall: true, custom: false };
  // A game too new for a portrait capsule still has a banner. The grid knows
  // how to show a wide image, which beats falling back to two initials.
  if (saved && saved.hero) return { url: saved.hero, tall: false, custom: false };
  if (game.poster) return { url: pathToFileURL(game.poster.file).href, tall: game.poster.tall, custom: false };
  return null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#05070a',
    icon: path.join(__dirname, 'src', 'renderer', 'icon.png'),
    // The window draws its own title bar, so the frame comes off.
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  const sendWindowState = () => {
    if (typeof win.webContents?.send === 'function') {
      win.webContents.send('window-state', win.isMaximized());
    }
  };
  win.on('maximize', sendWindowState);
  win.on('unmaximize', sendWindowState);
  if (typeof win.webContents?.once === 'function') {
    win.webContents.once('did-finish-load', sendWindowState);
  }
  win.on('closed', () => {
    win = null;
    if (!quitting) app.quit();
  });
}

// Windows groups taskbar entries and attributes shortcuts by this id. Without
// it the window is filed under whatever launched it - "Electron" when run from
// source - instead of under the app.

app.setAppUserModelId('com.rakan.dlss5swapper');

// Opening the app again raises the window that is already running.
//
// The lock is asked for defensively - the IPC handlers in this file are also
// exercised outside Electron, where app is a stand-in that has no such call.
const singleInstance = typeof app.requestSingleInstanceLock === 'function'
  ? app.requestSingleInstanceLock()
  : true;
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}


let quitting = false;

app.whenReady().then(async () => {
  if (!singleInstance) return;
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  stateWrites.finally(() => app.quit());
});

// ---------- library ----------

// The renderer needs a URL for the logo, and it falls back to a drawn mark if
// the file is not there.
ipcMain.handle('boot', () => {
  const state = loadState();
  const asUrl = (name) => {
    const file = path.join(__dirname, 'assets', name);
    return fs.existsSync(file) ? pathToFileURL(file).href : null;
  };
  return {
    version: require('./package.json').version,
    theme: state.theme || 'light',
    lang: state.lang || 'en',
    groupGamesByStore: state.groupGamesByStore !== false,
    logo: asUrl('logo.png'),
    logoDark: asUrl('logo-dark.png')
  };
});

ipcMain.handle('set-lang', async (_event, lang) => {
  const state = loadState();
  state.lang = lang;
  await saveState(state);
  return lang;
});

ipcMain.handle('set-theme', async (_event, theme) => {
  const state = loadState();
  state.theme = theme;
  await saveState(state);
  return theme;
});

// Import legacy backups from known locations only. Do not scan all drives.
ipcMain.handle('history', () => {
  let warning = false;
  const rows = history().list(mutationBusy ? [] : knownFolders(loadState(), lastGames), () => { warning = true; });
  return { rows, warning };
});

ipcMain.handle('copy-text', (_event, text) => {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) return false;
  try { clipboard.writeText(text); return true; } catch { return false; }
});

ipcMain.handle('game-menu', async (event, dir, options) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return null;
  return gameMenu.show({ Menu, dialog, window, dir, name: gameName(dir),
    labels: options?.labels, position: options?.position, busy: mutationBusy || options?.busy === true });
});

ipcMain.handle('settings', () => {
  const state = loadState();
  let posterCount = 0;
  try { posterCount = fs.readdirSync(posterDir()).length; } catch {}
  return {
    folders: state.folders, stateFile: stateFile(), posterDir: posterDir(), posterCount,
    roots: lastRoots,
    dgVoodooVersions: DGVOODOO_VERSIONS.map(item => item.version),
    dgVoodooVersion: dgVoodooRelease(state.dgVoodooVersion).version,
    feederVersions: FEEDER_VERSIONS.map(item => item.version),
    feederVersion: (feederReleases.release ? feederReleases.release(state.feederVersion) : FEEDER_VERSIONS[0]).version,
    mfgVersions: MFG_VERSIONS.map(item => item.version),
    mfgVersion: (rtxmfg.release ? rtxmfg.release() : MFG_VERSIONS[0]).version,
    excludedRoots: state.excludedRoots || [],
    hidden: [...(state.hidden || [])],
    autoScanDrives: state.autoScanDrives === true,
    groupGamesByStore: state.groupGamesByStore !== false
  };
});

ipcMain.handle('set-dgvoodoo-version', async (_event, version) => {
  const selected = dgVoodooRelease(version).version;
  const state = loadState();
  state.dgVoodooVersion = selected;
  await saveState(state);
  return selected;
});

ipcMain.handle('set-feeder-version', async (_event, version) => {
  const selected = FEEDER_VERSIONS.find(item => item.version === version)?.version;
  if (!selected) throw new Error('Unsupported DLSS5-Feeder version');
  const state = loadState();
  state.feederVersion = selected;
  await saveState(state);
  return selected;
});

ipcMain.handle('set-group-games-by-store', async (_event, enabled) => {
  const state = loadState();
  state.groupGamesByStore = enabled === true;
  await saveState(state);
  return state.groupGamesByStore;
});

ipcMain.handle('set-auto-scan-drives', async (_event, enabled) => {
  const state = loadState();
  state.autoScanDrives = enabled === true;
  if (!state.autoScanDrives) lastRoots = [];
  await saveState(state);
  return state.autoScanDrives;
});

// Used when a folder arrives by drop rather than through the picker.
ipcMain.handle('add-game-path', async (_event, dir) => {
  const state = loadState();
  if (fs.existsSync(dir) && !state.manual.includes(dir)) {
    state.manual.push(dir);
    await saveState(state);
  }
  return dir;
});

// The roots found on the drives, kept so Settings can show what was searched
// without paying for the sweep twice.
let lastRoots = [];
let lastGames = [];

ipcMain.handle('library', () => {
  const state = loadState();
  const found = discover(
    state.folders,
    state.autoScanDrives === true,
    state.excludedRoots || []
  );
  lastRoots = found.roots;
  const games = found.games.concat(
    state.manual
      .filter((dir) => fs.existsSync(dir))
      .map((dir) => ({ launcher: 'Added by hand', id: null, name: path.basename(dir), dir, poster: null }))
  );

  const hidden = new Set(state.hidden.map((d) => d.toLowerCase()));
  lastGames = dedupe(games)
    .filter((g) => !hidden.has(path.resolve(g.dir).toLowerCase()))
    .map((g) => ({
      key: keyFor(g.dir),
      launcher: g.launcher,
      // Steam records the app id, so its games never need a name search.
      appid: g.launcher === 'Steam' ? g.id : null,
      name: g.name,
      dir: g.dir,
      poster: posterUrl(g, state),
      // Whatever the last scan found, so cards can render before rescanning.
      cached: state.scans[keyFor(g.dir)] && state.scans[keyFor(g.dir)].rules === SCAN_RULES
        ? state.scans[keyFor(g.dir)]
        : null
    }));
  return lastGames;
});

// Scanning 37 folders takes seconds, so each card asks for its own result and
// the grid fills in as they land.
ipcMain.handle('scan', async (_event, dir) => {
  const state = loadState();
  const generation = stateGeneration;
  const key = keyFor(dir);
  try {
    const scan = await scanGame(dir);
    const dlss = scan.primaryDlss;
    const result = {
      dir,
      ok: Boolean(scan.chosen),
      installable: installRoutes.routesFor(scan.chosen).length > 0,
      api: scan.chosen ? scan.chosen.apiLabel : null,
      bitness: scan.chosen ? scan.chosen.bitness : null,
      dx12: Boolean(scan.chosen && scan.chosen.apiLabel === 'DirectX 12'),
      exe: scan.chosen ? scan.chosen.rel : null,
      reason: scan.emptyReason || null,
      dlss: dlss ? dlss.version : null,
      hasDlss: Boolean(dlss),
      addon: Boolean(scan.addonPresent),
      optiscaler: Boolean(scan.install?.optiscaler?.installed),
      reshade: scan.reshade.installed ? scan.reshade.version : null,
      scannedAt: Date.now(),
      rules: SCAN_RULES
    };
    state.scans = state.scans || {};
    state.scans[key] = result;
    // A reset during discovery invalidates this operation completely. Do not
    // let its late result repopulate the freshly reset library.
    if (generation === stateGeneration) await saveState(state, generation);
    return result;
  } catch (err) {
    return { ok: false, api: null, dx12: false, reason: 'error', error: err.message };
  }
});

// ---------- editing the library ----------

ipcMain.handle('add-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Scan this folder for games' });
  if (res.canceled) return null;
  const state = loadState();
  if (!state.folders.includes(res.filePaths[0])) state.folders.push(res.filePaths[0]);
  state.excludedRoots = (state.excludedRoots || []).filter(
    (root) => path.resolve(root).toLowerCase() !== path.resolve(res.filePaths[0]).toLowerCase()
  );
  await saveState(state);
  return res.filePaths[0];
});

ipcMain.handle('remove-folder', async (_event, dir) => {
  const state = loadState();
  state.folders = state.folders.filter((f) => f !== dir);
  state.excludedRoots = state.excludedRoots || [];
  if (!state.excludedRoots.some((root) => path.resolve(root).toLowerCase() === path.resolve(dir).toLowerCase())) {
    state.excludedRoots.push(dir);
  }
  lastRoots = lastRoots.filter(
    (root) => path.resolve(root).toLowerCase() !== path.resolve(dir).toLowerCase()
  );
  await saveState(state);
  return true;
});

// Auto-discovered roots used to be display-only, so unwanted locations came
// back on every scan. Excluding one removes only its library entries; no file
// or folder on disk is changed.
ipcMain.handle('exclude-root', async (_event, dir) => {
  const state = loadState();
  state.excludedRoots = state.excludedRoots || [];
  if (!state.excludedRoots.some((root) => path.resolve(root).toLowerCase() === path.resolve(dir).toLowerCase())) {
    state.excludedRoots.push(dir);
  }
  state.folders = state.folders.filter(
    (folder) => path.resolve(folder).toLowerCase() !== path.resolve(dir).toLowerCase()
  );
  lastRoots = lastRoots.filter(
    (root) => path.resolve(root).toLowerCase() !== path.resolve(dir).toLowerCase()
  );
  await saveState(state);
  return true;
});

ipcMain.handle('add-game', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Add one game' });
  if (res.canceled) return null;
  const state = loadState();
  if (!state.manual.includes(res.filePaths[0])) state.manual.push(res.filePaths[0]);
  await saveState(state);
  return res.filePaths[0];
});

ipcMain.handle('set-poster', async (_event, dir) => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    title: 'Pick a poster',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  });
  if (res.canceled) return null;

  // Copied into the app's own folder, keyed by path, so renaming the game
  // folder is the only thing that loses it.
  const state = loadState();
  fs.mkdirSync(posterDir(), { recursive: true });
  const dest = path.join(posterDir(), keyFor(dir) + path.extname(res.filePaths[0]));
  fs.copyFileSync(res.filePaths[0], dest);
  state.posters[keyFor(dir)] = dest;
  await saveState(state);
  return pathToFileURL(dest).href;
});

ipcMain.handle('hide', async (_event, dir) => {
  const state = loadState();
  if (!state.hidden.includes(dir)) state.hidden.push(dir);
  await saveState(state);
  return true;
});

// Hiding a game only takes it out of the list, so it has to be possible to
// put it back. Without this the only way out was resetting the whole library.
ipcMain.handle('unhide', (_event, dir) => {
  const state = loadState();
  const wanted = path.resolve(String(dir)).toLowerCase();
  state.hidden = (state.hidden || []).filter((item) => path.resolve(item).toLowerCase() !== wanted);
  saveState(state);
  return true;
});

ipcMain.handle('reset', async () => {
  stateGeneration++;
  cachedState = { folders: [], excludedRoots: [], manual: [], posters: {}, hidden: [], scans: {} };
  const file = stateFile();
  stateWrites = stateWrites.then(async () => {
    try { await fs.promises.unlink(file); } catch {}
    return true;
  });
  return stateWrites;
});

ipcMain.handle('open', (_event, dir) => shell.openPath(dir));
ipcMain.handle('open-project', async (_event, destination) => {
  const url = projectUrl(destination);
  if (!url) return false;
  try { await shell.openExternal(url); return true; } catch { return false; }
});

// The home page lists the last games touched, newest first.
ipcMain.handle('touch', async (_event, dir) => {
  const state = loadState();
  state.recents = [{ dir, at: Date.now() }]
    .concat((state.recents || []).filter((r) => r.dir !== dir))
    .slice(0, 12);
  await saveState(state);
  return state.recents;
});

// Before anything has been installed in this session, the row is filled from
// the backup manifests already sitting in the game folders - real installs
// with real dates rather than an empty shelf.
function recentsFromManifests(state) {
  const latest = new Map();
  for (const row of fromManifests(knownFolders(state, lastGames))) {
    const key = keyFor(row.dir);
    const at = Date.parse(row.date);
    if (!latest.has(key) || latest.get(key).at < at) latest.set(key, { dir: row.dir, at });
  }
  return [...latest.values()].sort((a, b) => b.at - a.at).slice(0, 12);
}

ipcMain.handle('recents', () => {
  const state = loadState();
  const excluded = state.excludedRoots || [];
  const manual = new Set((state.manual || []).map((dir) => path.resolve(dir).toLowerCase()));
  const saved = (state.recents || []).filter((r) =>
    fs.existsSync(r.dir) && (
      manual.has(path.resolve(r.dir).toLowerCase()) || !excluded.some((root) => isInside(r.dir, root))
    )
  );
  return saved.length ? saved : recentsFromManifests(state);
});

// ---------- artwork ----------

// Which builds are switched on. Any number can be, because ReShade loads every
// .addon64 in the folder. `state.addon` was a single path in earlier versions.
function enabledAddons() {
  const state = loadState();
  const list = state.addons || (state.addon ? [state.addon] : []);
  return list.filter((f) => fs.existsSync(f) && describe(f, null));
}

// The one that takes the base's place, if any: same file name means the same
// file on disk, so it lands on top rather than beside it.
function replacementAddon() {
  const p = payload(true);
  if (!p) return null;
  const base = path.basename(p.source.addon).toLowerCase();
  return enabledAddons().find((f) => path.basename(f).toLowerCase() === base) || null;
}

// The rest ride along with the base. Two builds sharing a file name cannot both
// be written, so the first switched on keeps the name.
function companionAddons() {
  const p = payload(true);
  if (!p) return [];
  const taken = new Set([path.basename(p.source.addon).toLowerCase()]);
  const nativeBuildNames = new Set(['renodx-dlss5.addon64', 'renodx-dlss5-v2.5.addon64']);
  const out = [];
  for (const f of enabledAddons()) {
    const name = path.basename(f).toLowerCase();
    if (nativeBuildNames.has(name)) continue;
    if (taken.has(name)) continue;
    taken.add(name);
    out.push(f);
  }
  return out;
}

// RenoDX DLSS 5 builds are intentionally a small, explicit choice. They are
// not interchangeable with arbitrary ReShade add-ons, and loading both
// versions at once can make the neural consumer race itself.
function nativeAddonChoices() {
  const wanted = new Set(['renodx-dlss5.addon64', ...RENODX_VERSIONS.map((item) => item.file.toLowerCase())]);
  const found = [];
  const seenPaths = new Set();
  const seenContent = new Set();
  const add = (file) => {
    if (!file || !wanted.has(path.basename(file).toLowerCase()) || !fs.existsSync(file)) return;
    const resolved = path.resolve(file);
    const key = resolved.toLowerCase();
    if (seenPaths.has(key)) return;
    const row = describe(resolved, null);
    if (!row) return;
    // Identity is the content, not the path: a stale copy left in a different
    // folder by an earlier build must not present the same build twice.
    if (seenContent.has(row.id)) return;
    seenPaths.add(key);
    seenContent.add(row.id);
    // Prefer the human-facing release in a versioned filename (for example
    // renodx-dlss5-v2.5.addon64). The bundled build has its release name in
    // KNOWN, while third-party files can still fall back to their PE version.
    const filenameVersion = path.basename(resolved).match(/-v([^.]|\d.*)\.addon(?:64)?$/i)?.[1] || null;
    found.push({
      path: resolved,
      file: row.file,
      version: filenameVersion || row.version,
      label: filenameVersion ? `v${filenameVersion}` : (row.label || row.file)
    });
  };
  const p = payload(true);
  if (p?.source?.addon) add(p.source.addon);
  for (const box of addonFolders()) {
    let files = [];
    try { files = fs.readdirSync(box); } catch { continue; }
    for (const file of files) add(path.join(box, file));
  }
  for (const entry of loadState().addonFiles || []) add(typeof entry === 'string' ? entry : entry.path);
  for (const item of RENODX_VERSIONS) {
    if (found.some((choice) => choice.file.toLowerCase() === item.file.toLowerCase())) continue;
    found.push({
      path: renodxCachePath(app.getPath('userData'), item.version),
      file: item.file,
      version: item.version,
      label: item.label || `v${item.version}`,
      downloadable: true
    });
  }
  return found;
}

function selectedNativeAddon(file) {
  if (typeof file !== 'string' || !file) return null;
  return nativeAddonChoices().find((choice) => choice.path.toLowerCase() === path.resolve(file).toLowerCase())?.path || null;
}

// The DLSS/Streamline files themselves are never fetched by the app - unlike
// RenoDX or dgVoodoo they are NVIDIA's own binaries with no public release
// feed to pin. A person who already has an alternate build on disk (from a
// different driver package, for example) can point at its folder here and
// pick it per game, the same way a custom RenoDX add-on file is added.
function dlssSourceChoices() {
  const bundled = payload(true);
  const bundledVersion = bundled?.source?.dlssVersion || null;
  const found = [{
    path: null,
    label: bundledVersion ? `Bundled (v${bundledVersion})` : 'Bundled',
    version: bundledVersion,
    bundled: true
  }];
  for (const entry of loadState().dlssSources || []) {
    const row = typeof entry === 'string' ? { path: entry } : entry;
    const name = row.name || path.basename(row.path);
    const probe = fs.existsSync(row.path) ? scanSource(row.path) : { ok: false };
    const version = probe.ok ? probe.dlssVersion : null;
    found.push({
      path: row.path,
      label: version ? `${name} (v${version})` : `${name} (unavailable)`,
      version,
      invalid: !version,
      custom: true
    });
  }
  return found;
}

function selectedDlssSource(dir) {
  if (typeof dir !== 'string' || !dir) return null;
  const choice = dlssSourceChoices().find((item) => item.path && path.resolve(item.path).toLowerCase() === path.resolve(dir).toLowerCase());
  return choice && !choice.invalid ? choice.path : null;
}

// apply.js keeps its own copy of this private to the module, and the same
// thing is needed here for the second add-on placed beside it.
function enableAddon(exeDir, addonName) {
  const ini = path.join(exeDir, 'ReShade.ini');
  if (!fs.existsSync(ini)) return;
  const text = fs.readFileSync(ini, 'utf8');
  const stem = addonName.replace(/\.addon(64)?$/i, '');
  const match = text.match(/^DisabledAddons=(.*)$/m);
  if (match && match[1].toLowerCase().includes(stem.toLowerCase())) {
    fs.writeFileSync(ini, text.replace(/^DisabledAddons=.*$/m, 'DisabledAddons='), 'utf8');
  }
}

ipcMain.handle('window', (_event, action) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'close') win.close();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.handle('addons', () => addonLibrary());

// Switching one on leaves the others alone. The single exception is a build
// that would be written under a name another switched-on build already claims:
// only one file can hold that name, so the older choice steps aside.
ipcMain.handle('addon-toggle', async (_event, file, on) => {
  const state = loadState();
  let list = state.addons || (state.addon ? [state.addon] : []);
  delete state.addon;

  if (!on) {
    list = list.filter((f) => f !== file);
  } else {
    const row = addonLibrary().find((r) => r.path === file);
    if (!row) return { ok: false, message: 'That build is no longer there' };
    const name = path.basename(file).toLowerCase();
    const clash = list.find((f) => f !== file && path.basename(f).toLowerCase() === name);
    list = list.filter((f) => f !== clash && f !== file);
    list.push(file);
    if (clash) {
      state.addons = list; await saveState(state);
      return { ok: true, replaced: path.basename(clash) };
    }
  }
  state.addons = list;
  await saveState(state);
  return { ok: true };
});

// Picking only reports what was chosen; nothing is stored until the dialog in
// the window is filled in and confirmed.
ipcMain.handle('addon-pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Add an add-on build',
    filters: [{ name: 'ReShade add-on', extensions: ['addon64', 'addon'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;

  const file = res.filePaths[0];
  const row = describe(file, null);
  if (!row) return { error: 'unreadable' };
  return {
    path: file,
    file: row.file,
    size: row.size,
    version: row.version,
    // The folder is a better first guess than the file name, which is the same
    // for every build.
    suggestedName: path.basename(path.dirname(file))
  };
});

ipcMain.handle('addon-save', async (_event, entry) => {
  const state = loadState();
  const list = (state.addonFiles || []).map((e) => (typeof e === 'string' ? { path: e } : e));
  state.addonFiles = [
    ...list.filter((e) => e.path !== entry.path),
    {
      path: entry.path,
      name: (entry.name || '').trim() || null,
      tag: (entry.tag || '').trim() || null,
      notes: String(entry.description || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    }
  ];
  await saveState(state);
  return true;
});

ipcMain.handle('addon-remove', async (_event, file) => {
  const state = loadState();
  const list = (state.addonFiles || []).map((e) => (typeof e === 'string' ? { path: e } : e));
  state.addonFiles = list.filter((e) => e.path !== file);
  // Removing the one that was switched on falls back to the built-in add-on.
  state.addons = (state.addons || []).filter((f) => f !== file);
  if (state.addon === file) delete state.addon;
  await saveState(state);
  return true;
});

ipcMain.handle('dlss-sources', () => dlssSourceChoices());

// A single dialog does the picking and the validating: there is nothing to
// confirm afterwards, unlike an add-on build which also takes a name and notes.
ipcMain.handle('dlss-source-add', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Add a DLSS / Streamline build',
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const dir = res.filePaths[0];
  const probe = scanSource(dir);
  if (!probe.ok || !probe.dlssVersion) return { error: 'invalid' };
  const state = loadState();
  const list = (state.dlssSources || []).map((e) => (typeof e === 'string' ? { path: e } : e));
  state.dlssSources = [...list.filter((e) => e.path !== dir), { path: dir, name: path.basename(dir) }];
  await saveState(state);
  return { ok: true };
});

ipcMain.handle('dlss-source-remove', async (_event, dir) => {
  const state = loadState();
  const list = (state.dlssSources || []).map((e) => (typeof e === 'string' ? { path: e } : e));
  state.dlssSources = list.filter((e) => e.path !== dir);
  await saveState(state);
  return true;
});

ipcMain.handle('art-status', () => ({ available: art.available() }));

// Bumped whenever the art picked for a game could change, so folders cached
// under the old rule fetch again instead of keeping a bad banner forever.
const ART_RULES = 4;

ipcMain.handle('art-fetch', async (_event, dir, name, appid) => {
  const state = loadState();
  const key = keyFor(dir);
  const cached = state.art && state.art[key];
  if (cached && cached.rules === ART_RULES) return cached;

  try {
    const hit = await art.look(name, appid);
    if (!hit) return { none: true };

    const dest = path.join(app.getPath('userData'), 'art');
    const record = { ...hit, cover: null, hero: null, rules: ART_RULES, fetchedAt: Date.now() };
    const grab = async (url, suffix) => {
      try { return pathToFileURL(await art.download(url, path.join(dest, key + suffix))).href; }
      catch { return null; }
    };
    record.cover = await grab(hit.coverUrl, '-cover.jpg');
    // A few older apps have no hero image; the store header is the same shape.
    record.hero = await grab(hit.heroUrl, '-hero.jpg');
    if (!record.hero && hit.heroFallbackUrl) record.hero = await grab(hit.heroFallbackUrl, '-hero.jpg');

    state.art = state.art || {};
    state.art[key] = record;
    await saveState(state);
    return record;
  } catch (err) {
    return { error: err.message };
  }
});

// ---------- installing ----------

// Releases move quickly and nothing here updates itself, so someone can sit
// on a build for weeks without knowing. One lookup per launch, no identifiers
// sent, no download started: the answer is a version number and a link the
// person may click. Any failure is silence - this must never delay a start.
let updateAnswer = null;
const releaseTag = /^v?(\d+)\.(\d+)\.(\d+)/;
function newerRelease(current, latest) {
  const a = releaseTag.exec(current), b = releaseTag.exec(latest);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(b[i]) > Number(a[i])) return true;
    if (Number(b[i]) < Number(a[i])) return false;
  }
  return false;
}
ipcMain.handle('update-check', async () => {
  if (updateAnswer) return updateAnswer;
  const current = app.getVersion();
  try {
    const response = await fetch('https://api.github.com/repos/rakanki911/DLSS5-Swapper/releases/latest', {
      headers: { 'User-Agent': `DLSS5-Swapper/${current}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw Error(String(response.status));
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    updateAnswer = { current, latest, newer: newerRelease(current, latest) };
  } catch {
    // Offline, rate-limited or blocked: say nothing rather than worry anyone.
    updateAnswer = { current, latest: null, newer: false };
  }
  return updateAnswer;
});
ipcMain.handle('details', async (_event, dir) => {
  const detailsPayload = payload();
  const multipassAvailable = Boolean(detailsPayload?.source?.feeder?.multipassAddon && fs.existsSync(detailsPayload.source.feeder.multipassAddon));
  const scan = await scanGame(dir);
  const multiFrameGenerationAvailable = Boolean(
    detailsPayload?.source?.payload?.some((file) => /^nvngx_dlssg\.dll$/i.test(file.name)) &&
    scan.dlssFiles.some((file) => /^nvngx_dlssg\.dll$/i.test(file.name))
  );
  const state = loadState();
  const hasNativeDlss = installRoutes.nativeDlssPresent(scan);
  const files = [...scan.dlssFiles, ...scan.streamlineFiles]
    .map((f) => ({ rel: f.rel, name: f.name, version: f.version }));
  return {
    ok: Boolean(scan.chosen),
    reason: scan.chosen ? null : (scan.emptyReason || null),
    exe: scan.chosen ? scan.chosen.rel : null,
    exePath: scan.chosen ? scan.chosen.path : null,
    api: scan.chosen ? scan.chosen.apiLabel : null,
    apiKey: scan.chosen ? scan.chosen.api : null,
    bitness: scan.chosen ? scan.chosen.bitness : null,
    via: scan.chosen ? scan.chosen.via : null,
    emulator: scan.emulator,
    nativeAddons: nativeAddonChoices(),
    dlssSources: dlssSourceChoices().filter((item) => !item.invalid),
    installedRoute: scan.install && scan.install.route,
    installedFeederVersion: scan.install && scan.install.feederVersion,
    antiCheatWarning: compatibility.hasAntiCheat(dir, scan.chosen?.path),
    installedApi: scan.install && scan.install.api,
    installedExe: scan.install && scan.install.exe,
    previousReShadeRoute: scan.install && scan.install.previousReShadeRoute,
    optiscaler: scan.install && scan.install.optiscaler,
    recommendedRoute: installRoutes.recommendedRoute(scan),
    exes: scan.exeCandidates.map((e) => ({
      rel: e.rel, path: e.path, apiLabel: e.apiLabel, api: e.api,
      bitness: e.bitness, size: e.size, via: e.via,
      emulator: e.emulator,
      installIssue: compatibility.targetIssue(dir, e.path),
      antiCheatWarning: compatibility.hasAntiCheat(dir, e.path),
      hasNativeDlss,
      multipassAvailable,
      multiFrameGenerationAvailable,
      apiOverride: apiPreference(state, dir, e.path),
      apiChoices: e.apiChoices || [{ api: e.api, label: e.apiLabel }],
      routes: installRoutes.routesFor({ ...e, hasNativeDlss })
    })),
    files,
    currentDlss: scan.primaryDlss ? {
      rel: scan.primaryDlss.rel,
      version: scan.primaryDlss.version,
      bitness: scan.primaryDlss.bitness
    } : null,
    addon: scan.addonPresent,
    reshade: scan.reshade,
    hasBackup: scan.hasBackup || fs.existsSync(journal.pendingPath(dir)),
    newDlss: detailsPayload && detailsPayload.source ? detailsPayload.source.dlssVersion : null,
    renodxVersion: detailsPayload?.source?.feeder?.hostAddon
      ? pe.getFileVersion(detailsPayload.source.feeder.hostAddon) : null
  };
});

let mutationBusy = false;
ipcMain.handle('set-api-override', async (_event, dir, exePath, value) => {
  if (mutationBusy) return { ok: false, code: 'errJobBusy' };
  if (!renderingApi.valid(value) || typeof dir !== 'string' || !path.isAbsolute(dir) || typeof exePath !== 'string') {
    return { ok: false, code: 'errApiChoice' };
  }
  const scan = await scanGame(dir);
  if (mutationBusy) return { ok: false, code: 'errJobBusy' };
  if (!scan.exeCandidates.some(exe => exe.path === exePath)) return { ok: false, code: 'errApiChoice' };
  const state = loadState();
  state.apiOverrides = state.apiOverrides && typeof state.apiOverrides === 'object' && !Array.isArray(state.apiOverrides)
    ? state.apiOverrides : {};
  const key = apiPreferenceKey(dir, exePath);
  if (value === 'auto') delete state.apiOverrides[key];
  else state.apiOverrides[key] = value;
  return await saveState(state) ? { ok: true } : { ok: false, code: 'errApiSave' };
});
async function exclusiveMutation(work) {
  if (mutationBusy) return { ok: false, code: 'errJobBusy' };
  mutationBusy = true;
  try { return await work(); }
  catch (err) { return { ok: false, code: err.code, message: err.message }; }
  finally { mutationBusy = false; }
}

ipcMain.handle('install', (event, dir, exePath, requestedRoute, requestedApi, requestedAddon, requestedMultiFrameGeneration, requestedEffects, requestedDgVoodooVersion, requestedMfgVersion, requestedDlssSource) => exclusiveMutation(async () => {
  const p = payload();
  if (!p) return {
    ok: false,
    message: app.isPackaged
      ? 'The mod payload is missing or incomplete in this build. Reinstall a complete Swapper package; custom builds must run npm run payload before packaging.'
      : 'The mod payload is missing or incomplete. From the project root, run npm run payload -- "C:\\path\\to\\DLSS5-files" using the folder containing the DLSS 5 runtime and add-on, then retry.'
  };
  const dlssSource = selectedDlssSource(requestedDlssSource);
  if (requestedDlssSource && !dlssSource) return { ok: false, message: 'The selected DLSS build is not available.' };
  if (dlssSource) {
    const altProbe = scanSource(dlssSource);
    p.source.dir = altProbe.dir;
    p.source.payload = altProbe.payload;
    p.source.dlssVersion = altProbe.dlssVersion;
    p.source.hasNeuralRendering = altProbe.hasNeuralRendering;
  }
  const scan = await scanGame(dir);
  if (!scan.chosen) return { ok: false, message: 'No game executable found' };

  // Honour the sheet's choice, but only if it is one of the candidates we
  // actually found - never patch a path the renderer made up.
  const detected = scan.exeCandidates.find((e) => e.path === exePath) || scan.chosen;
  const selection = requestedApi ?? apiPreference(loadState(), dir, detected.path);
  const target = renderingApi.effective(detected, selection);
  target.multipassAvailable = Boolean(p.source?.feeder?.multipassAddon && fs.existsSync(p.source.feeder.multipassAddon));
  compatibility.assertSafeTarget(dir, target.path);
  target.hasNativeDlss = installRoutes.nativeDlssPresent(scan);
  const api = target.api;
  const availableRoutes = installRoutes.routesFor(target, api);
  if (requestedRoute === 'optiscaler' && !availableRoutes.includes('optiscaler')) {
    return { ok: false, code: installRoutes.optiReason(target, api) || 'optiUnsupported' };
  }
  if (!availableRoutes.length) return { ok: false, code: 'unsupportedRendererHint', message: 'This rendering API is not supported. Select the game’s DirectX 11 mode where available.' };
  const recommendedRoute = installRoutes.recommendedRoute(scan, target);
  const route = availableRoutes.includes(requestedRoute) ? requestedRoute
    : (availableRoutes.includes(recommendedRoute) ? recommendedRoute : availableRoutes[0]);
  let selectedAddon = route === 'native' && target.bitness === 64 ? selectedNativeAddon(requestedAddon) : null;
  if (requestedAddon && route === 'native' && target.bitness === 64 && !selectedAddon) {
    return { ok: false, message: 'The selected RenoDX add-on is not available.' };
  }
  const renodxMatch = selectedAddon
    ? RENODX_VERSIONS.find((item) => item.file.toLowerCase() === path.basename(selectedAddon).toLowerCase())
    : null;
  if (renodxMatch) {
    try { selectedAddon = await ensureRenodx(app.getPath('userData'), renodxMatch.version); }
    catch (err) { return { ok: false, code: componentCode(err, 'errAddonDownload'), message: err.message }; }
  }
  if (selectedAddon) p.source.addon = selectedAddon;

  // ReShade Setup is a Windows executable. On Linux, support Windows games
  // launched with Steam Play by using their existing Proton prefix; native
  // Linux games do not load the Windows DLSS/ReShade payload.
  const protonGame = process.platform === 'linux'
    ? steam().find((game) => path.resolve(game.dir) === path.resolve(dir))
    : null;
  const proton = contextForSteamGame(protonGame);
  if (process.platform === 'linux' && !proton) {
    return { ok: false, code: 'errProtonRequired', message: 'This installer supports Windows games launched through Steam Proton. Launch the game once with Proton, then try again.' };
  }
  if (process.platform === 'linux' && api === 'vulkan') {
    return { ok: false, code: 'errLinuxVulkanUnsupported', message: 'The Vulkan Feeder route needs a host Vulkan layer and is not supported on Linux yet. Select a DirectX renderer in the game.' };
  }

  const send = (e) => event.sender.send('job', e);
  await guards.assertGameClosed(dir, target.path);
  if (fs.existsSync(journal.pendingPath(dir))) return { ok: false, code: 'errBackendRecovery' };
  const old = backends.readManifest(dir);
  const changed = old && (old.route !== route || old.game.api !== api || old.game.exe.toLowerCase() !== target.rel.toLowerCase());
  if (changed && (old.game.api === 'vulkan' || api === 'vulkan')) return { ok: false, code: 'errBackendVulkanSwitch' };
  let antiCheatAcknowledged = false;
  if (compatibility.hasAntiCheat(dir, target.path)) {
    const answer = await dialog.showMessageBox(win, antiCheatWarning.dialogOptions(loadState().lang, dir, target.path));
    if (answer.response !== 1) return { ok: false, cancelled: true };
    antiCheatAcknowledged = true;
    send({ code: 'antiCheatRiskAccepted', params: {} });
  }
  // The ReShade and Feeder routes both drive the RenoDX neural consumer, which
  // upstream has measured faulting inside NVIDIA's runtime on a known driver
  // range. Say so before the work starts; it never stops the install.
  if (route === 'native' || route === 'feeder') {
    // Advice only: nothing about reading the driver may decide whether an
    // install runs.
    try {
      const rows = await guards.gpuInfo();
      if (guards.driverNeuralFault(rows)) send({ code: 'driverNeuralFault', params: { gpu: guards.driverNames(rows) } });
    } catch {}
  }

  let optiRoot = null;
  let mfgRoot = null;
  if (requestedMultiFrameGeneration === true && route === 'native') {
    if (target.bitness !== 64 || !scan.dlssFiles.some(file => /^nvngx_dlssg\.dll$/i.test(file.name))) {
      return { ok: false, code: 'errMfgUnsupported' };
    }
    const existingMfgHook = path.join(path.dirname(target.path), 'version.dll');
    const managedMfgHook = (old?.added || []).some(rel => rel.replace(/\\/g, '/').toLowerCase() ===
      path.relative(dir, existingMfgHook).replace(/\\/g, '/').toLowerCase());
    if (fs.existsSync(existingMfgHook) && !managedMfgHook) return { ok: false, code: 'errMfgConflict' };
    try { mfgRoot = await rtxmfg.ensureRTXMFG(app.getPath('userData'), requestedMfgVersion); }
    catch (err) { return { ok: false, code: componentCode(err, 'errMfgDownload'), message: err.message }; }
  }
  if (route === 'optiscaler') {
    optiscaler.checkConflicts(dir, target.path, old, api);
    if (api === 'vulkan' && await vulkanLayer.existing(vulkanLayer.defaultRunner)) return { ok: false, code: 'errOptiVulkanLayer' };
    const gpu = await guards.gpuInfo();
    // Neither the card nor the driver is refused outright any more. Upstream
    // 0.2.0 says plainly that architectures older than Blackwell work with a
    // modded nvngx_dlssnr.dll, which the person supplies themselves - so this
    // is their decision to make, with both facts in front of them.
    const oldCard = gpu ? !guards.gpuModelSupported(gpu) : false;
    const oldDriver = gpu ? !guards.driverSupported(gpu) : false;
    const confirmation = await dialog.showMessageBox(win, {
      type: 'warning', title: 'OptiScaler DLSS-NR',
      message: featureText('optiConfirm'),
      detail: [gpu ? gpu.map(g => `${g.name} — ${g.driver}`).join('\n') : featureText('errOptiHardware'),
        oldCard ? featureText('optiCardOld') : null,
        oldDriver ? featureText('optiDriverOld') : null,
        featureText('optiHint'), featureText('optiBridgeHint'), featureText('backendHint')].filter(Boolean).join('\n\n'),
      buttons: [featureText('installOpti'), featureText('cancel')], defaultId: 1, cancelId: 1
    });
    if (confirmation.response !== 0) return { ok: false, cancelled: true };
    const missing = missingVCRuntime(64, path.dirname(target.path), process.env.SystemRoot, ['msvcp140_atomic_wait.dll']);
    if (missing.length) return { ok: false, code: 'runtimeRequiredHint', message: missing.join(', ') };
    send({ code: 'optiDownloading', params: {} });
    try { optiRoot = await optiscaler.ensureOptiScaler(app.getPath('userData')); }
    catch (err) { return { ok: false, code: componentCode(err, 'errOptiDownload'), message: err.message }; }
    send({ code: 'optiVerified', params: { version: optiscaler.RELEASE.version } });
  }

  // Check before restoring or touching the game: these DLLs are imported by
  // Feeder and its helper. Never report a working installation if absent.
  if (route === 'feeder') {
    if (!p.source.feeder || !(target.bitness === 32 ? p.source.feeder.ok32 : p.source.feeder.ok64)) {
      return { ok: false, message: 'Feeder payload is incomplete or from mixed releases. Reinstall the updated Swapper package.' };
    }
    const checks = [[target.bitness, path.dirname(target.path)]];
    if (target.bitness === 32) checks.push([64, path.join(path.dirname(target.path), 'host64')]);
    for (const [bits, folder] of checks) {
      const missing = missingVCRuntime(bits, folder);
      if (missing.length) {
        const response = await dialog.showMessageBox(win, {
          type: 'warning', title: 'Microsoft Visual C++ Runtime',
          message: featureText('runtimeRequiredHint'),
          detail: `${bits === 32 ? 'x86' : 'x64'}\n${missing.join(', ')}\n${folder}`,
          buttons: [featureText('runtimeDownload'), featureText('cancel')], cancelId: 1, defaultId: 0
        });
        if (response.response === 0) await shell.openExternal(`https://aka.ms/vc14/vc_redist.${bits === 32 ? 'x86' : 'x64'}.exe`);
        return { ok: false, code: 'runtimeRequiredHint' };
      }
    }
    if (api === 'd3d8' || api === 'd3d9') {
      try {
        p.source.feeder.dgVoodooDir = await ensureDgVoodoo(
          app.getPath('userData'), requestedDgVoodooVersion || loadState().dgVoodooVersion
        );
        send({ code: 'legacyWrapperReady', params: { api, bitness: target.bitness } });
      } catch (error) {
        return { ok: false, code: componentCode(error, 'legacyDownloadHint'), message: error.message };
      }
    }
  }

  if (route === 'feeder') {
    try {
      p.source.feeder.lumeniteRoot = await ensureLumenite(app.getPath('userData'));
      send({ code: 'motionProviderReady', params: { provider: 'LumeniteFX Kernel 2.0' } });
    } catch (err) {
      // VORT is bundled under MIT as an offline fallback. The install remains
      // usable even when GitHub is unavailable.
      p.source.feeder.lumeniteRoot = null;
      send({ code: 'motionProviderFallback', params: { error: err.message } });
    }
  }

  // Only user-selected companion builds are installed. Leave unrelated
  // add-ons alone; all managed copies now participate in the transaction.
  const companions = route === 'native' && target.bitness === 64 ? companionAddons() : [];

  try {
    // A game could have been launched while the component download ran.
    await guards.assertGameClosed(dir, target.path);
    // Preserve the previous snapshot before a repeat install changes it.
    history().list([{ dir, name: gameName(dir) }], error => send({ code: 'historySaveWarning', params: { error: error.message } }));
    const manifest = await backends.install({
      gameDir: dir,
      exePath: target.path,
      api,
      apiLabel: target.apiLabel,
      bitness: target.bitness,
      route,
      antiCheatAcknowledged,
      emulator: target.emulator,
      source: p.source,
      optiRoot,
      mfgRoot,
      companions,
      reshadeSetup: p.reshadeSetup,
      setupRunner: proton ? createSetupRunner(proton) : undefined,
      vulkanLayerTarget: path.join(app.getPath('userData'), 'reshade-vulkan'),
      installReShade: true,
      addMissingDlss: true,
      multiFrameGeneration: requestedMultiFrameGeneration === true,
      installAdditionalEffects: Array.isArray(requestedEffects) && requestedEffects.length > 0,
      addStreamline: false,
      upgradeReShade: false
    }, send);
    saveOperation(dir, manifest, 'install', send);
    return { ok: true, replaced: manifest.replaced.length, added: manifest.added.length };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}));

ipcMain.handle('restore', (event, dir) => exclusiveMutation(async () => {
  let restoredManifest = null;
  const send = (e) => {
    if (e.code === 'restoreDone') restoredManifest = e.params;
    event.sender.send('job', e);
  };
  try {
    let old = null;
    try { old = backends.readManifest(dir); } catch (error) { if (!fs.existsSync(journal.pendingPath(dir))) throw error; }
    // Recovery belongs to the manifest/journal, not the graphics scanner.
    // A missing/updated/unrecognised executable must not strand our hooks.
    if (!old && !fs.existsSync(journal.pendingPath(dir))) return { ok: false, code: 'errNoBackup' };
    const exe = old ? journal.safePath(dir, old.game.exe) : null;
    await guards.assertGameClosed(dir, exe);
    history().list([{ dir, name: gameName(dir) }], error => send({ code: 'historySaveWarning', params: { error: error.message } }));
    if (!await backends.restore(dir, send)) return { ok: false, code: 'errNoBackup' };
    saveOperation(dir, restoredManifest || {}, restoredManifest ? 'restore' : 'recovery', send);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}));
