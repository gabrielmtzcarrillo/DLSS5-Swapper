'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('custom DLSS source choice persists per game and falls back safely when unavailable', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-source-pref-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'Game');
  const exe = path.join(game, 'Game.exe');
  const custom = path.join(root, 'CustomDLSS');
  fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, 'nvngx_dlss.dll'), 'custom');

  const scan = {
    chosen: { rel: 'Game.exe', path: exe, bitness: 64, api: 'dxgi', apiLabel: 'DirectX 11' },
    exeCandidates: [{ rel: 'Game.exe', path: exe, bitness: 64, api: 'dxgi', apiLabel: 'DirectX 11' }],
    dlssFiles: [{ rel: 'nvngx_dlss.dll', name: 'nvngx_dlss.dll', version: '3.7.20' }],
    streamlineFiles: [],
    primaryDlss: { rel: 'nvngx_dlss.dll', version: '3.7.20', bitness: 64 },
    reshade: { installed: false },
    install: null
  };
  const installs = [];
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);

  function launch() {
    const handlers = new Map();
    const stubs = {
      electron: {
        app: {
          setAppUserModelId() {},
          whenReady: () => ({ then() {} }),
          on() {},
          getPath: () => root,
          isPackaged: false
        },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        shell: { openExternal: async () => true },
        dialog: { showMessageBox: async () => ({ response: 1 }) }
      },
      './src/core/scan.js': {
        scanGame: async () => scan,
        scanSource: dir => fs.existsSync(path.join(dir, 'nvngx_dlss.dll'))
          ? { ok: true, dir, payload: [{ name: 'nvngx_dlss.dll' }], dlssVersion: dir === custom ? '9.9.9' : '8.8.8', hasNeuralRendering: true, addon: path.join(dir, 'renodx-dlss5.addon64'), feeder: { ok32: true, ok64: true } }
          : { ok: false }
      },
      './src/core/compatibility': { assertSafeTarget() {}, hasAntiCheat: () => false, targetIssue: () => null },
      './src/core/install-guards': { assertGameClosed: async () => {}, gpuInfo: async () => [], driverNeuralFault: () => false },
      './src/core/runtime-components.js': { missingVCRuntime: () => [], ensureLumenite: async () => null, ensureDgVoodoo: async () => null, DGVOODOO_VERSIONS: [{ version: '2.87.3' }], dgVoodooRelease: () => ({ version: '2.87.3' }) },
      './src/core/backend-manager': {
        readManifest: () => null,
        install: async config => {
          installs.push(config);
          return { version: 1, date: new Date().toISOString(), route: config.route, game: { dir: game, exe: 'Game.exe', api: config.api }, replaced: [], added: [] };
        }
      }
    };
    const context = vm.createContext({ require: name => stubs[name] || realRequire(name), __dirname: path.dirname(main), process, Buffer, console });
    vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
    vm.runInContext(`payload = () => ({ source: { dir: ${JSON.stringify(root)}, payload: [{ name: 'nvngx_dlss.dll' }], dlssVersion: '8.8.8', hasNeuralRendering: true, feeder: { ok32: true, ok64: true } }, reshadeSetup: null });`, context);
    return handlers;
  }

  const event = { sender: { send() {} } };
  let handlers = launch();
  let details = await handlers.get('details')(event, game);
  assert.equal(details.selectedDlssSource, '');
  assert.equal(details.dlssSources.length, 1);
  assert.equal(details.dlssSources[0].version, '8.8.8');

  const stateFile = path.join(root, 'library.json');
  fs.writeFileSync(stateFile, JSON.stringify({ folders: [], excludedRoots: [], manual: [], posters: {}, hidden: [], scans: {}, dlssSources: [{ path: custom, name: 'Custom' }] }));
  handlers = launch();
  details = await handlers.get('details')(event, game);
  assert.equal(details.selectedDlssSource, '');
  assert.equal(details.dlssSources.find(item => item.path === custom).version, '9.9.9');
  assert.equal((await handlers.get('set-dlss-source')(event, game, custom)).ok, true);

  handlers = launch();
  details = await handlers.get('details')(event, game);
  assert.equal(details.selectedDlssSource, custom);
  assert.equal((await handlers.get('install')(event, game, exe, 'native', 'auto', null, false, [], null, null, null)).ok, true);
  assert.equal(installs.at(-1).source.dir, custom);
  assert.equal(installs.at(-1).source.dlssVersion, '9.9.9');

  fs.rmSync(custom, { recursive: true, force: true });
  handlers = launch();
  details = await handlers.get('details')(event, game);
  assert.equal(details.selectedDlssSource, '', 'missing custom source falls back to bundled in the UI');
  assert.equal(details.dlssSources.length, 1, 'unavailable source is not offered for install');
  assert.equal(details.dlssSources[0].path, null);
  assert.equal((await handlers.get('install')(event, game, exe, 'native', 'auto', null, false, [], null, null, null)).ok, true);
  assert.equal(installs.at(-1).source.dir, root);
  assert.equal(installs.at(-1).source.dlssVersion, '8.8.8');

  fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, 'nvngx_dlss.dll'), 'custom');
  handlers = launch();
  assert.equal((await handlers.get('details')(event, game)).selectedDlssSource, custom, 'saved custom source returns when the folder is available again');
  assert.equal((await handlers.get('set-dlss-source')(event, game, '')).ok, true);
  handlers = launch();
  assert.equal((await handlers.get('details')(event, game)).selectedDlssSource, '');
});
