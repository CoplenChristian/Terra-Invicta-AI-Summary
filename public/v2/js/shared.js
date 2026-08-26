/*
 * MISSION CONTROL / SHARED UTILITIES
 * Purpose: the v2 single source of truth for HTML escaping, numeric
 *   formatting, faction lookups, and the space-body to theater map.
 * Single source of truth for HTML escaping, numeric formatting, faction
 * lookups, and the space-body to theater map. Loaded before all components.
 * Exposed as window.MissionControlShared.
 */
(function exposeShared(global) {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function display(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback || '—';
    return escapeHtml(value);
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toFiniteNumber(value) {
    return numberValue(value);
  }

  function formatNumber(value, decimals) {
    const parsed = numberValue(value);
    if (parsed === null) return 'UNAVAILABLE';
    return parsed.toLocaleString(undefined, {
      maximumFractionDigits: decimals === undefined ? 0 : decimals,
      minimumFractionDigits: decimals || 0
    });
  }

  function number(value, decimals) {
    const parsed = numberValue(value);
    if (parsed === null) return '—';
    return parsed.toLocaleString(undefined, {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals || 0
    });
  }

  // Save pin routing (defect #16).
  //
  // Purpose: the single place that appends the ?save=<basename> verification
  //   pin to every save-reading request the v2 front end makes. The
  //   verify_computed_style_baseline.js harness loads the dashboard with
  //   ?save=<name> so the server renders a frozen save while the live game is
  //   running; without the pin the harness would stamp a fingerprint for one
  //   file and the server would render another. One endpoint, the briefing,
  //   used to carry the pin and the other ten did not, so a capture rendered
  //   the pinned save for part of a pass and the live save for the rest.
  //
  //   resolvePinnedSaveName() reads and validates ?save= once on load and
  //   returns the basename or null. withSavePin(url) appends the pin to a URL
  //   string and is a no-op when no pin is set, so the no-pin path is
  //   byte-identical to a dashboard that has never heard of a pin. The fetch
  //   wrapper below routes every request through withSavePin, so forgetting the
  //   pin at a new call site is structurally impossible: a save-reading request
  //   is pinned by default and only a request that explicitly opts out
  //   (excludeSavePin in its init, or one of the non-save routes below)
  //   bypasses it.
  //
  //   Deliberate exclusions, each a stated reason rather than a forgotten
  //   endpoint:
  //     /api/runtime    capability probe; reads no save.
  //     /api/saves      lists save files on disk; reads no save.
  //     /api/save-state newest-save detector; must keep reporting the newest
  //                     file so the "new save available" banner can fire.
  //     /api/publish    ships the newest save to the live site; a verification
  //                     pin silently redirecting a real publish is dangerous.
  //   The post-publish refresh in mission-control.js opts out the same way
  //   (excludeSavePin: true) so the local view shows what was just published,
  //   not the pinned save.
  let __pinnedSaveName = null;
  let __pinnedSaveNameResolved = false;

  function resolvePinnedSaveName() {
    if (__pinnedSaveNameResolved) return __pinnedSaveName;
    __pinnedSaveNameResolved = true;
    try {
      const params = new URLSearchParams(global.location.search || '');
      const name = params.get('save');
      if (!name) return (__pinnedSaveName = null);
      // Mirror server/http/requestValidation.js resolveSavePath: a simple
      // basename with a .gz/.json extension and no path tricks. Refuse here
      // rather than producing a 400 inside a fetch.
      const isSimpleName = name === name.split(/[\\/]/).pop()
        && !name.includes('..')
        && !name.includes('\0');
      if (!isSimpleName || !/\.(?:gz|json)$/i.test(name)) {
        console.warn(`[Mission Control] Ignoring invalid ?save= value '${name}'.`);
        return (__pinnedSaveName = null);
      }
      return (__pinnedSaveName = name);
    } catch (_) {
      return (__pinnedSaveName = null);
    }
  }

  function withSavePin(url) {
    if (typeof url !== 'string' || url.length === 0) return url;
    const pin = resolvePinnedSaveName();
    if (!pin) return url;
    // Avoid double-append if a caller already threaded the pin.
    if (/[?&]save=(?:[^&#]*)/.test(url)) return url;
    return url.indexOf('?') === -1
      ? `${url}?save=${encodeURIComponent(pin)}`
      : `${url}&save=${encodeURIComponent(pin)}`;
  }

  // The routes that describe the runtime rather than a save's contents. These
  // are the documented exclusions; everything else under /api/ is save-reading
  // and is pinned by default.
  const __nonSaveApiRoutes = {
    '/api/runtime': true,
    '/api/saves': true,
    '/api/save-state': true,
    '/api/publish': true
  };

  // The pathname of a URL string, with the query/hash stripped and an absolute
  // URL reduced to its path. The wrapper must recognise a route the same way
  // whether a caller passes a relative path ('/api/v2/briefing?...') or a
  // Request object, whose .url is ALWAYS absolute ('http://host/api/...'); a
  // prefix test against the raw string would miss the latter and silently
  // leave a pinned render unpinned.
  function __pathnameOf(urlString) {
    const markerIndex = urlString.search(/[?#]/);
    const pathAndHost = markerIndex === -1 ? urlString : urlString.slice(0, markerIndex);
    if (pathAndHost.indexOf('://') !== -1) {
      try {
        return new URL(pathAndHost).pathname;
      } catch (_) {
        return pathAndHost;
      }
    }
    return pathAndHost;
  }

  function __shouldPinApiRoute(urlString) {
    const pathname = __pathnameOf(urlString);
    return pathname === '/api'
      || (pathname.indexOf('/api/') === 0 && !__nonSaveApiRoutes[pathname]);
  }

  // The one place every save-reading request is pinned. Installed here, before
  // any component or the shell controller loads, so a fetch in any of them is
  // covered without threading the pin through eleven call sites. Requests that
  // must not be pinned opt out with excludeSavePin: true in their init, which
  // is stripped before the original fetch runs. When no pin is set every input
  // -- string or Request object -- is passed through untouched, so the default
  // path is byte-identical to a dashboard that has never heard of a pin.
  const __originalFetch = global.fetch;
  global.fetch = function __pinnedFetch(input, init) {
    let options = init;
    if (options && options.excludeSavePin === true) {
      options = Object.assign({}, options);
      delete options.excludeSavePin;
    } else if (typeof input === 'string') {
      if (__shouldPinApiRoute(input)) input = withSavePin(input);
    } else if (resolvePinnedSaveName() && typeof global.Request === 'function' && input instanceof global.Request) {
      const url = input.url;
      if (__shouldPinApiRoute(url)) {
        return __originalFetch.call(global, new global.Request(withSavePin(url), input), options);
      }
    }
    return __originalFetch.call(global, input, options);
  };

  function formatGdp(value) {
    const parsed = numberValue(value);
    return parsed === null ? 'UNAVAILABLE' : `$${(parsed / 1e12).toFixed(1)}T`;
  }

  function formatDelta(change) {
    if (!change) return '—';
    const delta = numberValue(change.delta);
    if (delta === null) return '—';
    if (Math.abs(delta) >= 1e9) return `${delta > 0 ? '+' : ''}${(delta / 1e9).toFixed(1)}B`;
    if (Math.abs(delta) >= 1e6) return `${delta > 0 ? '+' : ''}${(delta / 1e6).toFixed(1)}M`;
    return `${delta > 0 ? '+' : ''}${formatNumber(delta, Math.abs(delta) < 10 && !Number.isInteger(delta) ? 1 : 0)}`;
  }

  function money(value) {
    const parsed = numberValue(value);
    if (parsed === null) return '—';
    if (Math.abs(parsed) >= 1000000000000) return '$' + (parsed / 1000000000000).toFixed(2) + 'T';
    if (Math.abs(parsed) >= 1000000000) return '$' + (parsed / 1000000000).toFixed(1) + 'B';
    if (Math.abs(parsed) >= 1000000) return '$' + (parsed / 1000000).toFixed(1) + 'M';
    return '$' + number(parsed, 0);
  }

  const BODY_THEATER_MAP = {
    sol: 'sol', earth: 'sol', luna: 'sol', mars: 'mars', mercury: 'inner', venus: 'inner',
    ceres: 'belt', psyche: 'belt', klotho: 'belt', pallas: 'belt', vesta: 'belt', bienor: 'belt',
    jupiter: 'jupiter', io: 'jupiter', europa: 'jupiter', ganymede: 'jupiter', callisto: 'jupiter', leda: 'jupiter',
    saturn: 'saturn', titan: 'saturn', rhea: 'saturn', dione: 'saturn', tethys: 'saturn', mimas: 'saturn', enceladus: 'saturn', iapetus: 'saturn',
    uranus: 'outer', miranda: 'outer', neptune: 'outer', triton: 'outer', pluto: 'outer', charon: 'outer', quaoar: 'outer', sedna: 'outer', eris: 'outer', makemake: 'outer', haumea: 'outer'
  };

  function bodyKey(body, explicitKey) {
    if (explicitKey) return explicitKey;
    const value = String(body || '').trim().replace(/^\d+\s+/, '').replace(/\s+/g, ' ').toLowerCase();
    return BODY_THEATER_MAP[value] || 'unassigned';
  }

  function bodyLabel(body) {
    const value = String(body || '').trim();
    return value.replace(/^\d+\s+/, '') || 'Unknown body';
  }

  function matchesSpaceTheater(body, theaterKey, explicitTheaterKey) {
    if (!theaterKey) return true;
    if (explicitTheaterKey) return String(explicitTheaterKey) === String(theaterKey);
    return bodyKey(body) === theaterKey;
  }

  function factionById(snapshot, id) {
    return (Array.isArray(snapshot && snapshot.factions) ? snapshot.factions : [])
      .find(faction => String(faction.ID) === String(id)) || null;
  }

  function factionName(snapshot, id) {
    return factionById(snapshot, id) && factionById(snapshot, id).displayName || 'Unknown faction';
  }

  const FACTION_DISPLAY_NAME_TO_TEMPLATE = {
    'the Initiative': 'ExploitCouncil',
    'the Resistance': 'ResistCouncil',
    'Humanity First': 'DestroyCouncil',
    'the Servants': 'SubmitCouncil',
    'the Protectorate': 'AppeaseCouncil',
    'the Academy': 'CooperateCouncil',
    'Project Exodus': 'EscapeCouncil',
    'the Aliens': 'AlienCouncil'
  };

  const FACTION_LOGO_BASE = '/v2/assets/faction-logos/';

  function resolveFactionTemplateName(factionOrTemplateName) {
    if (!factionOrTemplateName) return '';
    if (typeof factionOrTemplateName === 'string') {
      const trimmed = factionOrTemplateName.trim();
      if (/Council$/i.test(trimmed)) return trimmed;
      return FACTION_DISPLAY_NAME_TO_TEMPLATE[trimmed] || '';
    }
    if (typeof factionOrTemplateName === 'object') {
      if (factionOrTemplateName.templateName) return String(factionOrTemplateName.templateName).trim();
      if (factionOrTemplateName.displayName) {
        return FACTION_DISPLAY_NAME_TO_TEMPLATE[String(factionOrTemplateName.displayName).trim()] || '';
      }
    }
    return '';
  }

  function factionLogoUrl(factionOrTemplateName) {
    const templateName = resolveFactionTemplateName(factionOrTemplateName);
    if (!templateName) return '';
    return `${FACTION_LOGO_BASE}${encodeURIComponent(templateName)}.png`;
  }

  function factionLogoImgHtml(factionOrTemplateName, options) {
    const url = factionLogoUrl(factionOrTemplateName);
    if (!url) return '';
    const opts = options || {};
    const className = opts.className || 'faction-logo';
    const width = opts.width;
    const height = opts.height;
    const sizeAttrs = [
      width ? ` width="${escapeHtml(String(width))}"` : '',
      height ? ` height="${escapeHtml(String(height))}"` : ''
    ].join('');
    return `<img src="${escapeHtml(url)}" alt="" aria-hidden="true" class="${escapeHtml(className)}"${sizeAttrs} onerror="this.style.display='none';this.parentElement&&this.parentElement.classList.remove('has-faction-logo');">`;
  }

  function appendFactionLogo(documentRef, parent, faction, className) {
    const url = factionLogoUrl(faction);
    if (!url || !parent) return null;
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    const img = doc.createElement('img');
    img.src = url;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.className = className || 'faction-logo';
    img.addEventListener('error', function onFactionLogoError() {
      img.style.display = 'none';
      parent.classList.remove('has-faction-logo');
    });
    parent.classList.add('has-faction-logo');
    parent.appendChild(img);
    return img;
  }

  global.MissionControlShared = {
    escapeHtml: escapeHtml,
    display: display,
    numberValue: numberValue,
    toFiniteNumber: toFiniteNumber,
    formatNumber: formatNumber,
    number: number,
    formatGdp: formatGdp,
    formatDelta: formatDelta,
    money: money,
    bodyKey: bodyKey,
    bodyLabel: bodyLabel,
    matchesSpaceTheater: matchesSpaceTheater,
    factionById: factionById,
    factionName: factionName,
    factionLogoUrl: factionLogoUrl,
    factionLogoImgHtml: factionLogoImgHtml,
    appendFactionLogo: appendFactionLogo,
    resolvePinnedSaveName: resolvePinnedSaveName,
    withSavePin: withSavePin
  };
})(window);