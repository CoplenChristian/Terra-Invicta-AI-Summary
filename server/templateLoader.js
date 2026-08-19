const fs = require('fs');
const path = require('path');

class TemplateLoader {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(__dirname, '../config/intelligence_capabilities.json');
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
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (err) {
      console.warn('[TemplateLoader] Could not load intelligence_capabilities.json:', err.message);
    }
    return {
      templatesPath: 'F:/SteamLibrary/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates',
      effects: {},
      strategicProjects: []
    };
  }

  resolveTemplatesPath() {
    const candidates = [
      this.config.templatesPath,
      'F:/SteamLibrary/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates',
      'C:/Program Files (x86)/Steam/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates',
      'E:/SteamLibrary/steamapps/common/Terra Invicta/TerraInvicta_Data/StreamingAssets/Templates',
      path.join(__dirname, '../Ship_Info/raw_json')
    ];

    for (const p of candidates) {
      if (p && fs.existsSync(p)) {
        return p;
      }
    }
    return null;
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
    const expected = [
      { id: 'Project_TheirSignatures', type: 'project', effect: 'Effect_DetectAbductions' },
      { id: 'Project_TheirMethods', type: 'project', effect: 'Effect_DetectEnthralls' },
      { id: 'Project_TheirOperations', type: 'project', effect: 'Effect_DetectAllOperations' },
      { id: 'Project_TheirOperations', type: 'project', effect: 'Effect_UpdateAlienThreatMeter' },
      { id: 'Project_TheirMovements', type: 'project', effect: 'Effect_DetectAlienMovements' },
      { id: 'Skywatch', type: 'tech', effect: 'Effect_Skywatch' },
      { id: 'DeepSystemSkywatch', type: 'tech', effect: 'Effect_DeepSkywatch' }
    ];

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
    const fallbackProjects = {
      'Project_TheirSignatures': ['Effect_DetectAbductions'],
      'Project_TheirMethods': ['Effect_DetectEnthralls'],
      'Project_TheirOperations': ['Effect_DetectAllOperations', 'Effect_UpdateAlienThreatMeter'],
      'Project_TheirMovements': ['Effect_DetectAlienMovements']
    };
    const fallbackTechs = {
      'Skywatch': ['Effect_Skywatch', 'Effect_SpaceScan'],
      'DeepSystemSkywatch': ['Effect_DeepSkywatch', 'Effect_SpaceScan']
    };

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
