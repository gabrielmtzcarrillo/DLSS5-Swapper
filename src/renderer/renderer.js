'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const { t, setLang, getLang, dirOf, LANGS } = window.i18n;
const state = { games: [], recents: [], newDlss: null, log: [], theme: 'light', lang: 'en', logo: {}, groupGamesByStore: true };
const filters = { query: '', api: 'all', dlss: 'all', addon: 'all' };
const gameFilters = window.gameFilters;

const ORDER = ['Steam', 'Epic Games', 'GOG', 'Added by hand', 'My folders'];
const rank = (l) => (ORDER.indexOf(l) === -1 ? ORDER.length : ORDER.indexOf(l));
const short = (v) => (v ? String(v).replace(/\.0$/, '') : null);
const initials = (name) =>
  name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

const ICON = {
  exe: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  dlss: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-6 4 12 2.5-6h5"/></svg>',
  detect: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5-8 4.5-8-4.5z"/><path d="M4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/></svg>',
  addon: '<svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v4"/><path d="M4 10V6a2 2 0 0 1 2-2h4"/><rect x="4" y="12" width="8" height="8" rx="2"/><path d="M16 12v8m4-4h-8"/></svg>'
};

// ---------------- log ----------------

// Under ten megabytes a whole number rounds a 0.4 MB add-on down to "0 MB".
const MB = (bytes) => {
  const mb = bytes / 1048576;
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
};

function log(message) {
  state.log.push({ t: new Date().toLocaleTimeString('en-GB'), m: message });
  renderLog();
}

function renderLog() {
  $('copyLog').disabled = state.log.length === 0;
  $('log').innerHTML = state.log.length
    ? state.log.slice(-40).map((e) => `<div class="log-row"><i></i><span class="t">[${e.t}]</span><span class="m">${esc(e.m)}</span></div>`).join('')
    : `<p class="empty">${t('logEmpty')}</p>`;
  $('log').scrollTop = $('log').scrollHeight;
}

let copyFeedbackTimer;
async function copyText(text) {
  let ok = false;
  try { ok = Boolean(text.trim()) && await window.lab.copyText(text); } catch { /* Show an actionable error. */ }
  const feedback = $('copyFeedback');
  clearTimeout(copyFeedbackTimer);
  feedback.textContent = t(ok ? 'copied' : 'copyFailed');
  feedback.classList.remove('hidden');
  copyFeedbackTimer = setTimeout(() => feedback.classList.add('hidden'), ok ? 2200 : 6000);
  return ok;
}

function setStatus(text, percent) {
  $('statusText').textContent = text;
  if (percent !== undefined) $('statusBar').style.width = Math.round(percent) + '%';
}

// ---------------- views ----------------

function show(view) {
  for (const s of document.querySelectorAll('.view')) s.classList.toggle('active', s.id === 'view-' + view);
  for (const b of document.querySelectorAll('.nav-item')) b.classList.toggle('active', b.dataset.view === view);
  if (view === 'settings') renderSettings();
}

for (const link of document.querySelectorAll('[data-project]')) {
  link.addEventListener('click', async event => {
    event.preventDefault();
    let ok = false;
    try { ok = await window.lab.openProject(link.dataset.project); } catch {}
    $('projectLinkError').classList.toggle('hidden', Boolean(ok));
  });
}

// ---------------- recent game ----------------

function tile(icon, key, value, sub, on) {
  return `<div class="tile">${icon}<div><div class="k">${key}</div><div class="v${on ? ' on' : ''}">${esc(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div></div>`;
}

// "2 min ago", "1 day ago" - close enough without a date library.
function ago(ts) {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60) return t('agoNow');
  const mins = Math.floor(sec / 60);
  if (mins < 60) return t('agoMin', mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('agoHour', hours);
  const days = Math.floor(hours / 24);
  return t('agoDay', days);
}

// A game counts as done when the add-on is in place and its DLSS matches the
// payload; that is what the pip reports.
function isReady(g) {
  return gameFilters.isInstalled(g, state.newDlss);
}

function renderRecent() {
  const rows = state.recents
    .map((r) => ({ at: r.at, game: state.games.find((g) => g.dir === r.dir) }))
    .filter((r) => r.game)
    .slice(0, 8);

  if (!rows.length) {
    $('recents').innerHTML = `<p class="empty">${t('recentEmpty')}</p>`;
    return;
  }

  $('recents').innerHTML = rows.map(({ at, game }) => `
    <article class="rcard" data-dir="${esc(game.dir)}" tabindex="0" aria-label="${esc(game.name)}" aria-haspopup="menu">
      ${game.poster ? `<img src="${game.poster.url}" alt="">` : `<div class="initials">${esc(initials(game.name))}</div>`}
      <div class="meta">
        <div class="title">${esc(game.name)}</div>
        <div class="when"><span class="ago">${ago(at)}</span><i class="pip${isReady(game) ? ' on' : ''}"></i></div>
      </div>
    </article>`).join('');
}

// Why a folder cannot be patched. These arrive from the scanner as codes, and
// a card was literally showing "no-graphics-exe" to the reader. An unknown code
// falls through as itself so a new one is visible rather than silently blank.
const REASONS = {
  installer: 'rInstaller',
  'no-exe': 'rNoExe',
  'no-graphics-exe': 'rNoGraphics',
  'xbox-protected': 'rXboxProtected',
  error: 'rError'
};
const reasonText = (code) => (code ? (REASONS[code] ? t(REASONS[code]) : code) : null);

// ---------------- games grid ----------------

function cardMarkup(g) {
  const s = g.cached;
  const api = s ? (s.api || reasonText(s.reason) || '—') : t('scanning');
  const dx12 = Boolean(s && s.dx12);
  const hasDlss = gameFilters.hasDlss(g);
  const status = s && s.ok
    ? `<span class="dot-s ${hasDlss ? 'on' : ''}"></span>${s.dlss ? esc(short(s.dlss)) : t(hasDlss ? 'hasDlss' : 'noDlss')}
       <span class="dot-s ${s.addon || s.optiscaler ? 'on' : ''}" style="margin-inline-start:8px"></span>${s.optiscaler ? 'OptiScaler' : t('addonShort')}`
    : '';
  const strip = status ? `<div class="status">${status}</div>` : '';
  const poster = g.poster
    ? `<div class="poster${g.poster.tall ? '' : ' wide'}"${g.poster.tall ? '' : ` style="--bgimg:url('${g.poster.url}')"`}>
         <img src="${g.poster.url}" alt="">${strip}</div>`
    : `<div class="poster"><div class="placeholder">${initials(g.name)}</div>${strip}</div>`;

  return `
    <article class="card${dx12 ? ' dx12' : ''}${s && !s.ok ? ' unsupported' : ''}" data-dir="${esc(g.dir)}" tabindex="0" aria-label="${esc(g.name)}" aria-haspopup="menu">
      <div class="tools">
        <button class="tool" data-act="poster" title="${esc(t('menuPoster'))}">🖼</button>
        <button class="tool" data-act="open" title="${esc(t('menuOpen'))}">📂</button>
        <button class="tool" data-act="hide" title="${esc(t('menuHide'))}">✕</button>
      </div>
      <span class="badge${dx12 ? ' dx12' : ''}">${esc(api)}</span>
      ${poster}
      <div class="name">${esc(g.name)}</div>
    </article>`;
}

function fillFilter(id, options, selected) {
  const element = $(id);
  // Don't reset native dropdowns on every scan/art update or keystroke.
  const markup = options.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if (element._optionsMarkup !== markup) {
    element.innerHTML = markup;
    element._optionsMarkup = markup;
  }
  element.value = selected;
}

function renderGameFilters() {
  $('gameSearch').placeholder = t('searchGamesHint');
  const apis = [
    ['all', t('allApis')], ['dx11-dx12', 'DirectX 11 / 12'],
    ...['DirectX 12', 'DirectX 11', 'DirectX 10', 'DirectX 9', 'DirectX 8', 'Vulkan', 'OpenGL'].map((api) => [api, api]),
    ['no-graphics-exe', t('rNoGraphics')], ['no-exe', t('rNoExe')],
    ['pending', t('scanning')]
  ];
  for (const game of state.games) {
    const api = gameFilters.apiKey(game);
    if (!apis.some(([value]) => value === api)) apis.push([api, reasonText(game.cached?.reason) || game.cached?.api || t('unknownApi')]);
  }
  if (!apis.some(([value]) => value === filters.api)) apis.push([filters.api, reasonText(filters.api)]);
  fillFilter('gameApi', apis, filters.api);

  const versions = gameFilters.versions(state.games);
  if (filters.dlss.startsWith('version:') && !versions.includes(filters.dlss.slice(8))) versions.push(filters.dlss.slice(8));
  fillFilter('gameDlss', [
    ['all', t('allDlss')], ['ready', t('filterReady')],
    ['present', t('hasDlss')], ['absent', t('noDlss')],
    ['installed', t('dlssCurrent')], ...versions.map((v) => ['version:' + v, 'DLSS ' + v])
  ], filters.dlss);
  fillFilter('gameAddon', [
    ['all', t('allAddons')], ['present', t('addonPresent')], ['absent', t('addonAbsent')]
  ], filters.addon);
  $('clearGameFilters').disabled = !filters.query && ['api', 'dlss', 'addon'].every((key) => filters[key] === 'all');
  const quick = [
    ['api', 'DirectX 12', t('dx12Count', state.games.filter((g) => gameFilters.apiKey(g) === 'DirectX 12').length)],
    ['dlss', 'ready', t('readyFor', state.games.filter(gameFilters.canInstall).length)],
    ['dlss', 'present', t('dlssCount', state.games.filter(gameFilters.hasDlss).length)]
  ];
  const chips = $('gameQuickFilters');
  if (!chips.children.length) {
    chips.innerHTML = quick.map(() => '<button type="button" class="filter-chip"></button>').join('');
  }
  quick.forEach(([key, value, label], index) => {
    const chip = chips.children[index];
    chip.dataset.filter = key;
    chip.dataset.value = value;
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(filters[key] === value));
  });
}

function renderGames() {
  const focusedGroup = document.activeElement?.dataset.readyFilter;
  renderGameFilters();
  const visible = state.games.filter((g) => gameFilters.matches(g, filters, state.newDlss));
  let sections;
  if (state.groupGamesByStore) {
    const groups = new Map();
    for (const game of visible) {
      if (!groups.has(game.launcher)) groups.set(game.launcher, []);
      groups.get(game.launcher).push(game);
    }
    sections = [...groups].sort((a, b) => rank(a[0]) - rank(b[0]));
  } else {
    // Sort only the filtered copy. Keep each game's source and the stored
    // library intact so switching categories back on restores its sections.
    const byName = new Intl.Collator(state.lang, { numeric: true, sensitivity: 'base' });
    visible.sort((a, b) => byName.compare(a.name, b.name));
    sections = visible.length ? [[null, visible]] : [];
  }

  $('groups').innerHTML = sections
    .map(([launcher, list]) => {
      if (launcher === null) return `<div class="grid">${list.map(cardMarkup).join('')}</div>`;
      const ready = list.filter(gameFilters.canInstall).length;
      return `<section class="group">
        <div class="group-head"><h4>${esc(launcher)}</h4><span class="count">${list.length}</span>
        <button type="button" class="ready filter-chip" data-ready-filter="${esc(launcher)}" aria-pressed="${filters.dlss === 'ready'}">${t('readyFor', ready)}</button></div>
        <div class="grid">${list.map(cardMarkup).join('')}</div>
      </section>`;
    }).join('') || `<div class="glass games-empty"><h4>${t('noMatchingGames')}</h4><p>${t('changeFilters')}</p></div>`;

  $('gamesCount').textContent = t('filteredCount', visible.length, state.games.length);
  if (focusedGroup !== undefined) {
    [...$('groups').querySelectorAll('[data-ready-filter]')]
      .find((button) => button.dataset.readyFilter === focusedGroup)?.focus({ preventScroll: true });
  }
}

$('gameSearch').oninput = (event) => { filters.query = event.target.value; renderGames(); };
for (const [id, key] of [['gameApi', 'api'], ['gameDlss', 'dlss'], ['gameAddon', 'addon']]) {
  $(id).onchange = (event) => { filters[key] = event.target.value; renderGames(); };
}
$('clearGameFilters').onclick = () => {
  Object.assign(filters, { query: '', api: 'all', dlss: 'all', addon: 'all' });
  $('gameSearch').value = '';
  renderGames();
  $('gameSearch').focus();
};
$('gameQuickFilters').onclick = (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  const { filter, value } = button.dataset;
  filters[filter] = filters[filter] === value ? 'all' : value;
  renderGames();
};

// Named scales read as a scale plus what brings the frame back up; a custom
// percentage keeps the same shape so the menu stays one list.
function feedScaleLabel(preset) {
  const named = { native: 'feedScaleNative', quality: 'feedScaleQuality', balanced: 'feedScaleBalanced' }[preset.id];
  return named ? t(named) : t('feedScaleCustom', preset.resolution);
}

async function renderSettings() {
  const info = await window.lab.settings();
  $('settings').innerHTML = `
    <div class="set-row"><div><label class="k" for="setDgVoodooVersion">${t('setDgVoodooVersion')}</label>
      <div class="v" id="setDgVoodooHint">${t('setDgVoodooHint')}</div></div>
      <select class="ghost sm" id="setDgVoodooVersion" aria-describedby="setDgVoodooHint">
        ${info.dgVoodooVersions.map(version => `<option value="${esc(version)}" ${version === info.dgVoodooVersion ? 'selected' : ''}>v${esc(version)}</option>`).join('')}
      </select></div>
    <div class="set-row"><div><label class="k" for="setFeederVersion">${t('setFeederVersion')}</label>
      <div class="v" id="setFeederHint">${t('setFeederHint')}</div></div>
      <select class="ghost sm" id="setFeederVersion" aria-describedby="setFeederHint">
        ${info.feederVersions.map(version => `<option value="${esc(version)}" ${version === info.feederVersion ? 'selected' : ''}>v${esc(version)}</option>`).join('')}
      </select></div>
    <div class="set-row"><div><label class="k" for="setFeedScale">${t('setFeedScale')}</label>
      <div class="v" id="setFeedScaleHint">${t('setFeedScaleHint')}</div></div>
      <span>
        <select class="ghost sm" id="setFeedScale" aria-describedby="setFeedScaleHint">
          ${info.feedScalePresets.map(preset => `<option value="${esc(preset.id)}"${preset.id === info.feedScale.id ? ' selected' : ''}>${esc(feedScaleLabel(preset))}</option>`).join('')}
          <option value="custom"${info.feedScale.id === 'custom' ? ' selected' : ''}>${esc(t('feedScaleCustom', info.feedScale.resolution))}</option>
        </select>
        <input class="ghost sm" id="setFeedScaleCustom" type="number" inputmode="numeric"
          min="${info.feedScaleRange.min}" max="${info.feedScaleRange.max}" step="1"
          value="${info.feedScale.resolution}" aria-label="${t('feedScaleCustomLabel')}"
          ${info.feedScale.id === 'custom' ? '' : 'hidden'}>
      </span></div>
    <div class="set-row"><div><div class="k">${t('setGroupGames')}</div>
      <div class="v" id="setGroupGamesHint">${t('setGroupGamesHint')}</div></div>
      <button class="setting-switch" id="setGroupGames" type="button" role="switch"
        aria-checked="${info.groupGamesByStore !== false}" aria-label="${t('setGroupGames')}" aria-describedby="setGroupGamesHint">
        <span class="knob"></span>
      </button></div>
    <div class="set-row"><div><div class="k">${t('setAutoScan')}</div>
      <div class="v">${t('setAutoScanHint')}</div></div>
      <button class="setting-switch" id="setAutoScan" type="button" role="switch"
        aria-checked="${info.autoScanDrives ? 'true' : 'false'}" aria-label="${t('setAutoScan')}">
        <span class="knob"></span>
      </button></div>
    <div class="set-row"><div><div class="k">${t('setRoots')}</div>${
        (info.roots || []).length
          ? `<div class="paths">${info.roots.map((f) => `
              <div class="path-row"><span>${esc(f)}</span>
                <button class="drop" data-unroot="${esc(f)}" title="${t('addonRemove')}">
                  <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
                </button></div>`).join('')}</div>`
          : `<div class="v">—</div>`}</div>
      <span class="d">${(info.roots || []).length}</span></div>
    <div class="set-row"><div><div class="k">${t('setFolders')}</div>
        ${info.folders.length
          ? `<div class="paths">${info.folders.map((f) => `
              <div class="path-row"><span>${esc(f)}</span>
                <button class="drop" data-unfolder="${esc(f)}" title="${t('addonRemove')}">
                  <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
                </button></div>`).join('')}</div>`
          : `<div class="v">—</div>`}
      </div>
      <button class="ghost sm" id="setAddFolder">${t('setAdd')}</button></div>
    <div class="set-row"><div><div class="k">${t('dlssSourcesTitle')}</div>
        ${(info.dlssSources || []).length
          ? `<div class="paths">${info.dlssSources.map((s) => `
              <div class="path-row"><span>${esc(s.path)}${s.invalid ? ` ${esc(t('dlssSourceUnavailable'))}` : s.version ? ` (v${esc(s.version)})` : ''}</span>
                <button class="drop" data-undlsssource="${esc(s.path)}" title="${t('addonRemove')}">
                  <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
                </button></div>`).join('')}</div>`
          : `<div class="v">${t('dlssSourcesHint')}</div>`}
      </div>
      <button class="ghost sm" id="setAddDlssSource">${t('setAdd')}</button></div>
    <div class="set-row"><div><div class="k">${t('setHidden')}</div>
        ${(info.hidden || []).length
          ? `<div class="paths">${info.hidden.map((f) => `
              <div class="path-row"><span>${esc(f)}</span>
                <button class="ghost sm" data-unhide="${esc(f)}">${t('setUnhide')}</button>
              </div>`).join('')}</div>`
          : `<div class="v">${t('setHiddenNone')}</div>`}
      </div>
      <span class="d">${(info.hidden || []).length}</span></div>
    <div class="set-row"><div><div class="k">${t('setLibrary')}</div><div class="v">${esc(info.stateFile)}</div></div>
      <button class="ghost sm" id="setReset">${t('setReset')}</button></div>
    <div class="set-row"><div><div class="k">${t('setPosters')}</div><div class="v">${esc(info.posterDir)}</div></div>
      <span class="d">${t('setSaved', info.posterCount)}</span></div>`;
  $('setDgVoodooVersion').onchange = async () => {
    const select = $('setDgVoodooVersion');
    select.disabled = true;
    try {
      info.dgVoodooVersion = await window.lab.setDgVoodooVersion(select.value);
    } catch (error) {
      select.value = info.dgVoodooVersion;
      log(error.message);
    } finally {
      select.disabled = false;
    }
  };
  const feedScaleSelect = $('setFeedScale');
  const feedScaleCustom = $('setFeedScaleCustom');
  const saveFeedScale = async (choice) => {
    feedScaleSelect.disabled = true;
    feedScaleCustom.disabled = true;
    try {
      info.feedScale = await window.lab.setFeedScale(choice);
      feedScaleSelect.value = info.feedScale.id;
      feedScaleCustom.value = info.feedScale.resolution;
    } catch {
      feedScaleSelect.value = info.feedScale.id;
      feedScaleCustom.value = info.feedScale.resolution;
      log(t('errFeedScale'));
    } finally {
      feedScaleSelect.disabled = false;
      feedScaleCustom.disabled = false;
      feedScaleCustom.hidden = feedScaleSelect.value !== 'custom';
    }
  };
  feedScaleSelect.onchange = () => {
    if (feedScaleSelect.value !== 'custom') return saveFeedScale(feedScaleSelect.value);
    feedScaleCustom.hidden = false;
    feedScaleCustom.focus();
    return undefined;
  };
  // `change` on a number input fires on blur or Enter, so a half-typed
  // percentage is never saved and clamped back under the person's cursor.
  feedScaleCustom.onchange = () => saveFeedScale({
    id: 'custom', resolution: Number(feedScaleCustom.value), upscale: 2
  });
  $('setFeederVersion').onchange = async () => {
    const select = $('setFeederVersion');
    select.disabled = true;
    try { info.feederVersion = await window.lab.setFeederVersion(select.value); }
    catch (error) { select.value = info.feederVersion; log(error.message); }
    finally { select.disabled = false; }
  };
  $('setGroupGames').onclick = async () => {
    const toggle = $('setGroupGames');
    const enabled = toggle.getAttribute('aria-checked') !== 'true';
    toggle.disabled = true;
    try {
      state.groupGamesByStore = await window.lab.setGroupGamesByStore(enabled);
      toggle.setAttribute('aria-checked', String(state.groupGamesByStore));
      renderGames(); // Presentation only: no discovery, rescan or filter reset.
    } catch (error) {
      log(error.message);
    } finally {
      toggle.disabled = false;
    }
  };
  $('setAutoScan').onclick = async () => {
    const toggle = $('setAutoScan');
    const enabled = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.disabled = true;
    await window.lab.setAutoScanDrives(enabled);
    await load();
    await renderSettings();
  };
  $('setAddFolder').onclick = async () => { if (await window.lab.addFolder()) load(); };
  $('setAddDlssSource').onclick = async () => {
    const button = $('setAddDlssSource');
    button.disabled = true;
    try {
      const result = await window.lab.dlssSourceAdd();
      if (result && result.error === 'invalid') log(t('dlssSourceInvalid'));
      else if (result) renderSettings();
    } finally {
      button.disabled = false;
    }
  };
  for (const b of $('settings').querySelectorAll('[data-undlsssource]')) {
    b.onclick = async () => {
      b.disabled = true;
      await window.lab.dlssSourceRemove(b.dataset.undlsssource);
      renderSettings();
    };
  }
  for (const b of $('settings').querySelectorAll('[data-unroot]')) {
    b.onclick = async () => {
      b.disabled = true;
      await window.lab.excludeRoot(b.dataset.unroot);
      renderSettings();
      load();
    };
  }
  // Hiding a game is only about the list, so it has to be reversible.
  for (const b of $('settings').querySelectorAll('[data-unhide]')) {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await window.lab.unhide(b.dataset.unhide);
        renderSettings();
        load();
      } catch (error) { log(error.message); b.disabled = false; }
    };
  }
  // A folder added for a quick look has to be removable, or the library is
  // stuck with it.
  for (const b of $('settings').querySelectorAll('[data-unfolder]')) {
    b.onclick = async () => {
      b.disabled = true;
      await window.lab.removeFolder(b.dataset.unfolder);
      renderSettings();
      load();
    };
  }
  $('setReset').onclick = async () => { await window.lab.reset(); load(); };
}

// ---------------- loading ----------------

async function scanAll() {
  const pending = state.games.filter((g) => !g.cached);
  let scanned = state.games.length - pending.length;
  for (const game of pending) {
    game.cached = await window.lab.scan(game.dir);
    setStatus(t('scanning'), (++scanned / state.games.length) * 100);
    renderGames();
    renderRecent();
  }
  setStatus(t('ready'), 100);
  log(t('libReady', state.games.length, state.games.filter((g) => g.cached && g.cached.dx12).length));
  fetchArt();
}

// Art is pulled for the whole grid rather than only when a game is opened, so
// the library fills in on its own. Steam's store is rate limited, so this walks
// one at a time and each result is cached on disk for next launch.
async function fetchArt() {
  if (!state.art) return;
  const missing = state.games.filter((g) => !g.poster || !g.poster.tall);
  if (!missing.length) return;

  let done = 0;
  setStatus(t('fetchingArt'), 0);
  for (const game of missing) {
    const art = await window.lab.artFetch(game.dir, game.name, game.appid);
    if (art && art.cover) {
      game.poster = { url: art.cover, tall: true, custom: false };
      renderGames();
      renderRecent();
    }
    setStatus(t('fetchingArt'), (++done / missing.length) * 100);
  }
  setStatus(t('ready'), 100);
  log(t('artFound', missing.filter((g) => g.poster && g.poster.tall).length, missing.length));
}

async function load() {
  setStatus(t('scanning'), 5);
  state.games = await window.lab.library();
  state.recents = await window.lab.recents();
  state.newDlss = (await window.lab.details(state.games[0] ? state.games[0].dir : '')).newDlss;
  renderGames();
  renderRecent();
  log(`Found ${state.games.length} games across ${new Set(state.games.map((g) => g.launcher)).size} sources`);
  await scanAll();
}

async function pickGame(dir) {
  log(`Scanning: ${dir}`);
  const cached = await window.lab.scan(dir);
  let game = state.games.find((g) => g.dir === dir);
  if (!game) {
    await window.lab.addGameByPath(dir);
    state.games = await window.lab.library();
    game = state.games.find((g) => g.dir === dir);
  }
  if (game) {
    game.cached = cached;
    renderGames();
    log(`Game: ${cached.exe || '—'} (${cached.api || 'unknown'})`);
    openSheet(dir);
  }
}


// ---------------- game sheet ----------------

let sheetGame = null;
let sheetDetails = null;
let jobLines = [];
let jobRunning = false;
// Which executable the sheet is pointed at, kept per folder so re-rendering
// the sheet - a language switch does that - does not silently reset the choice.
const exeChoice = new Map();
const routeChoice = new Map();
const dgVoodooVersionChoice = new Map();
const optiscalerVersionChoice = new Map();
const nativeAddonChoice = new Map();
const multiFrameGenerationChoice = new Map();
const mfgVersionChoice = new Map();
const dlssSourceChoice = new Map();
const additionalEffectsChoice = new Map();
const RESHADE_EFFECTS = [
  ['standard', 'ReShade standard effects', 'General-purpose color, sharpening, depth and utility effects.'],
  ['sweetfx', 'SweetFX', 'Classic color grading, sharpening, bloom and film-style adjustments.'],
  ['quint', 'qUINT', 'Advanced screen-space effects such as ambient occlusion, reflections and bloom.'],
  ['astrayfx', 'AstrayFX', 'Stylized and cinematic effects for creative looks and atmosphere.'],
  ['immerse', 'iMMERSE', 'Modern post-processing effects focused on image quality and cinematic presentation.']
];
const reshadeEffectChoices = new Map();

// One row per fact, in a single panel. A wrapping grid of bordered tiles left
// an orphan on its own line whenever the count was odd, and repeated the same
// border and background six times over.
function spec(k, valueHtml, tone, full) {
  return `<div class="spec"><span class="k">${k}</span>` +
    `<span class="v${tone ? ' ' + tone : ''}"${full ? ` title="${esc(full)}"` : ''}>${valueHtml}</span></div>`;
}

// "3.7.20.0 -> 310.8.0.0" says what the swap does in one line; two separate
// rows made the reader hold one number in their head to compare it with the
// other. Nothing to change means no arrow at all.
function dlssValue(have, next, upToDate) {
  if (!next) return `<span>${esc(have || '—')}</span>`;
  if (upToDate) return `<span class="on">${esc(next)}</span>`;
  return `<span class="was">${esc(have || t('none'))}</span>` +
    `<span class="arrow">→</span><span class="on">${esc(next)}</span>`;
}

// An executable whose renderer could not be read says so, rather than showing
// the word null where an API belongs.
const exeLine = (e) => `${e.rel}  —  ${e.apiLabel || t('unknownApi')}  —  ${e.bitness || '?'}-bit  —  ${MB(e.size)}`;

function chosenExe(d, dir) {
  const want = exeChoice.get(dir);
  return d.exes.find((e) => e.path === want) || d.exes[0] || null;
}

// One executable is not a choice, so the control only appears when the folder
// really does hold more than one - a launcher plus the game, most often.
function exePicker(d, dir) {
  if (d.exes.length < 2) return '';
  const chosen = chosenExe(d, dir);
  return `
    <div class="exe-field">
      <div class="k">${t('fExe')}</div>
      <div class="exe-wrap">
        <button type="button" class="exe-select" id="exeSelect" aria-haspopup="listbox" aria-expanded="false">
          <span class="exe-value">${esc(exeLine(chosen))}</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="exe-menu hidden" id="exeMenu" role="listbox">
          ${d.exes.map((e) => `
            <button type="button" class="exe-option${e.path === chosen.path ? ' selected' : ''}"
                    data-path="${esc(e.path)}" role="option" title="${esc(e.rel)}">
              <span class="tick">${e.path === chosen.path ? '✓' : ''}</span>
              <span class="exe-name">${esc(e.rel)}</span>
              <span class="exe-meta"><span>${esc(e.apiLabel || t('unknownApi'))}</span><span>${e.bitness || '?'}-bit · ${MB(e.size)}</span></span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
}

function selectedApi(pick, dir) {
  return window.renderingApi.resolve(pick, pick?.apiOverride || 'auto');
}

function routesFor(pick) {
  return window.installRoutes.routesFor(window.renderingApi.effective(pick, pick?.apiOverride || 'auto'));
}

function selectedRoute(d, pick, dir) {
  const routes = routesFor(pick);
  const wanted = routeChoice.get(dir);
  if (routes.includes(wanted)) return wanted;
  if (routes.includes(d.recommendedRoute)) return d.recommendedRoute;
  return routes[0];
}

function routeLabel(route) {
  if (route === 'optiscaler') return 'OptiScaler DLSS-NR';
  if (route === 'optiscaler-multipass') return 'OptiScaler Pre-SR Multipass';
  if (route === 'optiscaler-fsr') return 'OptiScaler FSR 4.1.1';
  if (route === 'optiscaler-fsr-hybrid') return 'OptiScaler DLSS-NR + FSR 4.1.1';
  if (route === 'cost-scaler') return 'DLSSNR Cost Scaler';
  if (route === 'renodx') return 'RenoDX DLSS Tool (multipass)';
  return t(route === 'feeder' ? 'routeFeeder' : 'routeNative');
}

function installLabel(d, pick, dir) {
  const route = pick && selectedRoute(d, pick, dir);
  if (d.installedRoute && route !== d.installedRoute) return t('applyBackend');
  return route === 'optiscaler' || route === 'optiscaler-multipass' || route === 'optiscaler-fsr' || route === 'optiscaler-fsr-hybrid' ? t('installOpti') : t('install');
}

function installOptions(d, pick, dir) {
  const warning = (d.antiCheatWarning || pick?.antiCheatWarning)
    ? `<div class="emu-note anti-cheat-warning" role="alert"><b>${t('antiCheatWarningTitle')}</b><span>${t('antiCheatWarning')}</span></div>` : '';
  if (!pick) return warning;
  const api = selectedApi(pick, dir);
  const route = selectedRoute(d, pick, dir, api.api);
  const routes = routesFor(pick);
  const reShadeRoutes = routes.filter(item => item !== 'optiscaler' && item !== 'optiscaler-multipass' && item !== 'optiscaler-fsr' && item !== 'optiscaler-fsr-hybrid');
  const opti = route === 'optiscaler' || route === 'optiscaler-multipass' || route === 'optiscaler-fsr' || route === 'optiscaler-fsr-hybrid';
  const cost = route === 'cost-scaler';
  const multipassOpti = route === 'optiscaler-multipass';
  const fsrOpti = route === 'optiscaler-fsr';
  const hybridOpti = route === 'optiscaler-fsr-hybrid';
  const optiReason = window.installRoutes.optiReason(window.renderingApi.effective(pick, pick.apiOverride || 'auto'));
  const optiFsrReason = window.installRoutes.optiFsrReason(window.renderingApi.effective(pick, pick.apiOverride || 'auto'));
  const optiFsrHybridReason = window.installRoutes.optiFsrHybridReason(window.renderingApi.effective(pick, pick.apiOverride || 'auto'));
  const legacy = ['d3d8', 'd3d9'].includes(api.api);
  const selectedDgVoodoo = dgVoodooVersionChoice.get(dir) || d.dgVoodooVersion;
  const selectedOptiscaler = optiscalerVersionChoice.get(dir) || d.selectedOptiscalerVersion || d.optiscalerVersion;
  const selectedMfg = mfgVersionChoice.get(dir) || d.mfgVersion;
  const selectedDlssSource = dlssSourceChoice.has(dir) ? dlssSourceChoice.get(dir) : (d.selectedDlssSource || '');
  const componentVersions = [];
  if (legacy) componentVersions.push(`dgVoodoo2 v${selectedDgVoodoo}`);
  if (route === 'optiscaler') componentVersions.push(`DLSS Unlocked OptiScaler v${String(selectedOptiscaler || '').replace(/-dlss-unlocked$/, '')}`);
  if (!opti && route === 'feeder') {
    componentVersions.push(`DLSS5-Feeder v${d.feederVersion}`);
    componentVersions.push(`RenoDX DLSS 5 ${d.renodxVersion ? `v${d.renodxVersion}` : '(version unavailable)'}`);
  }
  const apiField = `<label class="api-field"><span>${t('fApi')}</span><select id="apiChoice" aria-describedby="apiHint">
    <option value="auto"${!pick.apiOverride || pick.apiOverride === 'auto' ? ' selected' : ''}>${esc(t('apiAutomatic', pick.apiLabel || t('unknownApi')))}</option>
    ${window.renderingApi.choices.map(item => `<option value="${item.value}"${pick.apiOverride === item.value ? ' selected' : ''}>${item.label}</option>`).join('')}
    </select></label>`;
  const apiHint = `<div class="emu-note" id="apiHint"><span>${t('apiOverrideHint')}</span>${api.api === 'vulkan' && !opti ? `<span>${t('apiVulkanHint')}</span>` : ''}</div>`;
  // Keep the picker available even when automatic detection yields DX10 or an
  // unsupported renderer. Otherwise the user cannot correct that detection.
  if (!routes.length) return `<div class="install-options">${apiField}</div>${apiHint}<div class="emu-note">${t('unsupportedRendererHint')}</div>${warning}`;
  return `
    <div class="install-options">
      ${apiField}
      <label><span>${t('fBackend')}</span><select id="backendChoice" aria-describedby="backendHint">
        ${reShadeRoutes.length ? `<option value="reshade"${opti ? '' : ' selected'}>${t('backendReShade')}</option>` : ''}
        ${routes.includes('optiscaler') ? `<option value="optiscaler"${route === 'optiscaler' ? ' selected' : ''}>OptiScaler DLSS-NR</option>` : ''}
        ${routes.includes('optiscaler-multipass') ? `<option value="optiscaler-multipass"${multipassOpti ? ' selected' : ''}>OptiScaler Pre-SR Multipass</option>` : ''}
        ${routes.includes('optiscaler-fsr') ? `<option value="optiscaler-fsr"${fsrOpti ? ' selected' : ''}>OptiScaler FSR 4.1.1</option>` : ''}
        ${routes.includes('optiscaler-fsr-hybrid') ? `<option value="optiscaler-fsr-hybrid"${hybridOpti ? ' selected' : ''}>OptiScaler DLSS-NR + FSR 4.1.1</option>` : ''}
      </select></label>
      ${!opti && reShadeRoutes.length ? `<label><span>${t('fRoute')}</span><select id="routeChoice">${reShadeRoutes.map((item) =>
        `<option value="${item}"${item === route ? ' selected' : ''}>${esc(routeLabel(item))}</option>`).join('')}</select></label>
      ` : ''}
      ${!opti && legacy ? `<label><span>${t('setDgVoodooVersion')}</span><select id="installDgVoodooVersion" aria-describedby="installDgVoodooHint">
        ${d.dgVoodooVersions.map(version => `<option value="${esc(version)}"${version === selectedDgVoodoo ? ' selected' : ''}>dgVoodoo2 v${esc(version)}</option>`).join('')}
      </select></label>` : ''}
      ${!opti && route === 'feeder' ? `<label><span>${t('setFeederVersion')}</span><select id="installFeederVersion" aria-describedby="installFeederHint">
        ${d.feederVersions.map(version => `<option value="${esc(version)}"${version === d.feederVersion ? ' selected' : ''}>v${esc(version)}</option>`).join('')}
      </select></label>` : ''}
      ${route === 'optiscaler' && d.optiscalerVersions?.length ? `<label><span>${t('setOptiscalerVersion')}</span><select id="installOptiscalerVersion" aria-describedby="installOptiscalerHint">
        ${d.optiscalerVersions.map(version => `<option value="${esc(version)}"${version === selectedOptiscaler ? ' selected' : ''}>DLSS Unlocked v${esc(version.replace(/-dlss-unlocked$/, ''))}</option>`).join('')}
      </select></label>` : ''}
      ${d.dlssSources?.length > 1 ? `<label><span>${t('setDlssSource')}</span><select id="installDlssSource" aria-describedby="installDlssHint">
        ${d.dlssSources.map(item => `<option value="${esc(item.path || '')}"${(item.path || '') === selectedDlssSource ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}
      </select></label>` : ''}
      ${!opti ? `<fieldset class="effect-options"><legend>${t('additionalEffects')}</legend>${RESHADE_EFFECTS.map(([id, label, description]) => `<label class="check-option"><span><b>${esc(label)}</b><small>${esc(description)}</small></span><input type="checkbox" data-reshade-effect="${id}"${reshadeEffectChoices.get(dir)?.has(id) ? ' checked' : ''}></label>`).join('')}</fieldset>` : ''}
      ${!opti && !cost && route === 'native' && pick.bitness === 64 && d.nativeAddons?.length ? `<label><span>${t('setAddonVersion')}</span><select id="installNativeAddon" aria-describedby="nativeAddonHint">
        ${d.nativeAddons.map(item => `<option value="${esc(item.path)}">${esc(item.label)}${item.downloadable ? ' · download on install' : (item.version && item.label !== `v${item.version}` ? ` · v${esc(item.version)}` : '')}</option>`).join('')}
      </select></label>` : ''}
      ${!opti && !cost && route === 'native' && pick.bitness === 64 && pick.multiFrameGenerationAvailable ? `<label class="check-option"><span>${t('multiFrameGeneration')}</span><input id="multiFrameGeneration" type="checkbox"${multiFrameGenerationChoice.get(dir) ? ' checked' : ''} aria-describedby="multiFrameGenerationHint"></label>` : ''}
      ${!opti && !cost && route === 'native' && pick.bitness === 64 && pick.multiFrameGenerationAvailable && multiFrameGenerationChoice.get(dir) && d.mfgVersions?.length ? `<label><span>${t('setMfgVersion')}</span><select id="installMfgVersion" aria-describedby="installMfgHint">
        ${d.mfgVersions.map(version => `<option value="${esc(version)}"${version === selectedMfg ? ' selected' : ''}>RTX40MFG v${esc(version)}</option>`).join('')}
      </select></label>` : ''}
    </div>
    ${apiHint}
    <div class="emu-note backend-note" id="backendHint"><span>${t(opti ? (hybridOpti ? 'optiFsrHybridHint' : fsrOpti ? 'optiFsrHint' : multipassOpti ? 'optiMultipassHint' : 'optiHint') : cost ? 'costScalerHint' : 'backendHint')}</span>
      ${opti && (hybridOpti ? optiFsrHybridReason : fsrOpti ? optiFsrReason : optiReason) ? `<span>${t(hybridOpti ? optiFsrHybridReason : fsrOpti ? optiFsrReason : optiReason)}</span>` : ''}
      ${route === 'native' ? `<span>${t('nativeEffectsHint')}</span>` : ''}
      ${opti && (api.api === 'vulkan' || api.label === 'DirectX 11') ? `<span>${t('optiBridgeHint')}</span>` : ''}
      ${opti && api.api === 'vulkan' ? `<span>${t('optiVulkanHint')}</span>` : ''}
    </div>
    ${pick.installIssue ? `<div class="emu-note compatibility-warning" role="alert">${t(pick.installIssue)}</div>` : ''}
    ${warning}
    ${d.dlssSources?.length > 1 ? `<div class="emu-note" id="installDlssHint"><span>${t('setDlssHint')}</span></div>` : ''}
    ${legacy ? `<div class="emu-note" id="installDgVoodooHint"><span>${t('setDgVoodooHint')}</span><span>${t('legacyRendererHint')}</span><span>${t('legacyDlssOptionsHint')}</span></div>` : ''}
    ${componentVersions.length ? `<div class="emu-note" id="installComponentsHint"><b>${t('installComponents')}</b>${componentVersions.map(esc).map(value => `<span>${value}</span>`).join('')}</div>` : ''}
    ${!opti && route === 'feeder' ? `<div class="emu-note" id="installFeederHint"><span>${t('setFeederHint')}</span></div>` : ''}
    ${route === 'optiscaler' && d.optiscalerVersions?.length ? `<div class="emu-note" id="installOptiscalerHint"><span>${t('setOptiscalerHint')}</span></div>` : ''}
    ${!opti && !cost && route === 'native' && pick.bitness === 64 && d.nativeAddons?.length ? `<div class="emu-note" id="nativeAddonHint">Select the RenoDX DLSS 5 build to install. Only one is installed at a time.</div>` : ''}
    ${!opti && !cost && route === 'native' && pick.bitness === 64 && pick.multiFrameGenerationAvailable ? `<div class="emu-note" id="multiFrameGenerationHint"><span>${t('multiFrameGenerationHint')}</span></div>` : ''}
    ${!opti && !cost && route === 'native' && pick.bitness === 64 && pick.multiFrameGenerationAvailable && multiFrameGenerationChoice.get(dir) && d.mfgVersions?.length ? `<div class="emu-note" id="installMfgHint"><span>${t('setMfgHint')}</span></div>` : ''}
    ${pick.emulator ? `<div class="emu-note"><b>${esc(pick.emulator.name)} · ${esc(pick.emulator.system)}</b><span>${esc(pick.emulator.hint)}</span><span>${t('emulatorDepthHint')}</span>${pick.emulator.key === 'xenia' ? `<span>${t('xeniaUiHint')}</span>` : ''}</div>` : ''}`;
}

// A newer release exists, said once, in the corner. The link is the same
// allowlisted releases page the About view uses; nothing downloads itself.
async function showUpdateNotice() {
  const link = $('statusUpdate');
  if (!link || !window.lab.checkUpdate) return;
  let answer = null;
  try { answer = await window.lab.checkUpdate(); } catch { return; }
  if (!answer || !answer.newer) return;
  link.textContent = t('updateAvailable', answer.latest);
  link.classList.remove('hidden');
}

function jobLog(line) {
  jobLines.push(line);
  const box = document.querySelector('.job');
  if (box) { box.textContent = jobLines.join('\n'); box.scrollTop = box.scrollHeight; }
  if ($('copyJob')) $('copyJob').disabled = jobLines.length === 0;
}

async function openSheet(dir, keepLog = false) {
  if (jobRunning) return;
  const g = state.games.find((x) => x.dir === dir);
  if (!g) return;
  sheetGame = g;
  if (!keepLog) jobLines = [];

  $('overlay').classList.remove('hidden');
  $('sheet').innerHTML = '<div class="pad" style="color:var(--dim)">Reading the folder…</div>';

  const [d, art, settings] = await Promise.all([
    window.lab.details(dir),
    window.lab.artFetch(dir, g.name, g.appid),
    window.lab.settings()
  ]);
  if (sheetGame !== g) return;
  d.dgVoodooVersions = settings.dgVoodooVersions;
  d.dgVoodooVersion = settings.dgVoodooVersion;
  if (!dgVoodooVersionChoice.has(dir)) dgVoodooVersionChoice.set(dir, d.dgVoodooVersion);
  d.feederVersions = settings.feederVersions;
  d.feederVersion = settings.feederVersion;
  d.optiscalerVersions = d.optiscalerVersions || settings.optiscalerVersions;
  d.optiscalerVersion = settings.optiscalerVersion;
  if (!optiscalerVersionChoice.has(dir)) optiscalerVersionChoice.set(dir, d.selectedOptiscalerVersion || d.optiscalerVersion);
  d.mfgVersions = settings.mfgVersions;
  d.mfgVersion = settings.mfgVersion;
  if (!mfgVersionChoice.has(dir)) mfgVersionChoice.set(dir, d.mfgVersion);
  sheetDetails = d;
  if (!exeChoice.has(dir) && d.installedExe) {
    const installed = d.exes.find((item) => item.rel.toLowerCase() === String(d.installedExe).toLowerCase());
    if (installed) exeChoice.set(dir, installed.path);
  }
  if (!routeChoice.has(dir) && d.installedRoute) routeChoice.set(dir, d.installedRoute);
  if (!dlssSourceChoice.has(dir)) dlssSourceChoice.set(dir, d.selectedDlssSource || '');

  const info = art && !art.error && !art.none ? art : null;
  const cover = (info && info.cover) || (g.poster && g.poster.tall ? g.poster.url : null);
  const hero = (info && info.hero) || (g.poster && !g.poster.tall ? g.poster.url : null);
  const upToDate = Boolean(d.newDlss && d.currentDlss && d.currentDlss.version === d.newDlss);
  // With a picker on screen the executable already has its own row, so the
  // fact tile would only repeat it.
  const pick = chosenExe(d, dir);
  const inGameDlss = (d.currentDlss && d.currentDlss.version) || null;
  const showExeFact = d.exes.length < 2;

  $('sheet').innerHTML = `
    <div class="hero${hero ? '' : ' empty'}">
      ${hero ? `<img src="${hero}" alt="">` : ''}
      <button class="close" id="sheetClose"><svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="sheet-body">
      <div class="head">
        <div class="cover">${cover ? `<img src="${cover}" alt="">` : esc(initials(g.name))}</div>
        <div class="who">
          <h3>${esc(info ? info.name : g.name)}</h3>
          <div class="meta">${[g.launcher, info && info.released, info && info.genres && info.genres.join(', '),
              info && info.rating ? info.rating + '/100' : null].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="path">${esc(g.dir)}</div>
        </div>
      </div>

      ${info && info.summary ? `<p class="summary">${esc(info.summary.slice(0, 260))}${info.summary.length > 260 ? '…' : ''}</p>` : ''}

      ${exePicker(d, dir)}
      ${installOptions(d, pick, dir)}

      <div class="specs">
        ${showExeFact && pick ? spec(t('fExe'), esc(pick.rel.split(/[\/]/).pop()), null, pick.rel) : ''}
        ${pick ? spec(t('fArchitecture'), `${pick.bitness || '?'}-bit`) : ''}
        ${spec(t('fApi'), esc((pick && selectedApi(pick, dir).label) || reasonText(d.reason) || '—'), pick && selectedApi(pick, dir).api === 'dxgi' ? 'on' : 'off')}
        ${spec(t('installedBackend'), esc(d.installedRoute ? routeLabel(d.installedRoute) : t('none')), d.installedRoute ? 'on' : 'off')}
        ${d.installedFeederVersion ? spec(t('installedFeederVersion'), `v${esc(d.installedFeederVersion)}`, 'on') : ''}
        ${spec('DLSS', pick && selectedRoute(d, pick, dir) === 'optiscaler' ? esc(inGameDlss || t('none')) : dlssValue(inGameDlss, d.newDlss, upToDate))}
        ${d.optiscaler ? spec('OptiScaler', esc(d.optiscaler.installed ? d.optiscaler.version : t('notInstalled')), d.optiscaler.installed ? 'on' : 'off') : ''}
        ${spec(t('fAddon'), esc(d.addon ? t('installed') : t('notPresent')), d.addon ? 'on' : 'off')}
        ${spec(t('fReShade'), esc(d.reshade.installed
            ? d.reshade.version + (d.reshade.addonSupport ? ' + ' + t('addonShort') : '')
            : t('notInstalled')), d.reshade.installed ? 'on' : 'off')}
      </div>

      ${d.files.length ? `<div class="filelist">${d.files.map((f) =>
        `<div class="filerow"><span class="f">${esc(f.rel)}</span><span class="v">${esc(f.version || '—')}</span></div>`).join('')}</div>` : ''}

      <div class="sheet-actions">
        <button class="btn-install" id="doInstall"${d.ok && pick && !pick.installIssue && routesFor(pick).length ? '' : ' disabled'}>${installLabel(d, pick, dir)}</button>
        ${d.gamePreset ? `<button class="ghost sm" id="doPreset"${d.gamePreset.available ? '' : ' disabled'}>${t('applyGamePreset')}</button>` : ''}
        <button class="btn-restore" id="doRestore"${d.hasBackup ? '' : ' disabled'}>${t('restore')}</button>
      </div>
      ${d.gamePreset ? `<div class="emu-note"><b>${esc(d.gamePreset.label)}</b><span>${t(d.gamePreset.available ? 'gamePresetHint' : d.gamePreset.sourceExists ? 'gamePresetNeedsMultipass' : 'gamePresetUnavailable')}</span></div>` : ''}
      <div class="job-toolbar"><button class="ghost sm" id="copyJob"${jobLines.length ? '' : ' disabled'}>${t('copyLog')}</button></div>
      <div class="job" id="job" role="status" aria-live="polite">${esc(jobLines.join('\n') || t('jobReady'))}</div>
    </div>`;

  $('sheetClose').onclick = closeSheet;
  $('copyJob').onclick = () => copyText([sheetGame.name, sheetGame.dir, '', ...jobLines].join('\n'));
  wireExePicker(dir);
  const dgVoodooSelect = $('installDgVoodooVersion');
  if (dgVoodooSelect) dgVoodooSelect.onchange = () => dgVoodooVersionChoice.set(dir, dgVoodooSelect.value);
  const feederSelect = $('installFeederVersion');
  if (feederSelect) feederSelect.onchange = async () => {
    document.querySelectorAll('#sheet select, #doInstall, #doRestore, #exeSelect').forEach(e => { e.disabled = true; });
    try { await window.lab.setFeederVersion(feederSelect.value); }
    catch (error) { jobLog(error.message); }
    if (sheetGame?.dir === dir) {
      await openSheet(dir, true);
      $('installFeederVersion')?.focus();
    }
  };
  const optiscalerVersionSelect = $('installOptiscalerVersion');
  if (optiscalerVersionSelect) optiscalerVersionSelect.onchange = async () => {
    const value = optiscalerVersionSelect.value;
    const previous = optiscalerVersionChoice.get(dir) || d.selectedOptiscalerVersion || d.optiscalerVersion;
    optiscalerVersionChoice.set(dir, value);
    optiscalerVersionSelect.disabled = true;
    let result;
    try { result = await window.lab.setOptiscalerBuild(dir, value); }
    catch { result = { ok: false, code: 'errOptiVersionSave' }; }
    if (!result?.ok) {
      optiscalerVersionChoice.set(dir, previous);
      optiscalerVersionSelect.value = previous;
      jobLog(t(result?.code || 'errOptiVersionSave'));
    }
    optiscalerVersionSelect.disabled = false;
  };
  const apiSelect = $('apiChoice');
  if (apiSelect) apiSelect.onchange = async () => {
    const value = apiSelect.value;
    document.querySelectorAll('#sheet select, #doInstall, #doRestore, #exeSelect').forEach(e => { e.disabled = true; });
    let result;
    try { result = await window.lab.setApiOverride(dir, pick.path, value); }
    catch { result = { ok: false, code: 'errApiSave' }; }
    if (!result?.ok) jobLog(t(result?.code || 'errApiSave'));
    if (sheetGame?.dir === dir) {
      await openSheet(dir, true);
      $('apiChoice')?.focus();
    }
  };
  const routeSelect = $('routeChoice');
  if (routeSelect) routeSelect.onchange = () => { routeChoice.set(dir, routeSelect.value); openSheet(dir, true); };
  const nativeAddonSelect = $('installNativeAddon');
  if (nativeAddonSelect) {
    const installed = d.nativeAddons.find((item) =>
      d.addon && String(d.addon).split(/[\\/]/).pop().toLowerCase() === String(item.file).toLowerCase());
    // A sheet can be rebuilt by another setting while it is open. Do not let a
    // stale map entry win over the options that are actually in this select.
    const remembered = nativeAddonChoice.get(dir);
    const current = d.nativeAddons.some((item) => item.path === remembered)
      ? remembered : installed?.path || d.nativeAddons[0]?.path;
    nativeAddonSelect.value = current || '';
    nativeAddonChoice.set(dir, nativeAddonSelect.value);
    nativeAddonSelect.onchange = () => nativeAddonChoice.set(dir, nativeAddonSelect.value);
  }
  const dlssSourceSelect = $('installDlssSource');
  if (dlssSourceSelect) dlssSourceSelect.onchange = async () => {
    const value = dlssSourceSelect.value;
    const previous = dlssSourceChoice.get(dir) || d.selectedDlssSource || '';
    dlssSourceChoice.set(dir, value);
    dlssSourceSelect.disabled = true;
    let result;
    try { result = await window.lab.setDlssSource(dir, value); }
    catch { result = { ok: false, code: 'errDlssSourceSave' }; }
    if (!result?.ok) {
      dlssSourceChoice.set(dir, previous);
      dlssSourceSelect.value = previous;
      jobLog(t(result?.code || 'errDlssSourceSave'));
    }
    dlssSourceSelect.disabled = false;
  };
  const backendSelect = $('backendChoice');
  if (backendSelect) backendSelect.onchange = () => {
    const available = routesFor(pick).filter(route => route !== 'optiscaler' && route !== 'optiscaler-multipass' && route !== 'optiscaler-fsr' && route !== 'optiscaler-fsr-hybrid');
    const previous = available.includes(d.previousReShadeRoute) ? d.previousReShadeRoute : d.recommendedRoute;
    routeChoice.set(dir, backendSelect.value === 'reshade' ? (available.includes(previous) ? previous : available[0]) : backendSelect.value);
    openSheet(dir, true);
  };
  const multiFrameGeneration = $('multiFrameGeneration');
  if (multiFrameGeneration) multiFrameGeneration.onchange = async () => {
    multiFrameGenerationChoice.set(dir, multiFrameGeneration.checked);
    await openSheet(dir, true);
    $('multiFrameGeneration')?.focus();
  };
  const mfgVersionSelect = $('installMfgVersion');
  if (mfgVersionSelect) mfgVersionSelect.onchange = () => mfgVersionChoice.set(dir, mfgVersionSelect.value);
  document.querySelectorAll('[data-reshade-effect]').forEach(input => input.onchange = () => {
    const selected = reshadeEffectChoices.get(dir) || new Set();
    if (input.checked) selected.add(input.dataset.reshadeEffect); else selected.delete(input.dataset.reshadeEffect);
    reshadeEffectChoices.set(dir, selected);
  });
  $('doInstall').onclick = () => runJob('install', dir);
  const presetButton = $('doPreset');
  if (presetButton) presetButton.onclick = () => runJob('preset', dir);
  $('doRestore').onclick = () => runJob('restore', dir);
}

function wireExePicker(dir) {
  const select = $('exeSelect');
  if (!select) return;
  const menu = $('exeMenu');

  select.onclick = (event) => {
    event.stopPropagation();
    const opening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !opening);
    select.classList.toggle('open', opening);
    select.setAttribute('aria-expanded', String(opening));
  };
  menu.onclick = (event) => {
    const option = event.target.closest('.exe-option');
    if (!option) return;
    exeChoice.set(dir, option.dataset.path);
    routeChoice.delete(dir);
    openSheet(dir);
  };
}

async function runJob(kind, dir) {
  if (jobRunning) return;
  jobRunning = true;
  const install = $('doInstall');
  const restoreBtn = $('doRestore');
  const presetBtn = $('doPreset');
  install.disabled = restoreBtn.disabled = true;
  if (presetBtn) presetBtn.disabled = true;
  document.querySelectorAll('#sheet select, #exeSelect, #sheetClose').forEach(e => { e.disabled = true; });
  install.textContent = kind === 'install' ? t('installing') : t('install');
  if (presetBtn) presetBtn.textContent = kind === 'preset' ? t('applying') : t('applyGamePreset');
  jobLines = [];
  jobLog(kind === 'install' ? '--- installing ---' : kind === 'preset' ? '--- applying preset ---' : '--- restoring ---');

  const pick = sheetDetails ? chosenExe(sheetDetails, dir) : null;
  let res;
  try { res = kind === 'install'
    ? await window.lab.install(
      dir,
      exeChoice.get(dir) || null,
      pick ? selectedRoute(sheetDetails, pick, dir) : null,
      pick?.apiOverride || 'auto',
      // Read the control at the moment Install is pressed. The map is only a
      // persistence aid for rerenders; the visible picker is the source of
      // truth for this install.
      $('installNativeAddon')?.value || nativeAddonChoice.get(dir) || null,
      multiFrameGenerationChoice.get(dir) === true,
      reshadeEffectChoices.get(dir) ? [...reshadeEffectChoices.get(dir)] : [],
      $('installDgVoodooVersion')?.value || dgVoodooVersionChoice.get(dir) || null,
      $('installMfgVersion')?.value || mfgVersionChoice.get(dir) || null,
      $('installDlssSource')?.value || dlssSourceChoice.get(dir) || null,
      $('installOptiscalerVersion')?.value || optiscalerVersionChoice.get(dir) || null
    )
    : kind === 'preset'
    ? await window.lab.applyGamePreset(dir)
    : await window.lab.restoreGame(dir);
  } catch (error) { res = { ok: false, message: error.message }; }
  jobRunning = false;
  install.textContent = t('install');
  if (presetBtn) presetBtn.textContent = t('applyGamePreset');

  if (res.ok) {
    jobLog(kind === 'install' || kind === 'preset' ? `done - ${res.replaced} replaced, ${res.added} added` : 'done - originals restored');
    log(`${kind === 'install' ? 'Installed' : kind === 'preset' ? 'Preset applied' : 'Restored'}: ${dir}`);
    // Recent Games tracks what was actually swapped, not what was browsed.
    state.recents = await window.lab.touch(dir);
    renderRecent();
    const g = state.games.find((x) => x.dir === dir);
    if (g) { g.cached = await window.lab.scan(dir); renderGames(); renderRecent(); }
    if (kind === 'restore') routeChoice.delete(dir);
    setTimeout(() => { if (sheetGame?.dir === dir) openSheet(dir, true); }, 400);
  } else {
    const translated = res.code && t(res.code);
    jobLog(res.cancelled ? t('operationCancelled') : 'failed: ' + (translated && translated !== res.code ? translated : (res.message || res.code)));
    if (!res.cancelled && res.message && translated && translated !== res.code && res.message !== res.code) jobLog(res.message);
    install.disabled = false;
    // A failed external ReShade setup can still have changed files. Re-read
    // the manifest so Restore originals becomes available immediately.
    setTimeout(() => { if (sheetGame?.dir === dir) openSheet(dir, true); }, 250);
  }
}

function closeSheet() {
  if (jobRunning) return;
  sheetGame = null;
  sheetDetails = null;
  $('overlay').classList.add('hidden');
}

// ---------------- events ----------------

$('nav').onclick = (e) => {
  const b = e.target.closest('.nav-item');
  if (b) show(b.dataset.view);
};
// The wordmark is black artwork, so the dark theme gets the lifted copy.
function paintBrand() {
  const art = state.theme === 'dark' ? (state.logo.logoDark || state.logo.logo) : state.logo.logo;
  $('brand').innerHTML = art
    ? `<img src="${art}" alt="DLSS 5 Swapper">`
    : '<b style="font-size:19px">DLSS 5 Swapper</b>';
}

// ---------------- language ----------------

function applyLang(code) {
  state.lang = setLang(code);
  document.documentElement.lang = state.lang;
  document.documentElement.dir = dirOf(state.lang);
  $('langLabel').textContent = state.lang.toUpperCase();

  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  // Anything drawn from data has to be rebuilt, not just relabelled.
  renderLog();
  renderRecent();
  renderGames();
  const view = document.querySelector('.view.active');
  if (view && view.id === 'view-settings') renderSettings();
  if (sheetGame) openSheet(sheetGame.dir, true);
}

// With this many languages a plain list is a long scroll, so the menu filters
// as you type. The filter matches the native name, the English name and the
// code, because someone looking for Greek may type any of the three.
function langRows(filter) {
  const q = filter.trim().toLowerCase();
  const rows = q
    ? LANGS.filter((l) => `${l.native} ${l.label} ${l.code}`.toLowerCase().includes(q))
    : LANGS;
  if (!rows.length) return '<div class="lang-none">—</div>';
  return rows.map((l) => `
    <button class="lang-item${l.code === state.lang ? ' active' : ''}" data-lang="${l.code}">
      <span>${l.native}</span><span class="code">${l.code.toUpperCase()}</span>
    </button>`).join('');
}

function buildLangMenu(filter = '') {
  const menu = $('langMenu');
  if (!menu.querySelector('.lang-search')) {
    menu.innerHTML = '<input class="lang-search" type="text" spellcheck="false"><div class="lang-list"></div>';
    const box = menu.querySelector('.lang-search');
    box.oninput = () => { menu.querySelector('.lang-list').innerHTML = langRows(box.value); };
    box.onclick = (e) => e.stopPropagation();
  }
  const box = menu.querySelector('.lang-search');
  box.placeholder = t('setLang') + ' · ' + LANGS.length;
  box.value = filter;
  menu.querySelector('.lang-list').innerHTML = langRows(filter);
  return box;
}

$('langBtn').onclick = (e) => {
  e.stopPropagation();
  const box = buildLangMenu('');
  const menu = $('langMenu');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    box.focus();
    // Keep the current language in view when the list opens unfiltered.
    const active = menu.querySelector('.lang-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
};

$('langMenu').onclick = async (e) => {
  const item = e.target.closest('.lang-item');
  if (!item) return;
  $('langMenu').classList.add('hidden');
  applyLang(item.dataset.lang);
  await window.lab.setLang(state.lang);
};

document.addEventListener('click', () => {
  $('langMenu').classList.add('hidden');
  // The executable menu lives inside the sheet, so it is rebuilt often; look it
  // up each time rather than holding a reference.
  const exeMenu = $('exeMenu');
  if (exeMenu) {
    exeMenu.classList.add('hidden');
    $('exeSelect').classList.remove('open');
    $('exeSelect').setAttribute('aria-expanded', 'false');
  }
});

$('winMin').onclick = () => window.lab.window('minimize');
$('winMax').onclick = () => window.lab.window('maximize');
$('winClose').onclick = () => window.lab.window('close');

window.lab.onWindowState((maximized) => {
  const button = $('winMax');
  const icon = $('winMaxIcon');
  if (!button || !icon) return;
  button.title = maximized ? 'Restore' : 'Maximize';
  button.setAttribute('aria-label', button.title);
  icon.innerHTML = maximized
    ? '<rect x="8" y="5" width="10" height="10"/><path d="M6 9v9h9"/>'
    : '<rect x="6" y="6" width="12" height="12"/>';
});

$('themeBtn').onclick = () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  paintBrand();
  window.lab.setTheme(state.theme);
};

$('browseBtn').onclick = async () => {
  const dir = await window.lab.addGame();
  if (dir) pickGame(dir);
};
$('addGame').onclick = async () => { const d = await window.lab.addGame(); if (d) load(); };
$('addFolder').onclick = async () => { if (await window.lab.addFolder()) load(); };
$('rescan').onclick = async () => {
  for (const g of state.games) g.cached = null;
  await load();
};
$('clearLog').onclick = () => { state.log = []; renderLog(); };
$('copyLog').onclick = () => copyText(state.log.map(e => `[${e.t}] ${e.m}`).join('\n'));

const cardActionsBusy = new Set();
let contextMenuOpen = false;

async function performGameAction(action, dir) {
  if (!['details', 'open', 'copy', 'restore', 'scan', 'poster', 'hide'].includes(action)) return;
  const game = state.games.find(g => g.dir === dir);
  if (!game) return;
  if (!['open', 'copy'].includes(action) && (jobRunning || cardActionsBusy.size)) return;
  if (action === 'copy') return copyText(dir);
  const locksCard = action !== 'open';
  if (locksCard) cardActionsBusy.add(dir);
  try {
    if (action === 'details') {
      await openSheet(dir);
    } else if (action === 'open') {
      const error = await window.lab.open(dir);
      if (error) throw new Error(error);
    } else if (action === 'restore') {
      // The native menu already requested confirmation. Re-read the actual
      // backup before reusing the existing guarded restore/history/log flow.
      await openSheet(dir);
      if (jobRunning || sheetGame !== game) return;
      if (!sheetDetails?.hasBackup) throw new Error(t('menuNoBackup'));
      await runJob('restore', dir);
    } else if (action === 'scan') {
      const scan = await window.lab.scan(dir);
      if (state.games.includes(game)) game.cached = scan;
      renderGames();
      renderRecent();
      log(t('menuScanned', game.name));
    } else if (action === 'poster') {
      const url = await window.lab.setPoster(dir);
      if (url && state.games.includes(game)) {
        game.poster = { url, tall: true, custom: true };
        renderGames();
        renderRecent();
      }
    } else if (action === 'hide') {
      if (!window.confirm(t('hideConfirm', game.name))) return;
      await window.lab.hide(dir);
      state.games = state.games.filter(g => g.dir !== dir);
      renderGames();
      renderRecent();
    }
  } catch (error) {
    log(t('menuActionFailed', game.name, error.message));
  } finally {
    if (locksCard) cardActionsBusy.delete(dir);
  }
}

async function openGameMenu(card, position) {
  if (contextMenuOpen) return;
  const dir = card.dataset.dir;
  if (!state.games.some(game => game.dir === dir)) return;
  contextMenuOpen = true;
  const labels = {
    details: t('menuDetails'), open: t('menuOpen'), copy: t('menuCopyPath'),
    scan: t('menuScan'), poster: t('menuPoster'), restore: t('restore'), hide: t('menuHide'),
    cancel: t('cancel'), confirmRestore: t('menuConfirmRestore'), restoreHint: t('menuRestoreHint')
  };
  try {
    const action = await window.lab.gameMenu(dir, { labels, position, busy: jobRunning || cardActionsBusy.size > 0 });
    if (action) await performGameAction(action, dir);
  } catch (error) {
    log(t('menuActionFailed', card.getAttribute('aria-label'), error.message));
  } finally {
    contextMenuOpen = false;
    // Avoid stealing focus from the game sheet or a confirmation dialog.
    if ($('overlay').classList.contains('hidden') && card.isConnected) card.focus({ preventScroll: true });
  }
}

for (const container of [$('groups'), $('recents')]) {
  container.oncontextmenu = event => {
    const card = event.target.closest('.card, .rcard');
    if (!card) return;
    event.preventDefault();
    return openGameMenu(card, { x: event.clientX, y: event.clientY });
  };
  container.addEventListener('keydown', event => {
    const card = event.target.closest('.card, .rcard');
    if (!card || event.target.closest('button')) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      openGameMenu(card, { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + Math.min(24, rect.height / 2), keyboard: true });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      performGameAction('details', card.dataset.dir);
    }
  });
}

$('groups').onclick = async (event) => {
  if (event.target.closest('[data-ready-filter]')) {
    filters.dlss = filters.dlss === 'ready' ? 'all' : 'ready';
    renderGames();
    return;
  }
  const card = event.target.closest('.card');
  if (!card) return;
  const dir = card.dataset.dir;
  const act = event.target.closest('.tool')?.dataset.act;

  await performGameAction(act || 'details', dir);
};

$('recents').onclick = (e) => {
  const card = e.target.closest('.rcard');
  if (card) return performGameAction('details', card.dataset.dir);
};

$('overlay').onclick = (e) => { if (e.target === $('overlay')) closeSheet(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});
// Most job events are progress markers read as codes. The few that are
// advice for the person are shown in their language instead.
const SPOKEN_JOB_CODES = new Set(['historySaveWarning', 'driverNeuralFault', 'oldShaderCompiler', 'feedVkLayerReady', 'neuralModelKept', 'gamePresetApplied', 'feedScaleApplied']);
window.lab.onJob((e) => jobLog(SPOKEN_JOB_CODES.has(e.code)
  ? t(e.code, ...Object.values(e.params || {}))
  : `${e.code} ${JSON.stringify(e.params)}`));

const zone = $('dropZone');
['dragenter', 'dragover'].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.add('over'); }));
['dragleave', 'drop'].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
zone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const dir = window.lab.pathForFile(f);
  if (dir) pickGame(dir);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

(async () => {
  const boot = await window.lab.boot();
  state.theme = boot.theme || 'light';
  state.groupGamesByStore = boot.groupGamesByStore !== false;
  document.documentElement.dataset.theme = state.theme;
  applyLang(boot.lang || 'en');
  $('statusVersion').textContent = `v${boot.version}`;
  showUpdateNotice();
  state.logo = boot;
  paintBrand();
  state.art = (await window.lab.artStatus()).available;
  // Artwork comes from Steam's public store endpoints, so there is nothing to
  // configure and nothing for the reader to act on.
  renderLog();
  load();
})();
