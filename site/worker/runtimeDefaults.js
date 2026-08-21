/**
 * site/worker/runtimeDefaults.js -- what this deployment believes its defaults
 * are, and how a malformed one is handled.
 * Purpose: what this deployment believes its defaults are, and how a malformed
 *   environment variable is handled without failing the deployment.
 *
 * The worker cannot fail a deployment at startup, so a bad environment variable
 * cannot be turned into a hard error the way `server/config.js` does locally.
 * The rule here is the next best thing: never let a malformed value masquerade
 * as a deliberate configuration -- fall back to the documented default and say
 * so in the worker log.
 */

import {
  SUPPORTED_MODES,
  DEFAULT_OBSERVER_FACTION_ID,
  INITIATIVE_DISPLAY_NAME
} from '../shared/constants.mjs';
import { DEFAULT_CAMPAIGN_KEY } from '../shared/apiSurface.mjs';
import { isPositiveIntegerId, stripControlCharacters } from '../shared/requestValidation.mjs';
import { asset } from './assets.js';

export const HOSTED_MODES = SUPPORTED_MODES;

/**
 * Strict positive-integer parsing. `Number(x) || fallback` accepted a typo in
 * a deployment variable and silently answered about the default faction. The
 * worker cannot fail a deployment at startup -- refusing every request over a
 * misconfigured variable would be worse than serving the documented default --
 * so a malformed value is reported to the worker log instead of hidden.
 *
 * The accept/reject rule itself is `shared/requestValidation.mjs`'s, the same
 * one the local server applies to an observer id.
 */
export const positiveIntegerOr = (value, fallback, label) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const raw = String(value).trim();
  if (!isPositiveIntegerId(raw)) {
    // The value can come from a query string, so it is truncated and stripped
    // of control characters before it reaches the log: a caller must not be
    // able to forge log lines or flood them.
    const safe = stripControlCharacters(raw).slice(0, 40);
    console.warn(`[Worker] Ignoring malformed ${label}='${safe}'; falling back to ${fallback}.`);
    return fallback;
  }
  return Number(raw);
};

export const readRuntimeDefaults = async (env, request) => {
  const fallback = {
    campaignKey: env?.SUPABASE_CAMPAIGN_KEY || DEFAULT_CAMPAIGN_KEY,
    defaultObserverFactionId: positiveIntegerOr(
      env?.SUPABASE_OBSERVER_FACTION_ID,
      DEFAULT_OBSERVER_FACTION_ID,
      'SUPABASE_OBSERVER_FACTION_ID'
    ),
    defaultObserverFactionName: INITIATIVE_DISPLAY_NAME,
    defaultMode: 'player',
    supportedModes: Array.from(HOSTED_MODES)
  };
  try {
    const response = await asset(env, request, '/data/runtime-config.json');
    if (response.ok) return { ...fallback, ...(await response.json()) };
  } catch (error) {
    // A source worker without a generated static bundle uses the safe fallback.
  }
  return fallback;
};
