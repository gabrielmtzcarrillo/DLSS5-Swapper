'use strict';

// Keep the sheet and installer on the same compatibility policy. A copied
// nvngx DLL alone does not prove that the game has native NGX calls.
(function (root) {
  function nativeDlssPresent(scan) {
    const file = scan.primaryDlss;
    if (!file) return false;
    const rel = file.rel.replace(/\\/g, '/').toLowerCase();
    return !((scan.install && scan.install.added) || []).some(item => item.replace(/\\/g, '/').toLowerCase() === rel);
  }
  function optiReason(target, api = target && target.api) {
    if (!target || target.bitness !== 64 || target.emulator) return 'optiUnsupported';
    if (!['dxgi', 'vulkan'].includes(api) || target.apiLabel === 'DirectX 10') return 'optiUnsupported';
    if (!target.hasNativeDlss) return 'optiNeedsDlss';
    return null;
  }
  function optiFsrReason(target, api = target && target.api) {
    if (!target || target.bitness !== 64 || target.emulator) return 'optiFsrUnsupported';
    if (!['dxgi', 'vulkan'].includes(api) || target.apiLabel === 'DirectX 10') return 'optiFsrUnsupported';
    return null;
  }
  function optiFsrHybridReason(target, api = target && target.api) {
    if (!target || target.bitness !== 64 || target.emulator) return 'optiFsrHybridUnsupported';
    if (!['dxgi', 'vulkan'].includes(api) || target.apiLabel === 'DirectX 10') return 'optiFsrHybridUnsupported';
    if (!target.hasNativeDlss) return 'optiNeedsDlss';
    return null;
  }
  function costScalerReason(target, api = target && target.api) {
    if (!target || target.bitness !== 64 || target.emulator) return 'costScalerUnsupported';
    if (api !== 'dxgi' || target.apiLabel !== 'DirectX 12') return 'costScalerUnsupported';
    if (!target.hasNativeDlss) return 'optiNeedsDlss';
    return null;
  }
  function routesFor(target, api = target && target.api) {
    if (!target || ![32, 64].includes(target.bitness)) return [];
    if (api === 'd3d8' || api === 'ddraw') return target.bitness === 32 ? ['feeder'] : [];
    // DX10 is supported by Feeder's private D3D11 relay. It uses the same
    // ReShade/DXGI deployment as DX11, but never qualifies for OptiScaler.
    if (api === 'd3d10') return target.bitness === 32 ? ['feeder'] : [];
    if (['d3d9', 'opengl', 'vulkan'].includes(api)) {
      const routes = !optiReason(target, api) ? ['feeder', 'optiscaler', 'optiscaler-multipass'] : ['feeder'];
      if (!optiFsrReason(target, api)) routes.push('optiscaler-fsr');
      if (!optiFsrHybridReason(target, api)) routes.push('optiscaler-fsr-hybrid');
      if (api === 'd3d9' && target.bitness === 64 && !target.emulator && target.multipassAvailable === true) routes.push('renodx');
      return routes;
    }
    if (api !== 'dxgi') return [];
    if (target.apiLabel === 'DirectX 10') return target.bitness === 32 ? ['feeder'] : [];
    const routes = target.bitness === 32 || target.emulator || target.apiLabel !== 'DirectX 12' ? ['feeder'] : ['native', 'feeder'];
    if (!optiReason(target, api)) routes.push('optiscaler', 'optiscaler-multipass');
    if (!optiFsrReason(target, api)) routes.push('optiscaler-fsr');
    if (!optiFsrHybridReason(target, api)) routes.push('optiscaler-fsr-hybrid');
    if (!costScalerReason(target, api)) routes.push('cost-scaler');
    if (target.bitness === 64 && !target.emulator && target.multipassAvailable === true) routes.push('renodx');
    return routes;
  }
  function recommendedRoute(scan, target = scan.chosen) {
    const routes = routesFor(target);
    const nativeDlss = nativeDlssPresent(scan);
    const wanted = scan.install && scan.install.route === 'feeder'
      ? 'feeder' : nativeDlss ? 'native' : 'feeder';
    return routes.includes(wanted) ? wanted : (routes[0] || null);
  }
  const api = { routesFor, recommendedRoute, nativeDlssPresent, optiReason, optiFsrReason, optiFsrHybridReason, costScalerReason };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.installRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
