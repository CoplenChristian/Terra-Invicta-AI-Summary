// server/localization.js
//
// Purpose: read the installed game's localisation files so template-sourced names
//   render as the game shows them, not as the template's internal friendlyName.
//
// WHY THIS EXISTS
// ---------------
// A template's `friendlyName` is a developer-facing label. The name the game puts
// in front of the player lives in a separate file:
//
//   TerraInvicta_Data/StreamingAssets/Localization/en/TIDriveTemplate.en
//     TIDriveTemplate.displayName.NeutronFluxLanternx1=Poseidon Lantern x1
//     TIDriveTemplate.displayName.AdvancedOrionDrivex1=H-Orion Drive
//
// Nothing in this repository read those files, so the dashboard rendered
// "Neutron Flux Lantern x1" and "Advanced Orion Drive x1" -- names the game never
// displays. Measured against the installed 1.0 templates on 2026-08-26, 519
// entries across 18 template families carry a localised name that differs from
// the `friendlyName` beside it. See docs/live-defect-register.md #10.
//
// THE KEY FORMAT
// --------------
//   <TemplateFileBase>.<field>.<dataName>=<value>
//
// Keyed by `dataName`, which is the same identity the template maps are keyed by,
// so no name-matching heuristic is involved. The file base is the template
// filename with the extension swapped (`TIDriveTemplate.json` -> `TIDriveTemplate.en`),
// which holds for every template file the loader reads.
//
// ABSENCE
// -------
// A missing directory, a missing file or a missing key all return `null`, never a
// guess and never the key. The caller falls back to whatever it rendered before,
// and `coverage()` reports how many entries took that path so the gap is a
// number rather than a silence. `effects` in particular are keyed
// `Context.displayName.<context>` rather than by effect `dataName`, so they
// resolve to null here by design -- that is a separate defect with a different
// mechanism, deliberately not folded in.

const fs = require('fs');
const path = require('path');

const DEFAULT_LANGUAGE = 'en';

/** Strip a UTF-8 BOM if the file carries one. The template JSON files do. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * Whitespace-insensitive comparison. The localisation files and the templates
 * disagree on incidental spacing in a handful of entries ("Plasma Battery Mk 1"
 * against "Plasma Battery Mk1"), and those ARE real renames -- but a pure
 * whitespace difference should not be counted as one when reporting divergence.
 */
function normalizeForCompare(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

class LocalizationCatalogue {
  /**
   * @param {string|null} directory - the `Localization/<lang>` directory, or null
   *   when none could be resolved. A null directory is a working catalogue that
   *   resolves everything to null; callers do not branch on availability.
   */
  constructor(directory = null) {
    this.directory = directory || null;
    this.language = directory ? path.basename(directory) : null;
    // fileBase -> Map<dataName, displayName>, or null when the file is absent.
    this.byFile = new Map();
    this.missingFiles = [];
  }

  get available() {
    return Boolean(this.directory) && fs.existsSync(this.directory);
  }

  /**
   * The `displayName` table for one localisation file, loaded on first use.
   * Returns null when the file does not exist or cannot be read -- an absent
   * table is not an empty one, and the distinction is kept for reporting.
   */
  tableFor(fileBase) {
    if (this.byFile.has(fileBase)) return this.byFile.get(fileBase);

    if (!this.directory) {
      this.byFile.set(fileBase, null);
      return null;
    }

    const fullPath = path.join(this.directory, `${fileBase}.en`);
    const localizedPath = this.language && this.language !== DEFAULT_LANGUAGE
      ? path.join(this.directory, `${fileBase}.${this.language}`)
      : fullPath;
    const target = fs.existsSync(localizedPath) ? localizedPath : fullPath;

    if (!fs.existsSync(target)) {
      this.byFile.set(fileBase, null);
      this.missingFiles.push(fileBase);
      return null;
    }

    let table = null;
    try {
      const raw = stripBom(fs.readFileSync(target, 'utf8'));
      table = new Map();
      const prefix = `${fileBase}.displayName.`;
      for (const line of raw.split(/\r?\n/)) {
        if (!line.startsWith(prefix)) continue;
        // Split on the FIRST '=' only: a display name may legitimately contain one.
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(prefix.length, eq);
        const value = line.slice(eq + 1);
        // An empty key or an empty value is not a name. Rendering either would
        // put a blank label on screen where a fallback would have said something.
        if (!key || value === '') continue;
        if (!table.has(key)) table.set(key, value);
      }
    } catch (err) {
      console.warn(`[Localization] Failed reading ${target}: ${err.message}`);
      table = null;
      this.missingFiles.push(fileBase);
    }

    this.byFile.set(fileBase, table);
    return table;
  }

  /**
   * The game's display name for one template entry, or null when the
   * localisation does not carry it.
   *
   * @param {string} fileBase - e.g. 'TIDriveTemplate'
   * @param {string} dataName - the template's `dataName`
   * @returns {string|null}
   */
  lookup(fileBase, dataName) {
    if (!fileBase || !dataName || typeof dataName !== 'string') return null;
    const table = this.tableFor(fileBase);
    if (!table) return null;
    const value = table.get(dataName);
    return typeof value === 'string' && value !== '' ? value : null;
  }

  /** Which localisation files were asked for and could not be read. */
  get unreadableFiles() {
    return [...new Set(this.missingFiles)];
  }
}

/**
 * The localisation directory that sits beside a templates directory.
 *
 * `.../StreamingAssets/Templates` -> `.../StreamingAssets/Localization/<lang>`.
 * Returns null when the templates path is unknown or the sibling is absent, so
 * the caller gets an empty catalogue rather than a thrown error on an install
 * layout this does not recognise.
 */
function resolveLocalizationPath(templatesPath, {
  configuredPath = null,
  language = DEFAULT_LANGUAGE
} = {}) {
  const candidates = [];
  if (configuredPath) candidates.push(configuredPath);
  if (process.env.TI_LOCALIZATION_DIR) candidates.push(process.env.TI_LOCALIZATION_DIR);
  if (templatesPath) {
    candidates.push(path.resolve(templatesPath, '..', 'Localization', language));
  }
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (err) {
      // An unreadable or disconnected path is not a usable one; try the next.
    }
  }
  return null;
}

/**
 * The name a template entry would render under WITHOUT localisation.
 *
 * Most template files carry `friendlyName`; three of them
 * (`TIHeatSinkTemplate`, `TIParticleWeaponTemplate`, `TIPlasmaWeaponTemplate`)
 * carry `displayName` instead and no `friendlyName` at all. Comparing a
 * localised name against `friendlyName` alone therefore counted all 63 of those
 * as renames when only 17 are. This is the single expression every display path
 * falls back to, so the divergence count measures the same thing the screen shows.
 */
function templateFallbackName(item) {
  if (!item || typeof item !== 'object') return null;
  return item.friendlyName || item.displayName || item.dataName || item.templateName || null;
}

/**
 * The name to put on screen for one template entry.
 *
 * THE ONE EXPRESSION every template-sourced display path uses, so the weapon
 * loadout written by `server/snapshot/space.js` and the catalogue index built by
 * `shared/intel/militaryValue.mjs` cannot drift apart: they resolve the same
 * item through the same rule.
 *
 * `_localizedName` is stamped by `server/templateLoader.js` and is null when the
 * game's localisation carries no entry for that `dataName`. Null falls through
 * to exactly what was rendered before localisation existed -- an absent entry is
 * an absence, never a blank label and never the raw key.
 *
 * @param {object|null} item - a loaded game template entry
 * @param {string|null} fallbackId - last resort when the entry names itself nowhere
 */
function templateDisplayName(item, fallbackId = null) {
  if (!item || typeof item !== 'object') return fallbackId;
  return item._localizedName || templateFallbackName(item) || fallbackId;
}

module.exports = {
  DEFAULT_LANGUAGE,
  LocalizationCatalogue,
  resolveLocalizationPath,
  normalizeForCompare,
  templateFallbackName,
  templateDisplayName
};
