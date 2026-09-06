'use strict';
const fs = require('node:fs');
const path = require('node:path');

// One bridge attempt and one recovery prompt at a time, including runtime loss.
module.exports = function createOverlayService({ startBridge, showError, userData, version, log = console.error }) {
  let bridge = null, stopped = false, pending = null;
  const diagnosticFile = path.join(userData, 'overlay-bridge-error.json');
  async function recover(initialError) {
    let error = initialError;
    while (!stopped) {
      if (error) {
        bridge?.close(); bridge = null;
        const details = { time: new Date().toISOString(), version, userData,
          stage: error.stage || 'create-bridge', code: error.code || null,
          message: error.message, stack: error.stack, endpoint: error.endpoint, pipeName: error.pipeName };
        let saved = diagnosticFile;
        try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(diagnosticFile, JSON.stringify(details, null, 2)); }
        catch (writeError) { saved = `Could not save diagnostics: ${writeError.message}`; }
        log('Overlay bridge unavailable:', details);
        if (stopped || !await showError(`${JSON.stringify(details, null, 2)}\n\n${saved}`) || stopped) return;
      }
      try {
        bridge = await startBridge({ onFailure: error => {
          // Dispatch after the startup promise has settled.
          setImmediate(() => { if (!stopped) run(error); });
        } });
        if (stopped) { bridge.close(); bridge = null; }
        return;
      } catch (nextError) { error = nextError; }
    }
  }
  function run(error) {
    if (stopped) return Promise.resolve();
    if (bridge && !error) return Promise.resolve();
    if (!pending) pending = recover(error).catch(error => log('Overlay recovery failed:', error)).finally(() => { pending = null; });
    return pending;
  }
  return { start: () => run(), close: () => { stopped = true; bridge?.close(); bridge = null; } };
};
