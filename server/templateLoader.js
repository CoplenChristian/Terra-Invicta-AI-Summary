const fs = require('fs');
const path = require('path');
const { resolveConfig } = require('./config');

class TemplateLoader {
  // Without these a candidate directory cannot produce a tech graph, so it
  // must not be selected just because the path exists.
  static REQUIRED_TEMPLATES = [
    'TITechTemplate.json',
    'TIProjectTemplate.json',
    'TIEffectTemplate.json'
  ];

  constructor(configOrPath = null) {
    this.configPath = typeof configOrPath === 'string' ? configOrPath : null;
    this.configOverride = configOrPath && typeof configOrPath === 'object' ? configOrPath : null;
    this.config = this.loadConfig();
    this.templatesPath = this.resolveTemplatesPath();
    this.templates = {
      techs: new Map(),
      projects: new Map(),
      effects: new Map(),
      nations: new Map(),
      habModules: new Map(),
      shipHulls: new Map(),
      orgs: new Map(),
      // Councilor traits carry attribute modifiers -- the augmentation/implant
      // lines especially (ExecutiveAI +3 Administration, CognitiveEnhancer +3
      // Science, and so on). Without these a councilor's effective attributes
      // are understated and org capacity appears to be violated.
      traits: new Map(),
      // Mission templates carry the attack/defence attribute pairing, base
      // difficulty, hate-by-outcome and cost for every mission. Deliberately
      // NOT in REQUIRED_TEMPLATES: that list is the "is this directory
      // usable" probe, and widening it would make install paths that work
      // today start failing the check.
      missions: new Map(),
      weaponModules: new Map(),
      drives: new Map(),
      reactors: new Map(),
      radiators: new Map(),
      batteries: new Map(),
      utilityModules: new Map(),
      shipArmor: new Map(),
      // Hab sites carry the mining profile that determines a site's resource
      // yields. The save does not repeat the profile on unclaimed sites, so
      // ranking expansion targets requires joining back to these templates.
      habSites: new Map(),
      miningProfiles: new Map()
    };
    // Inverts each component template's `requiredProjectName` so the tech
    // graph can answer "which project unlocks this component" without any
    // display-name guessing.
    this.unlockMappings = {
      requiredProjectToComponents: new Map(),
      projectToUnlocks: new Map()
    };
    this.effectMappings = {
      effectToProjects: new Map(),
      effectToTechs: new Map(),
      projectToEffects: new Map(),
      techToEffects: new Map()
    };
    this.validationResults = [];
    this.isLoaded = false;
  }

  loadConfig() {
    return this.configOverride || resolveConfig({ configPath: this.configPath || undefined });
  }

  resolveTemplatesPath() {
    const installSuffix = path.join('steamapps', 'common', 'Terra Invicta', 'TerraInvicta_Data', 'StreamingAssets', 'Templates');
    const candidates = [this.config.paths?.templatesPath, process.env.TI_TEMPLATES_DIR];
    const steamRoots = [
      process.env.STEAM_LIBRARY_PATH,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.SystemDrive ? path.join(process.env.SystemDrive, 'SteamLibrary') : null
    ].filter(Boolean);
    for (const root of steamRoots) {
      // `STEAM_LIBRARY_PATH` is commonly the library root, while
      // ProgramFiles/ProgramFiles(x86) usually points at the parent of the
      // Steam installation. Probe both layouts without assuming a developer's
      // drive letter.
      candidates.push(path.join(root, installSuffix));
      candidates.push(path.join(root, 'Steam', installSuffix));
    }

    // Steam libraries are often installed on a secondary drive. Probe the
    // conventional library directory without baking a developer's drive into
    // the repository. An explicit TI_TEMPLATES_DIR always takes precedence.
    if (process.platform === 'win32') {
      for (let code = 65; code <= 90; code++) {
        candidates.push(`${String.fromCharCode(code)}:/SteamLibrary/${installSuffix.replace(/\\/g, '/')}`);
      }
    }

    for (const p of candidates) {
      if (p && this.isUsableTemplatesDir(p)) {
        return p;
      }
      if (p && fs.existsSync(p)) {
        console.warn(`[TemplateLoader] Skipping ${p}: missing required template files (${TemplateLoader.REQUIRED_TEMPLATES.join(', ')}).`);
      }
    }
    return null;
  }

  // A directory that merely exists is not a usable templates directory. The
  // repo's Ship_Info/raw_json, for example, has no tech/project/effect
  // templates -- selecting it produced a present-but-empty tech tree, so tech
  // endpoints returned empty results instead of the documented unavailable
  // response, and template-backed tests failed on a clean checkout.
  isUsableTemplatesDir(dir) {
    if (!fs.existsSync(dir)) return false;
    return TemplateLoader.REQUIRED_TEMPLATES.every(
      file => fs.existsSync(path.join(dir, file))
    );
  }

  load() {
    if (this.isLoaded) return;

    if (!this.templatesPath) {
      console.warn('[TemplateLoader] No templates directory found. Using fallback config mappings.');
      this.buildFallbackMappings();
      this.isLoaded = true;
      return;
    }

    console.log(`[TemplateLoader] Loading game templates from ${this.templatesPath}...`);

    this.loadJsonFile('TITechTemplate.json', (item) => {
      const id = item.dataName || item.friendlyName;
      if (id) {
        this.templates.techs.set(id, item);
        if (item.friendlyName) this.templates.techs.set(item.friendlyName, item);
        if (Array.isArray(item.effects)) {
          this.effectMappings.techToEffects.set(id, item.effects);
          for (const eff of item.effects) {
            if (!this.effectMappings.effectToTechs.has(eff)) {
              this.effectMappings.effectToTechs.set(eff, []);
            }
            this.effectMappings.effectToTechs.get(eff).push(id);
          }
        }
      }
    });

    this.loadJsonFile('TIProjectTemplate.json', (item) => {
      const id = item.dataName || item.friendlyName;
      if (id) {
        this.templates.projects.set(id, item);
        if (item.friendlyName) this.templates.projects.set(item.friendlyName, item);
        if (Array.isArray(item.effects)) {
          this.effectMappings.projectToEffects.set(id, item.effects);
          for (const eff of item.effects) {
            if (!this.effectMappings.effectToProjects.has(eff)) {
              this.effectMappings.effectToProjects.set(eff, []);
            }
            this.effectMappings.effectToProjects.get(eff).push(id);
          }
        }
      }
    });

    this.loadJsonFile('TIEffectTemplate.json', (item) => {
      const id = item.dataName || item.friendlyName;
      if (id) this.templates.effects.set(id, item);
    });

    this.loadJsonFile('TINationTemplate.json', (item) => {
      const id = item.dataName || item.displayName || item.templateName;
      if (id) this.templates.nations.set(id, item);
    });

    this.loadJsonFile('TIHabModuleTemplate.json', (item) => {
      const id = item.dataName || item.displayName || item.templateName;
      if (id) this.templates.habModules.set(id, item);
    });

    this.loadJsonFile('TIShipHullTemplate.json', (item) => {
      const id = item.dataName || item.displayName || item.templateName;
      if (id) this.templates.shipHulls.set(id, item);
    });

    this.loadJsonFile('TIHabSiteTemplate.json', (item) => {
      const id = item.dataName || item.displayName || item.templateName;
      if (id) this.templates.habSites.set(id, item);
    });

    this.loadJsonFile('TIMiningProfileTemplate.json', (item) => {
      const id = item.dataName || item.displayName || item.templateName;
      if (id) this.templates.miningProfiles.set(id, item);
    });

    this.loadJsonFile('TIOrgTemplate.json', (item) => {
      const id = item.dataName || item.displayName || item.templateName;
      if (id) this.templates.orgs.set(id, item);
    });

    this.loadJsonFile('TITraitTemplate.json', (item) => {
      const id = item.dataName || item.friendlyName;
      if (id) this.templates.traits.set(id, item);
    });

    this.loadJsonFile('TIMissionTemplate.json', (item) => {
      const id = item.dataName || item.friendlyName;
      if (id) this.templates.missions.set(id, item);
    });

    // Component templates used by the tech graph to answer "which project
    // unlocks this drive/weapon/hull/module" via their requiredProjectName.
    const componentFiles = [
      ['drives', 'TIDriveTemplate.json'],
      ['reactors', 'TIPowerPlantTemplate.json'],
      ['radiators', 'TIRadiatorTemplate.json'],
      ['batteries', 'TIBatteryTemplate.json'],
      ['utilityModules', 'TIUtilityModuleTemplate.json'],
      ['shipArmor', 'TIShipArmorTemplate.json']
    ];
    for (const [key, filename] of componentFiles) {
      this.loadJsonFile(filename, (item) => {
        const id = item.dataName || item.displayName || item.friendlyName || item.templateName;
        if (id) this.templates[key].set(id, item);
      });
    }

    // Ship weapon templates are split across several files in the game data.
    // Keeping them in one index lets the save parser classify equipped weapons
    // without relying on display-name guesses.
    const weaponTemplateFiles = [
      ['TILaserWeaponTemplate.json', 'Laser'],
      ['TIMagneticGunTemplate.json', 'Kinetic'],
      ['TIGunTemplate.json', 'Kinetic'],
      ['TIParticleWeaponTemplate.json', 'Particle'],
      ['TIPlasmaWeaponTemplate.json', 'Plasma'],
      ['TIMissileTemplate.json', 'Missile']
    ];

    for (const [filename, category] of weaponTemplateFiles) {
      this.loadJsonFile(filename, (item) => {
        const id = item.dataName || item.displayName || item.friendlyName || item.templateName;
        if (!id) return;
        const displayName = item.displayName || item.friendlyName || id;
        const isPointDefense = /point.?defen[cs]e/i.test(`${id} ${displayName}`) ||
          (item.defenseMode === true && item.attackMode === false);
        this.templates.weaponModules.set(id, {
          ...item,
          dataName: id,
          displayName,
          category,
          role: isPointDefense ? 'Point Defense' : category
        });
      });
    }

    this.buildUnlockMappings();
    this.validateIntelligenceMappings();
    this.isLoaded = true;
    console.log(`[TemplateLoader] Loaded ${this.templates.techs.size} techs, ${this.templates.projects.size} projects, ${this.templates.effects.size} effects.`);
  }

  // Builds a reverse index from every component template's requiredProjectName
  // to the component, letting the tech graph report exactly which project
  // unlocks each drive/weapon/hull/hab module/utility/armor/battery.
  registerComponentUnlock(componentType, item) {
    const projectId = item.requiredProjectName;
    if (!projectId) return;
    if (!this.unlockMappings.requiredProjectToComponents.has(projectId)) {
      this.unlockMappings.requiredProjectToComponents.set(projectId, []);
    }
    this.unlockMappings.requiredProjectToComponents.get(projectId).push({
      componentType,
      id: item.dataName || item.displayName || item.friendlyName || item.templateName,
      displayName: item.friendlyName || item.displayName || (item.dataName || item.templateName || item.componentType),
      item
    });
  }

  buildUnlockMappings() {
    this.unlockMappings.requiredProjectToComponents.clear();
    this.unlockMappings.projectToUnlocks.clear();

    for (const weapon of this.templates.weaponModules.values()) {
      this.registerComponentUnlock('weapon', weapon);
    }
    for (const drive of this.templates.drives.values()) this.registerComponentUnlock('drive', drive);
    for (const reactor of this.templates.reactors.values()) this.registerComponentUnlock('reactor', reactor);
    for (const radiator of this.templates.radiators.values()) this.registerComponentUnlock('radiator', radiator);
    for (const battery of this.templates.batteries.values()) this.registerComponentUnlock('battery', battery);
    for (const utility of this.templates.utilityModules.values()) this.registerComponentUnlock('utility', utility);
    for (const armor of this.templates.shipArmor.values()) this.registerComponentUnlock('armor', armor);
    for (const hull of this.templates.shipHulls.values()) this.registerComponentUnlock('ship_hull', hull);
    for (const habModule of this.templates.habModules.values()) this.registerComponentUnlock('hab_module', habModule);

    for (const [projectId, components] of this.unlockMappings.requiredProjectToComponents) {
      this.unlockMappings.projectToUnlocks.set(
        projectId,
        components.map(c => ({ componentType: c.componentType, id: c.id, displayName: c.displayName }))
      );
    }
  }

  loadJsonFile(filename, itemHandler) {
    const fullPath = path.join(this.templatesPath, filename);
    if (!fs.existsSync(fullPath)) return;
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
      const data = JSON.parse(clean);
      if (Array.isArray(data)) {
        for (const item of data) {
          itemHandler(item);
        }
      } else if (typeof data === 'object') {
        for (const key of Object.keys(data)) {
          itemHandler(data[key]);
        }
      }
    } catch (err) {
      console.warn(`[TemplateLoader] Failed reading ${filename}:`, err.message);
    }
  }

  validateIntelligenceMappings() {
    this.validationResults = [];
    const expected = Object.entries(this.config.analysis?.effects || {})
      .map(([effect, descriptor]) => ({
        id: descriptor.defaultProject || descriptor.defaultTech,
        type: descriptor.defaultProject ? 'project' : 'tech',
        effect
      }))
      .filter(entry => entry.id && entry.effect);

    for (const exp of expected) {
      const effects = exp.type === 'project'
        ? (this.effectMappings.projectToEffects.get(exp.id) || [])
        : (this.effectMappings.techToEffects.get(exp.id) || []);

      const valid = effects.includes(exp.effect);
      this.validationResults.push({
        targetId: exp.id,
        targetType: exp.type,
        expectedEffect: exp.effect,
        foundEffects: effects,
        valid
      });

      if (valid) {
        console.log(`[TemplateLoader] ✓ Validated mapping: ${exp.id} -> ${exp.effect}`);
      } else {
        console.warn(`[TemplateLoader] ⚠ Warning: Expected mapping missing: ${exp.id} -> ${exp.effect}`);
      }
    }
  }

  buildFallbackMappings() {
    const fallbackProjects = {};
    const fallbackTechs = {};
    for (const [effectId, descriptor] of Object.entries(this.config.analysis?.effects || {})) {
      const target = descriptor.defaultProject ? fallbackProjects : fallbackTechs;
      const targetId = descriptor.defaultProject || descriptor.defaultTech;
      if (!targetId) continue;
      if (!target[targetId]) target[targetId] = [];
      target[targetId].push(effectId);
    }

    for (const [proj, effs] of Object.entries(fallbackProjects)) {
      this.effectMappings.projectToEffects.set(proj, effs);
      for (const eff of effs) {
        if (!this.effectMappings.effectToProjects.has(eff)) this.effectMappings.effectToProjects.set(eff, []);
        this.effectMappings.effectToProjects.get(eff).push(proj);
      }
    }

    for (const [tech, effs] of Object.entries(fallbackTechs)) {
      this.effectMappings.techToEffects.set(tech, effs);
      for (const eff of effs) {
        if (!this.effectMappings.effectToTechs.has(eff)) this.effectMappings.effectToTechs.set(eff, []);
        this.effectMappings.effectToTechs.get(eff).push(tech);
      }
    }
  }

  getProjectEffects(projectId) {
    return this.effectMappings.projectToEffects.get(projectId) || [];
  }

  getTechEffects(techId) {
    return this.effectMappings.techToEffects.get(techId) || [];
  }

  getWeaponModule(moduleId) {
    return this.templates.weaponModules.get(moduleId) || null;
  }

  getProject(projectId) {
    return this.templates.projects.get(projectId) || null;
  }

  getTech(techId) {
    return this.templates.techs.get(techId) || null;
  }

  getComponent(componentType, componentId) {
    const map = {
      weapon: 'weaponModules',
      drive: 'drives',
      reactor: 'reactors',
      radiator: 'radiators',
      battery: 'batteries',
      utility: 'utilityModules',
      armor: 'shipArmor',
      ship_hull: 'shipHulls',
      hab_module: 'habModules'
    }[componentType];
    return map ? (this.templates[map].get(componentId) || null) : null;
  }

  getProjectUnlocks(projectId) {
    return this.unlockMappings.projectToUnlocks.get(projectId) || [];
  }

  getComponentsForRequiredProject(projectId) {
    return this.unlockMappings.requiredProjectToComponents.get(projectId) || [];
  }
}

module.exports = new TemplateLoader();
