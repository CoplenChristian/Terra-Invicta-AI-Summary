# Terra Invicta Hab Modules

Source: Ship_Info/raw_json/TIHabModuleTemplate.json from the Again campaign export.
Fields focus on constraints, economy, and strategic role rather than art/UI metadata.

---

## Core Stats & Outputs

| Module | Template ID | Required Project | Tier | Hab Type | Core? | One/Hub? | Mine? | Auto? | Shipyard | Resupply | No Build | Disabled | Destroyed | Crew | Power | Mass (t) | Build (days) | MC | CP Cap. | SCV | Money/mo | Influence/mo | Ops/mo | Research/mo | Projects | Vols/mo | Metals/mo | Nobles/mo | Fissiles/mo | Antimatter/mo | Exotics/mo | Mining mod | Build time mod | Tech Bonuses | Special Rules | Special Value |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Administration Node | AdministrationNode | Project_AdministrationNode | 1 | Any | False | True | False | False | False | False | False | False | False | 40 | -10 | 30 | 45 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | LEOControlPointCapacity, Efficiency | 0.025 |
| Antimatter Trap | AntimatterTrap | Project_AntimatterTrap | 1 | Station | False | True | False | False | False | False | False | False | False | 3 | -15 | 20 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Energy; bonus=0.05} | HarvestAntimatter, TechBonusDiminishingReturns | 0.25 |
| Automated Fission Pile | AutomatedFissionPile | Project_AutomatedFissionPile | 1 | Any | False | False | False | True | False | False | False | False | False | 0 | 20 | 30 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Automated Mining Complex | AutomatedMiningComplex | Project_AutomatedMiningComplex | 1 | Base | False | True | True | True | False | False | False | False | False | 0 | -12 | 175 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.25 | 1 |  | Cost_Scales_With_Gravity |  |
| Automated Outpost Core | AutomatedOutpostCore | Project_AutomatedOutpostCore | 1 | Base | True | True | False | True | False | False | False | False | False | 0 | 0 | 20 | 30 | -1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Automated Platform Core | AutomatedPlatformCore | Project_AutomatedPlatformCore | 1 | Station | True | True | False | True | False | False | False | False | False | 0 | 0 | 20 | 30 | -1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Automated Solar Collector | AutomatedSolarCollector | Project_AutomatedSolarCollector | 1 | Any | False | False | False | True | False | False | False | False | False | 0 | 20 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Solar_Power_Variable_Output |  |
| Automated Supply Depot | AutomatedSupplyDepot | Project_AutomatedSupplyDepot | 1 | Any | False | False | False | True | False | True | False | False | False | 0 | -3 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | PowerFirst |  |
| Broadcast Outlet | BroadcastOutlet | Project_BroadcastOutlet | 1 | Any | False | False | False | False | False | False | False | False | False | 5 | -5 | 25 | 30 | 0 | 0 | 0 | 1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | LEOBonusPropagandaStrength, Requires_Colonized_Body, NotInIrradiated | 1 |
| Construction Module | ConstructionModule | Project_ConstructionModule | 1 | Any | False | False | False | False | False | False | False | False | False | 6 | -10 | 30 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.9 |  | CanFoundTier1Habs |  |
| Energy Lab | EnergyLab | Project_EnergyLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -10 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Energy; bonus=0.025} | LEOBonusLaunchFacilities, TechBonusDiminishingReturns | 0.03 |
| Fission Pile | FissionPile | Project_FissionPile | 1 | Any | False | False | False | False | False | False | False | False | False | 4 | 20 | 20 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Fusion Pile | FusionPile | Project_FusionPile | 1 | Any | False | False | False | False | False | False | False | False | False | 5 | 40 | 30 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Heavy Fission Pile | HeavyFissionPile | Project_HeavyFissionPile | 1 | Any | False | False | False | False | False | False | False | False | False | 4 | 30 | 40 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Heavy Fusion Pile | HeavyFusionPile | Project_HeavyFusionPile | 1 | Any | False | False | False | False | False | False | False | False | False | 10 | 70 | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | UsesHelium3 |  |
| Hydroponics Bay | HydroponicsBay | Project_HydroponicsBay | 1 | Any | False | False | False | False | False | False | False | False | False | 1 | -10 | 10 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Farm, PowerFirst | 60 |
| Information Science Lab | InformationScienceLab | Project_InformationScienceLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -10 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=InformationScience; bonus=0.025} | LEOBonusKnowledge, TechBonusDiminishingReturns | 0.03 |
| Life Science Lab | LifeScienceLab | Project_LifeScienceLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -5 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=LifeScience; bonus=0.025} | LEOBonusWelfare, TechBonusDiminishingReturns | 0.03 |
| Marine Platoon Barracks | MarinePlatoonBarracks | Project_MarinePlatoonBarracks | 1 | Any | False | False | False | False | False | False | False | False | False | 30 | -5 | 120 | 30 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | DropTroops, MarinePlatoon, PowerFirst | 4 |
| Materials Lab | MaterialsLab | Project_MaterialsLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -6 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Materials; bonus=0.025} | LEOBonusMiltech, TechBonusDiminishingReturns | 0.03 |
| Military Science Lab | MilitaryScienceLab | Project_MilitaryScienceLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -5 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=MilitaryScience; bonus=0.025} | LEOBonusArmyCombatValue, TechBonusDiminishingReturns | 0.03 |
| Outpost Core | OutpostCore | Project_OutpostCore | 1 | Base | True | True | False | False | False | False | False | False | False | 5 | 0 | 20 | 30 | -2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Outpost Mining Complex | OutpostMiningComplex | Project_OutpostMiningComplex | 1 | Base | False | True | True | False | False | False | False | False | False | 12 | -10 | 250 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  | Cost_Scales_With_Gravity |  |
| Particle Collider | ParticleCollider | Project_ParticleCollider | 1 | Station | False | False | False | False | False | False | False | False | False | 10 | -100 | 200 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0.0001 | 0 | 0 | 1 | @{category=Energy; bonus=0.01} | TechBonusDiminishingReturns |  |
| Platform Core | PlatformCore | Project_PlatformCore | 1 | Station | True | True | False | False | False | False | False | False | False | 3 | 0 | 15 | 30 | -2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Point Defense Array | PointDefenseArray | Project_PointDefenseArray | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -10 | 150 | 30 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | PowerFirst |  |
| Quarters | Quarters | Project_Quarters | 1 | Any | False | False | False | False | False | False | False | False | False | 50 | -2 | 60 | 30 | 0 | 0 | 0 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Stability, AtrocityToKill | 3 |
| Social Science Lab | SocialScienceLab | Project_SocialScienceLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -4 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=SocialScience; bonus=0.025} | LEOBonusGovernment, Requires_Colonized_Body, TechBonusDiminishingReturns | 0.03 |
| Solar Collector | SolarCollector | Project_SolarCollector | 1 | Any | False | False | False | False | False | False | False | False | False | 1 | 20 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Solar_Power_Variable_Output |  |
| Space Dock | SpaceDock | Project_SpaceDock | 1 | Any | False | False | False | False | True | True | False | False | False | 40 | -20 | 80 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | PowerFirst, Shipyard |  |
| Space Science Lab | SpaceScienceLab | Project_SpaceScienceLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -5 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=SpaceScience; bonus=0.025} | LEOBonusMissionControl, TechBonusDiminishingReturns | 0.03 |
| Supply Depot | SupplyDepot | Project_SupplyDepot | 1 | Any | False | False | False | False | False | True | False | False | False | 3 | 0 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | PowerFirst |  |
| Tourist Berth | TouristBerth | Project_TouristBerth | 1 | Station | False | False | False | False | False | False | False | False | False | 1 | -3 | 15 | 30 | 0 | 0 | 0 | 12 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Requires_Inhabited_Body, NotInIrradiated, AtrocityToKill |  |
| Xenology Lab | XenologyLab | Project_XenologyLab | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -10 | 15 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Xenology; bonus=0.1} | LEOBonusAlienDetection, TechBonusDiminishingReturns | 1 |
| Administration Tower | AdministrationTower | Project_AdministrationTower | 2 | Any | False | True | False | False | False | False | False | False | False | 200 | -30 | 150 | 90 | 1 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | LEOControlPointCapacity, Efficiency | 0.05 |
| Antimatter Harvester | AntimatterHarvester | Project_AntimatterHarvester | 2 | Station | False | True | False | False | False | False | False | False | False | 15 | -60 | 100 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Energy; bonus=0.2} | HarvestAntimatter, TechBonusDiminishingReturns | 0.5 |
| Atomsmasher | Atomsmasher | Project_Atomsmasher | 2 | Station | False | False | False | False | False | False | False | False | False | 20 | -250 | 1000 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0.01 | 0 | 0 | 1 | @{category=Energy; bonus=0.025} |  |  |
| Communications Hub | CommunicationsHub | Project_CommunicationsHub | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -20 | 125 | 90 | 0 | 0 | 0 | 3 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | LEOBonusPropagandaStrength, Requires_Inhabited_Body, NotInIrradiated | 2 |
| Deep Space Telescope | DeepSpaceTelescope | Project_DeepSpaceTelescope | 2 | Any | False | False | False | False | False | False | False | False | False | 15 | -20 | 200 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=SpaceScience; bonus=0.1} | PowerFirst, TechBonusDiminishingReturns |  |
| Energy Research Center | EnergyResearchCenter | Project_EnergyResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 20 | -40 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Energy; bonus=0.1} | LEOBonusLaunchFacilities, TechBonusDiminishingReturns | 0.06 |
| Farm | Farm | Project_Farm | 2 | Any | False | False | False | False | False | False | False | False | False | 5 | -40 | 120 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Farm, PowerFirst | 600 |
| Fission Reactor Array | FissionReactorArray | Project_FissionReactorArray | 2 | Any | False | False | False | False | False | False | False | False | False | 20 | 85 | 100 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Fusion Reactor Array | FusionReactorArray | Project_FusionReactorArray | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | 170 | 150 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Heavy Fission Reactor Array | HeavyFissionReactorArray | Project_HeavyFissionReactorArray | 2 | Any | False | False | False | False | False | False | False | False | False | 20 | 128 | 200 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Heavy Fusion Reactor Array | HeavyFusionReactorArray | Project_HeavyFusionReactorArray | 2 | Any | False | False | False | False | False | False | False | False | False | 50 | 300 | 300 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | UsesHelium3 |  |
| Information Science Research Center | InformationScienceResearchCenter | Project_InformationScienceResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -40 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=InformationScience; bonus=0.1} | LEOBonusKnowledge, TechBonusDiminishingReturns | 0.06 |
| Layered Defense Array | LayeredDefenseArray | Project_LayeredDefenseArray | 2 | Any | False | False | False | False | False | False | False | False | False | 15 | -40 | 750 | 90 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | PowerFirst |  |
| Life Science Research Center | LifeScienceResearchCenter | Project_LifeScienceResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -20 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=LifeScience; bonus=0.1} | LEOBonusWelfare, TechBonusDiminishingReturns | 0.06 |
| Marine Company Barracks | MarineCompanyBarracks | Project_MarineCompanyBarracks | 2 | Any | False | False | False | False | False | False | False | False | False | 150 | -20 | 600 | 90 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | DropTroops, MarineCompany, PowerFirst | 8 |
| Materials Research Center | MaterialsResearchCenter | Project_MaterialsResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -24 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Materials; bonus=0.1} | LEOBonusMiltech, TechBonusDiminishingReturns | 0.06 |
| Military Science Research Center | MilitaryScienceResearchCenter | Project_MilitaryScienceResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -20 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=MilitaryScience; bonus=0.1} | LEOBonusArmyCombatValue, TechBonusDiminishingReturns | 0.06 |
| Nanofactory | Nanofactory | Project_Nanofactory | 2 | Any | False | False | False | False | False | False | False | False | False | 30 | -40 | 150 | 270 | 0 | 0 | 0 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.75 | @{category=Materials; bonus=0.01} | LEOBonusEconomy, CanFoundTier2Habs, CanFoundTier1Habs, MoneyIfNotBuilding, TechBonusDiminishingReturns | 0.02 |
| Operations Center | OperationsCenter | Project_OperationsCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 50 | -40 | 200 | 180 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Orbital Hospital | OrbitalHospital | Project_OrbitalHospital | 2 | Any | False | False | False | False | False | False | False | False | False | 120 | -30 | 800 | 90 | 0 | 0 | 0 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=LifeScience; bonus=0.025} | Requires_Inhabited_Body, TechBonusDiminishingReturns, AtrocityToKill, NotInIrradiated |  |
| Research Campus | ResearchCampus | Project_ResearchCampus | 2 | Any | False | False | False | False | False | False | False | False | False | 200 | -30 | 1000 | 180 | -1 | 0 | 0 | 0 | 0 | 0 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Requires_Colonized_Body, AtrocityToKill |  |
| Residential Module | ResidentialModule | Project_ResidentialModule | 2 | Any | False | False | False | False | False | False | False | False | False | 500 | -15 | 300 | 60 | 0 | 0 | 0 | 12 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Stability, AtrocityToKill | 6 |
| Orbital Core | OrbitalCore | Project_OrbitalCore | 2 | Station | True | True | False | False | False | False | False | False | False | 15 | 0 | 75 | 60 | -3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Settlement Core | SettlementCore | Project_SettlementCore | 2 | Base | True | True | False | False | False | False | False | False | False | 25 | 0 | 100 | 60 | -3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Settlement Mining Complex | SettlementMiningComplex | Project_SettlementMiningComplex | 2 | Base | False | True | True | False | False | False | False | False | False | 60 | -40 | 1250 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.5 | 1 |  | Cost_Scales_With_Gravity |  |
| Shipyard | Shipyard | Project_Shipyard | 2 | Any | False | False | False | False | True | True | False | False | False | 120 | -80 | 400 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.85 |  | PowerFirst, Shipyard |  |
| Skunk Works | SkunkWorks | Project_SkunkWorks | 2 | Any | False | False | False | False | False | False | False | False | False | 20 | -30 | 150 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Social Science Research Center | SocialScienceResearchCenter | Project_SocialScienceResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -16 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=SocialScience; bonus=0.1} | LEOBonusGovernment, Requires_Inhabited_Body, TechBonusDiminishingReturns | 0.06 |
| Solar Array | SolarArray | Project_SolarArray | 2 | Any | False | False | False | False | False | False | False | False | False | 5 | 80 | 75 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Solar_Power_Variable_Output |  |
| Space Hotel | SpaceHotel | Project_SpaceHotel | 2 | Station | False | False | False | False | False | False | False | False | False | 100 | -30 | 500 | 90 | 0 | 0 | 0 | 80 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Requires_Inhabited_Body, NotInIrradiated, AtrocityToKill |  |
| Space Science Research Center | SpaceScienceResearchCenter | Project_SpaceScienceResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -20 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=SpaceScience; bonus=0.1} | LEOBonusMissionControl | 0.06 |
| Xenoscience Research Center | XenoscienceResearchCenter | Project_XenoscienceResearchCenter | 2 | Any | False | False | False | False | False | False | False | False | False | 25 | -40 | 75 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Xenology; bonus=0.25} | LEOBonusAlienDetection, TechBonusDiminishingReturns | 2 |
| Administration Complex | AdministrationComplex | Project_AdministrationComplex | 3 | Any | False | True | False | False | False | False | False | False | False | 1000 | -120 | 750 | 180 | 2 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | LEOControlPointCapacity, Efficiency | 0.1 |
| Agriculture Complex | AgricultureComplex | Project_AgricultureComplex | 3 | Any | False | False | False | False | False | False | False | False | False | 25 | -120 | 960 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Farm, PowerFirst | 3000 |
| Antimatter Farm | AntimatterFarm | Project_AntimatterFarm | 3 | Station | False | True | False | False | False | False | False | False | False | 75 | -240 | 800 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Energy; bonus=0.5} | HarvestAntimatter, TechBonusDiminishingReturns | 1 |
| Battlestations | Battlestations | Project_Battlestations | 3 | Any | False | False | False | False | False | False | False | False | False | 75 | -240 | 6000 | 180 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | PowerFirst |  |
| Civilian Complex | CivilianComplex | Project_CivilianComplex | 3 | Any | False | False | False | False | False | False | False | False | False | 2500 | -120 | 2400 | 120 | 0 | 0 | 0 | 40 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Stability, AtrocityToKill | 12 |
| Colony Core | ColonyCore | Project_ColonyCore | 3 | Base | True | True | False | False | False | False | False | False | False | 125 | 0 | 800 | 90 | -4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Colony Mining Complex | ColonyMiningComplex | Project_ColonyMiningComplex | 3 | Base | False | True | True | False | False | False | False | False | False | 200 | -200 | 10000 | 240 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 |  | Cost_Scales_With_Gravity |  |
| Command Center | CommandCenter | Project_CommandCenter | 3 | Any | False | False | False | False | False | False | False | False | False | 250 | -120 | 1600 | 360 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Energy Institute | EnergyInstitute | Project_EnergyInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 100 | -120 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Energy; bonus=0.25} | LEOBonusLaunchFacilities, TechBonusDiminishingReturns | 0.1 |
| Fission Reactor Farm | FissionReactorFarm | Project_FissionReactorFarm | 3 | Any | False | False | False | False | False | False | False | False | False | 100 | 250 | 800 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Foundry | Foundry | Project_Foundry | 3 | Any | False | False | False | False | False | False | False | False | False | 100 | -90 | 1200 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Fusion Reactor Farm | FusionReactorFarm | Project_FusionReactorFarm | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | 500 | 1200 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Geriatrics Facility | GeriatricsFacility | Project_GeriatricsFacility | 3 | Any | False | False | False | False | False | False | False | False | False | 600 | -90 | 6400 | 180 | 0 | 0 | 0 | 250 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=LifeScience; bonus=0.025} | Requires_Inhabited_Body, NotInIrradiated, TechBonusDiminishingReturns, AtrocityToKill |  |
| Heavy Fission Reactor Farm | HeavyFissionReactorFarm | Project_HeavyFissionReactorFarm | 3 | Any | False | False | False | False | False | False | False | False | False | 100 | 375 | 1600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Heavy Fusion Reactor Farm | HeavyFusionReactorFarm | Project_HeavyFusionReactorFarm | 3 | Any | False | False | False | False | False | False | False | False | False | 150 | 900 | 2400 | 360 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | UsesHelium3 |  |
| Helium-3 Mine | Helium-3Mine | Project_Helium-3Mine | 3 | Station | False | True | False | False | False | False | False | False | False | 75 | -300 | 2400 | 180 | -3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | HarvestHelium3, Requires_GasGiant_Orbit, Requires_Interface_Orbit, PowerFirst |  |
| Information Science Institute | InformationScienceInstitute | Project_InformationScienceInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -120 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=InformationScience; bonus=0.25} | LEOBonusKnowledge, TechBonusDiminishingReturns | 0.1 |
| Interstellar Launching Laser | InterstellarLaunchingLaser | Project_InterstellarLaunchingLaser | 3 | Station | False | False | False | False | False | False | False | False | False | 80 | -5000 | 250000 | 720 | -20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | InterstellarLaunchModule, ConsumesMCWhenUnpowered |  |
| Life Science Institute | LifeScienceInstitute | Project_LifeScienceInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -60 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=LifeScience; bonus=0.25} | LEOBonusWelfare, TechBonusDiminishingReturns | 0.1 |
| Marine Battalion Barracks | MarineBattalionBarracks | Project_MarineBattalionBarracks | 3 | Any | False | False | False | False | False | False | False | False | False | 750 | -60 | 4800 | 180 | 0 | 0 | 0 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | DropTroops, MarineBattalion, PowerFirst | 16 |
| Materials Institute | MaterialsInstitute | Project_MaterialsInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -72 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Materials; bonus=0.25} | LEOBonusMiltech, TechBonusDiminishingReturns | 0.1 |
| Media Center | MediaCenter | Project_MediaCenter | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -60 | 1000 | 180 | 0 | 0 | 0 | 10 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | LEOBonusPropagandaStrength, Requires_Inhabited_Body, NotInIrradiated | 3 |
| Military Science Institute | MilitaryScienceInstitute | Project_MilitaryScienceInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -60 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=MilitaryScience; bonus=0.25} | LEOBonusArmyCombatValue, TechBonusDiminishingReturns | 0.1 |
| Nanofacturing Complex | NanofacturingComplex | Project_NanofacturingComplex | 3 | Any | False | False | False | False | False | False | False | False | False | 150 | -120 | 1200 | 360 | 0 | 0 | 0 | 300 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.6 | @{category=Materials; bonus=0.02} | LEOBonusEconomy, CanFoundTier3Habs, CanFoundTier2Habs, CanFoundTier1Habs, MoneyIfNotBuilding, TechBonusDiminishingReturns | 0.05 |
| Research University | ResearchUniversity | Project_ResearchUniversity | 3 | Any | False | False | False | False | False | False | False | False | False | 1000 | -90 | 8000 | 360 | -2 | 0 | 0 | 0 | 0 | 0 | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Requires_Inhabited_Body, AtrocityToKill |  |
| Sentinel Complex | SentinelComplex | Project_SentinelComplex | 3 | Station | False | False | False | False | False | False | False | False | False | 100 | -150 | 10000 | 120 | -1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | SentinelModule, MarineCompany, PowerFirst, EarthLEOOnly, ConsumesMCWhenUnpowered | 6 |
| Social Science Institute | SocialScienceInstitute | Project_SocialScienceInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -48 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=SocialScience; bonus=0.25} | LEOBonusGovernment, Requires_Inhabited_Body, TechBonusDiminishingReturns | 0.1 |
| Solar Farm | SolarFarm | Project_SolarFarm | 3 | Any | False | False | False | False | False | False | False | False | False | 25 | 240 | 600 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Solar_Power_Variable_Output |  |
| Space Resort | SpaceResort | Project_SpaceResort | 3 | Station | False | False | False | False | False | False | False | False | False | 500 | -90 | 4000 | 180 | 0 | 0 | 0 | 250 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Requires_Inhabited_Body, AtrocityToKill, NotInIrradiated |  |
| Space Science Institute | SpaceScienceInstitute | Project_SpaceScienceInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -60 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=SpaceScience; bonus=0.25} | LEOBonusMissionControl, TechBonusDiminishingReturns | 0.1 |
| Spaceworks | Spaceworks | Project_Spaceworks | 3 | Any | False | False | False | False | True | True | False | False | False | 400 | -240 | 3200 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.7 |  | PowerFirst, Shipyard |  |
| Supercollider | Supercollider | Project_Supercollider | 3 | Station | False | False | False | False | False | False | False | False | False | 100 | -750 | 8000 | 360 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0.1 | 0 | 0 | 1 | @{category=Energy; bonus=0.05} | TechBonusDiminishingReturns |  |
| Ring Core | RingCore | Project_RingCore | 3 | Station | True | True | False | False | False | False | False | False | False | 75 | 0 | 600 | 90 | -4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Xenoscience Institute | XenoscienceInstitute | Project_XenoscienceInstitute | 3 | Any | False | False | False | False | False | False | False | False | False | 125 | -120 | 600 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | @{category=Xenology; bonus=0.5} | LEOBonusAlienDetection, TechBonusDiminishingReturns | 3 |
| Alien Outpost Core | AlienOutpostCore | Project_AlienMasterProject | 1 | Base | True | True | False | False | False | False | False | False | False | 1 | 0 | 20 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders | 6 |
| Alien Settlement Core | AlienSettlementCore | Project_AlienMasterProject | 2 | Base | True | True | False | False | False | False | False | False | False | 5 | 0 | 100 | 120 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders | 10 |
| Alien Colony Core | AlienColonyCore | Project_AlienMasterProject | 3 | Base | True | True | False | False | False | False | False | False | False | 10 | 0 | 500 | 180 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders | 14 |
| Alien Platform Core | AlienPlatformCore | Project_AlienMasterProject | 1 | Station | True | True | False | False | False | False | False | False | False | 1 | 0 | 20 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders | 6 |
| Alien Orbital Core | AlienOrbitalCore | Project_AlienMasterProject | 2 | Station | True | True | False | False | False | False | False | False | False | 5 | 0 | 100 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders | 10 |
| Alien Ring Core | AlienRingCore | Project_AlienMasterProject | 3 | Station | True | True | False | False | False | False | False | False | False | 10 | 0 | 500 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders | 14 |
| Alien Spacedock | AlienSpacedock | Project_AlienMasterProject | 1 | Any | False | False | False | False | True | True | False | False | False | 5 | -15 | 50 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Griffins, Shipyard | 1 |
| Alien Shipyard | AlienShipyard | Project_AlienMasterProject | 2 | Any | False | False | False | False | True | True | False | False | False | 20 | -30 | 250 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.75 |  | Griffins, Shipyard | 1 |
| Alien Spaceworks | AlienSpaceworks | Project_AlienMasterProject | 3 | Any | False | False | False | False | True | True | False | False | False | 40 | -60 | 1250 | 240 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 |  | Griffins, Shipyard | 1 |
| Alien Fusion Pile | AlienFusionPile | Project_AlienMasterProject | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | 30 | 20 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Fusion Reactor Array | AlienFusionReactorArray | Project_AlienMasterProject | 2 | Any | False | False | False | False | False | False | False | False | False | 5 | 100 | 100 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Fusion Reactor Farm | AlienFusionReactorFarm | Project_AlienMasterProject | 3 | Any | False | False | False | False | False | False | False | False | False | 10 | 300 | 500 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Assembler | AlienAssembler | Project_AlienMasterProject | 1 | Any | False | False | False | False | False | True | False | False | False | 3 | -15 | 15 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.8 |  | CanFoundTier1Habs |  |
| Alien Nanofactory | AlienNanofactory | Project_AlienMasterProject | 2 | Any | False | False | False | False | False | True | False | False | False | 5 | -50 | 75 | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02 | 0 | 0 | 0.65 |  | CanFoundTier2Habs, CanFoundTier1Habs |  |
| Alien Nanofacturing Complex | AlienNanofacturingComplex | Project_AlienMasterProject | 3 | Any | False | False | False | False | False | True | False | False | False | 10 | -100 | 375 | 360 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.04 | 0 | 0 | 0.5 |  | CanFoundTier3Habs, CanFoundTier2Habs, CanFoundTier1Habs |  |
| Alien Wormhole Facility | AlienWormholeFacility | Project_AlienMasterProject | 3 | Base | False | True | False | False | False | False | True | False | False | 0 | 0 | 10000 | 360 | 100 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 200 | 200 | 50 | 10 | 0.01 | 10 | 0 | 1 |  | Salamanders, AlienWormhole, PowerFirst | 20 |
| Alien Point Defense Array | AlienPointDefenseArray | Project_AlienMasterProject | 1 | Any | False | False | False | False | False | False | False | False | False | 3 | -25 | 100 | 90 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Griffins, PowerFirst | 2 |
| Alien Layered Defense Array | AlienLayeredDefenseArray | Project_AlienMasterProject | 2 | Any | False | False | False | False | False | False | False | False | False | 5 | -75 | 500 | 120 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | WarDogs, Griffins, PowerFirst | 4 |
| Alien Battlestations | AlienBattlestations | Project_AlienMasterProject | 3 | Any | False | False | False | False | False | False | False | False | False | 10 | -150 | 2500 | 180 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders, WarDogs, Griffins, PowerFirst | 6 |
| Alien Outpost Mining Complex | AlienOutpostMiningComplex | Project_AlienMasterProject | 1 | Base | False | True | True | False | False | False | False | False | False | 3 | -30 | 500 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |  | Cost_Scales_With_Gravity |  |
| Alien Settlement Mining Complex | AlienSettlementMiningComplex | Project_AlienMasterProject | 2 | Base | False | True | True | False | False | False | False | False | False | 5 | -60 | 2500 | 240 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 |  | Cost_Scales_With_Gravity |  |
| Alien Colony Mining Complex | AlienColonyMiningComplex | Project_AlienMasterProject | 3 | Base | False | True | True | False | False | False | False | False | False | 10 | -150 | 12500 | 360 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 1 |  | Cost_Scales_With_Gravity |  |
| Alien Barracks | AlienBarracks | Project_AlienMasterProject | 1 | Any | False | False | False | False | False | False | False | False | False | 24 | -10 | 100 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders, WarDogs, DropTroops, PowerFirst | 6 |
| Alien Garrison | AlienGarrison | Project_AlienMasterProject | 2 | Any | False | False | False | False | False | False | False | False | False | 96 | -30 | 500 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders, WarDogs, DropTroops, PowerFirst | 12 |
| Alien Citadel | AlienCitadel | Project_AlienMasterProject | 3 | Any | False | False | False | False | False | False | False | False | False | 256 | -60 | 2500 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | Salamanders, WarDogs, DropTroops, PowerFirst | 18 |
| Alien Observation Post | AlienObservationPost | Project_AlienMasterProject | 1 | Station | False | True | False | False | False | False | False | False | False | 16 | -15 | 50 | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | AlienSurveillance, StaticHab | 1 |
| Alien Surveillance Array | AlienSurveillanceArray | Project_AlienMasterProject | 2 | Station | False | True | False | False | False | False | False | False | False | 32 | -40 | 250 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | AlienSurveillance, StaticHab | 2 |
| Alien Watchtower | AlienWatchtower | Project_AlienMasterProject | 3 | Station | False | True | False | False | False | True | False | False | False | 64 | -80 | 1250 | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  | AlienSurveillance, StaticHab | 3 |
| Destroyed Module 11 | DestroyedModule11 |  | 1 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 12 | DestroyedModule12 |  | 1 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 13 | DestroyedModule13 |  | 1 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 21 | DestroyedModule21 |  | 2 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 22 | DestroyedModule22 |  | 2 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 23 | DestroyedModule23 |  | 2 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 31 | DestroyedModule31 |  | 3 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 32 | DestroyedModule32 |  | 3 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Destroyed Module 33 | DestroyedModule33 |  | 3 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 11 | AlienDestroyedModule11 |  | 1 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 12 | AlienDestroyedModule12 |  | 1 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 13 | AlienDestroyedModule13 |  | 1 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 21 | AlienDestroyedModule21 |  | 2 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 22 | AlienDestroyedModule22 |  | 2 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 23 | AlienDestroyedModule23 |  | 2 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 31 | AlienDestroyedModule31 |  | 3 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 32 | AlienDestroyedModule32 |  | 3 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |
| Alien Destroyed Module 33 | AlienDestroyedModule33 |  | 3 | Any | False | False | False | False | False | False | True | False | True | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |  |  |

## Monthly Upkeep

| Module | Template ID | Money/mo | Boost/mo | Water/mo | Vols/mo | Metals/mo | Nobles/mo | Fissiles/mo |
|---|---|---|---|---|---|---|---|---|
| Administration Node | AdministrationNode | 6 |  |  | 0.03 | 0.03 |  |  |
| Antimatter Trap | AntimatterTrap | 2 |  | 0.3 | 0.3 |  |  |  |
| Automated Fission Pile | AutomatedFissionPile | 0 |  | 0.5 |  |  |  | 0.05 |
| Automated Mining Complex | AutomatedMiningComplex | 0 |  | 1 | 1 |  |  |  |
| Automated Outpost Core | AutomatedOutpostCore | 0 |  |  |  |  |  |  |
| Automated Platform Core | AutomatedPlatformCore | 0 |  |  |  |  |  |  |
| Automated Solar Collector | AutomatedSolarCollector | 0 |  |  |  |  |  |  |
| Automated Supply Depot | AutomatedSupplyDepot | 0 |  |  |  |  |  |  |
| Broadcast Outlet | BroadcastOutlet | 4 |  |  |  |  |  |  |
| Construction Module | ConstructionModule | 3 |  | 1 | 1 | 3 | 0.25 |  |
| Energy Lab | EnergyLab | 2 |  |  | 1 |  |  | 0.001 |
| Fission Pile | FissionPile | 2 |  | 0.5 |  |  |  | 0.05 |
| Fusion Pile | FusionPile | 3 |  | 0.5 |  |  |  | 0.02 |
| Heavy Fission Pile | HeavyFissionPile | 3 |  | 0.5 |  |  |  | 0.075 |
| Heavy Fusion Pile | HeavyFusionPile | 5 |  | 1 | 0.5 | 0.1 | 0.1 | 0.02 |
| Hydroponics Bay | HydroponicsBay | 0 |  |  |  |  |  |  |
| Information Science Lab | InformationScienceLab | 2 |  |  |  |  |  |  |
| Life Science Lab | LifeScienceLab | 2 |  | 0.5 |  |  |  |  |
| Marine Platoon Barracks | MarinePlatoonBarracks | 3 |  |  | 1 | 1 |  |  |
| Materials Lab | MaterialsLab | 2 |  |  |  | 0.1 | 0.1 |  |
| Military Science Lab | MilitaryScienceLab | 2 |  |  |  |  |  |  |
| Outpost Core | OutpostCore | 3 |  |  |  |  |  |  |
| Outpost Mining Complex | OutpostMiningComplex | 6 |  | 1 | 1 |  |  |  |
| Particle Collider | ParticleCollider | 6 |  | 2 | 2 | 1 | 1 | 1 |
| Platform Core | PlatformCore | 2 |  |  |  |  |  |  |
| Point Defense Array | PointDefenseArray | 2 |  |  | 0.1 | 0.1 |  |  |
| Quarters | Quarters | 0 |  |  |  | 0.1 |  |  |
| Social Science Lab | SocialScienceLab | 3 |  |  |  |  |  |  |
| Solar Collector | SolarCollector | 1 |  |  |  |  |  |  |
| Space Dock | SpaceDock | 0 |  |  |  |  |  |  |
| Space Science Lab | SpaceScienceLab | 2 |  |  |  |  |  |  |
| Supply Depot | SupplyDepot | 0 |  | 0 | 0 |  |  |  |
| Tourist Berth | TouristBerth | 0 |  |  |  |  |  |  |
| Xenology Lab | XenologyLab | 2 |  |  |  |  |  |  |
| Administration Tower | AdministrationTower | 20 | 1 |  | 0.1 | 0.1 |  |  |
| Antimatter Harvester | AntimatterHarvester | 5 |  | 0.6 | 0.6 |  |  |  |
| Atomsmasher | Atomsmasher | 20 |  | 10 | 10 | 5 | 5 | 3 |
| Communications Hub | CommunicationsHub | 20 |  |  |  |  |  |  |
| Deep Space Telescope | DeepSpaceTelescope | 3 |  |  |  |  |  |  |
| Energy Research Center | EnergyResearchCenter | 6 |  |  | 3 |  |  | 0.001 |
| Farm | Farm | 0 |  |  |  |  |  |  |
| Fission Reactor Array | FissionReactorArray | 6 |  | 2 | 1 |  |  | 0.2 |
| Fusion Reactor Array | FusionReactorArray | 10 |  | 2 | 1 |  |  | 0.05 |
| Heavy Fission Reactor Array | HeavyFissionReactorArray | 8 |  | 2 | 1 |  |  | 0.3 |
| Heavy Fusion Reactor Array | HeavyFusionReactorArray | 12 |  | 4 | 2 | 0.5 | 0.5 | 0.08 |
| Information Science Research Center | InformationScienceResearchCenter | 6 |  |  |  |  |  |  |
| Layered Defense Array | LayeredDefenseArray | 10 |  |  | 1 | 1 | 0.5 |  |
| Life Science Research Center | LifeScienceResearchCenter | 6 |  | 1 | 1 |  |  |  |
| Marine Company Barracks | MarineCompanyBarracks | 10 |  |  | 2 | 2 |  |  |
| Materials Research Center | MaterialsResearchCenter | 6 |  |  | 1 | 1 | 0.5 |  |
| Military Science Research Center | MilitaryScienceResearchCenter | 6 |  |  |  |  |  |  |
| Nanofactory | Nanofactory | 10 |  | 3 | 3 | 10 | 1 |  |
| Operations Center | OperationsCenter | 15 |  |  | 0.5 | 0.5 | 0.25 |  |
| Orbital Hospital | OrbitalHospital | 0 | 1.5 | 5 | 3 |  |  |  |
| Research Campus | ResearchCampus | 30 |  | 3 | 3 |  |  |  |
| Residential Module | ResidentialModule | 0 | 1 | 3 | 1 | 1 |  |  |
| Orbital Core | OrbitalCore | 10 |  |  |  |  |  |  |
| Settlement Core | SettlementCore | 10 |  |  |  |  |  |  |
| Settlement Mining Complex | SettlementMiningComplex | 30 |  | 3 | 3 |  |  |  |
| Shipyard | Shipyard | 0 |  |  |  |  |  |  |
| Skunk Works | SkunkWorks | 10 |  |  | 3 | 3 | 0.1 |  |
| Social Science Research Center | SocialScienceResearchCenter | 8 |  |  |  |  |  |  |
| Solar Array | SolarArray | 3 |  |  |  |  |  |  |
| Space Hotel | SpaceHotel | 0 | 3 | 3 | 2 |  |  |  |
| Space Science Research Center | SpaceScienceResearchCenter | 6 |  |  |  |  |  |  |
| Xenoscience Research Center | XenoscienceResearchCenter | 6 |  |  |  |  |  |  |
| Administration Complex | AdministrationComplex | 100 | 3 |  | 1 | 1 |  |  |
| Agriculture Complex | AgricultureComplex | 0 |  |  |  |  |  |  |
| Antimatter Farm | AntimatterFarm | 10 |  | 5 | 5 | 5 | 2 | 1 |
| Battlestations | Battlestations | 30 |  |  | 3 | 3 | 1 |  |
| Civilian Complex | CivilianComplex | 0 | 3 | 10 | 6 | 2 |  |  |
| Colony Core | ColonyCore | 20 |  |  |  |  |  |  |
| Colony Mining Complex | ColonyMiningComplex | 60 |  | 5 | 5 |  |  |  |
| Command Center | CommandCenter | 30 |  |  | 1 | 1 | 0.5 |  |
| Energy Institute | EnergyInstitute | 18 |  |  | 10 |  |  | 0.01 |
| Fission Reactor Farm | FissionReactorFarm | 18 |  | 5 | 3 |  |  | 0.5 |
| Foundry | Foundry | 30 |  |  | 10 | 10 | 0.3 |  |
| Fusion Reactor Farm | FusionReactorFarm | 30 |  | 5 | 3 |  |  | 0.1 |
| Geriatrics Facility | GeriatricsFacility | 0 | 3 | 15 | 10 |  |  |  |
| Heavy Fission Reactor Farm | HeavyFissionReactorFarm | 24 |  | 5 | 3 |  |  | 0.75 |
| Heavy Fusion Reactor Farm | HeavyFusionReactorFarm | 36 |  | 10 | 6 | 1 | 1 | 0.2 |
| Helium-3 Mine | Helium-3Mine | 30 |  |  |  | 10 | 1.5 |  |
| Information Science Institute | InformationScienceInstitute | 18 |  |  |  |  |  |  |
| Interstellar Launching Laser | InterstellarLaunchingLaser | 20 |  |  |  |  |  |  |
| Life Science Institute | LifeScienceInstitute | 18 |  | 3 | 3 |  |  |  |
| Marine Battalion Barracks | MarineBattalionBarracks | 30 |  |  | 3 | 3 |  |  |
| Materials Institute | MaterialsInstitute | 18 |  |  | 3 | 3 | 1.5 |  |
| Media Center | MediaCenter | 60 |  |  |  |  |  |  |
| Military Science Institute | MilitaryScienceInstitute | 18 |  |  |  |  |  |  |
| Nanofacturing Complex | NanofacturingComplex | 20 |  | 10 | 10 | 30 | 3 |  |
| Research University | ResearchUniversity | 100 |  | 10 | 10 |  |  |  |
| Sentinel Complex | SentinelComplex | 20 |  |  |  |  |  |  |
| Social Science Institute | SocialScienceInstitute | 24 |  |  |  |  |  |  |
| Solar Farm | SolarFarm | 5 |  |  |  |  |  |  |
| Space Resort | SpaceResort | 0 | 6 | 10 | 5 |  |  |  |
| Space Science Institute | SpaceScienceInstitute | 18 |  |  |  |  |  |  |
| Spaceworks | Spaceworks | 0 |  |  |  |  |  |  |
| Supercollider | Supercollider | 120 |  | 30 | 30 | 20 | 20 | 10 |
| Ring Core | RingCore | 20 |  |  |  |  |  |  |
| Xenoscience Institute | XenoscienceInstitute | 18 |  |  |  |  |  |  |
| Alien Outpost Core | AlienOutpostCore | 0 |  |  |  |  |  |  |
| Alien Settlement Core | AlienSettlementCore | 0 |  |  |  |  |  |  |
| Alien Colony Core | AlienColonyCore | 0 |  |  |  |  |  |  |
| Alien Platform Core | AlienPlatformCore | 0 |  |  |  |  |  |  |
| Alien Orbital Core | AlienOrbitalCore | 0 |  |  |  |  |  |  |
| Alien Ring Core | AlienRingCore | 0 |  |  |  |  |  |  |
| Alien Spacedock | AlienSpacedock | 0 |  |  |  |  |  |  |
| Alien Shipyard | AlienShipyard | 0 |  |  |  |  |  |  |
| Alien Spaceworks | AlienSpaceworks | 0 |  |  |  |  |  |  |
| Alien Fusion Pile | AlienFusionPile | 0 |  |  |  |  |  | 0.01 |
| Alien Fusion Reactor Array | AlienFusionReactorArray | 0 |  |  |  |  |  | 0.01 |
| Alien Fusion Reactor Farm | AlienFusionReactorFarm | 0 |  |  |  |  |  | 0.01 |
| Alien Assembler | AlienAssembler | 0 |  |  |  |  |  |  |
| Alien Nanofactory | AlienNanofactory | 0 |  |  |  |  |  |  |
| Alien Nanofacturing Complex | AlienNanofacturingComplex | 0 |  |  |  |  |  |  |
| Alien Wormhole Facility | AlienWormholeFacility | 0 |  |  |  |  |  |  |
| Alien Point Defense Array | AlienPointDefenseArray | 0 |  |  |  |  |  |  |
| Alien Layered Defense Array | AlienLayeredDefenseArray | 0 |  |  |  |  |  |  |
| Alien Battlestations | AlienBattlestations | 0 |  |  |  |  |  |  |
| Alien Outpost Mining Complex | AlienOutpostMiningComplex | 0 |  |  |  |  |  |  |
| Alien Settlement Mining Complex | AlienSettlementMiningComplex | 0 |  |  |  |  |  |  |
| Alien Colony Mining Complex | AlienColonyMiningComplex | 0 |  |  |  |  |  |  |
| Alien Barracks | AlienBarracks | 0 |  |  |  |  |  |  |
| Alien Garrison | AlienGarrison | 0 |  |  |  |  |  |  |
| Alien Citadel | AlienCitadel | 0 |  |  |  |  |  |  |
| Alien Observation Post | AlienObservationPost | 0 |  |  |  |  |  |  |
| Alien Surveillance Array | AlienSurveillanceArray | 0 |  |  |  |  |  |  |
| Alien Watchtower | AlienWatchtower | 0 |  |  |  |  |  |  |
| Destroyed Module 11 | DestroyedModule11 | 0 |  |  |  |  |  |  |
| Destroyed Module 12 | DestroyedModule12 | 0 |  |  |  |  |  |  |
| Destroyed Module 13 | DestroyedModule13 | 0 |  |  |  |  |  |  |
| Destroyed Module 21 | DestroyedModule21 | 0 |  |  |  |  |  |  |
| Destroyed Module 22 | DestroyedModule22 | 0 |  |  |  |  |  |  |
| Destroyed Module 23 | DestroyedModule23 | 0 |  |  |  |  |  |  |
| Destroyed Module 31 | DestroyedModule31 | 0 |  |  |  |  |  |  |
| Destroyed Module 32 | DestroyedModule32 | 0 |  |  |  |  |  |  |
| Destroyed Module 33 | DestroyedModule33 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 11 | AlienDestroyedModule11 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 12 | AlienDestroyedModule12 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 13 | AlienDestroyedModule13 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 21 | AlienDestroyedModule21 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 22 | AlienDestroyedModule22 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 23 | AlienDestroyedModule23 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 31 | AlienDestroyedModule31 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 32 | AlienDestroyedModule32 | 0 |  |  |  |  |  |  |
| Alien Destroyed Module 33 | AlienDestroyedModule33 | 0 |  |  |  |  |  |  |

## Build Material Mix (weights)

| Module | Template ID | Water | Volatiles | Metals | Nobles | Fissiles | Exotics |
|---|---|---|---|---|---|---|---|
| Administration Node | AdministrationNode | 0.08 | 0.4 | 0.5 | 0.02 |  |  |
| Antimatter Trap | AntimatterTrap | 0.05 | 0.25 | 0.5 | 0.2 |  |  |
| Automated Fission Pile | AutomatedFissionPile | 0.075 | 0.3 | 0.475 | 0.1 | 0.05 |  |
| Automated Mining Complex | AutomatedMiningComplex | 0.1 | 0.15 | 0.72 | 0.03 |  |  |
| Automated Outpost Core | AutomatedOutpostCore | 0 | 0.4 | 0.5 | 0.1 |  |  |
| Automated Platform Core | AutomatedPlatformCore | 0 | 0.25 | 0.7 | 0.05 |  |  |
| Automated Solar Collector | AutomatedSolarCollector | 0 | 0.2 | 0.75 | 0.05 |  |  |
| Automated Supply Depot | AutomatedSupplyDepot | 0.12 | 0.46 | 0.4 | 0.02 |  |  |
| Broadcast Outlet | BroadcastOutlet | 0 | 0.35 | 0.6 | 0.05 |  |  |
| Construction Module | ConstructionModule | 0 | 0.35 | 0.65 |  |  |  |
| Energy Lab | EnergyLab | 0.009 | 0.2 | 0.74 | 0.05 | 0.001 |  |
| Fission Pile | FissionPile | 0.075 | 0.3 | 0.475 | 0.1 | 0.05 |  |
| Fusion Pile | FusionPile | 0.055 | 0.3 | 0.325 | 0.3 | 0.02 |  |
| Heavy Fission Pile | HeavyFissionPile | 0.05 | 0.3 | 0.5 | 0.1 | 0.05 |  |
| Heavy Fusion Pile | HeavyFusionPile | 0.03 | 0.25 | 0.35 | 0.35 | 0.02 |  |
| Hydroponics Bay | HydroponicsBay | 0.4 | 0.4 | 0.2 |  |  |  |
| Information Science Lab | InformationScienceLab | 0 | 0.4 | 0.55 | 0.05 |  |  |
| Life Science Lab | LifeScienceLab | 0.05 | 0.7 | 0.24 | 0.01 |  |  |
| Marine Platoon Barracks | MarinePlatoonBarracks | 0 | 0.2 | 0.78 | 0.02 |  |  |
| Materials Lab | MaterialsLab | 0.02 | 0.34 | 0.44 | 0.2 |  |  |
| Military Science Lab | MilitaryScienceLab | 0 | 0.35 | 0.64 | 0.01 |  |  |
| Outpost Core | OutpostCore | 0 | 0.5 | 0.5 |  |  |  |
| Outpost Mining Complex | OutpostMiningComplex | 0.1 | 0.1 | 0.79 | 0.01 |  |  |
| Particle Collider | ParticleCollider | 0.05 | 0.2 | 0.35 | 0.35 | 0.05 |  |
| Platform Core | PlatformCore | 0 | 0.5 | 0.5 |  |  |  |
| Point Defense Array | PointDefenseArray | 0 | 0.22 | 0.76 | 0.02 |  |  |
| Quarters | Quarters | 0.1 | 0.3 | 0.6 |  |  |  |
| Social Science Lab | SocialScienceLab | 0 | 0.4 | 0.6 |  |  |  |
| Solar Collector | SolarCollector | 0 | 0.2 | 0.75 | 0.05 |  |  |
| Space Dock | SpaceDock | 0 | 0.25 | 0.65 | 0.1 |  |  |
| Space Science Lab | SpaceScienceLab | 0 | 0.35 | 0.65 |  |  |  |
| Supply Depot | SupplyDepot | 0.12 | 0.46 | 0.4 | 0.02 |  |  |
| Tourist Berth | TouristBerth | 0.2 | 0.4 | 0.4 |  |  |  |
| Xenology Lab | XenologyLab | 0.01 | 0.33 | 0.65 | 0.01 |  |  |
| Administration Tower | AdministrationTower | 0.08 | 0.4 | 0.5 | 0.02 |  |  |
| Antimatter Harvester | AntimatterHarvester | 0.05 | 0.25 | 0.5 | 0.2 |  |  |
| Atomsmasher | Atomsmasher | 0.05 | 0.2 | 0.35 | 0.35 | 0.05 |  |
| Communications Hub | CommunicationsHub | 0 | 0.35 | 0.6 | 0.05 |  |  |
| Deep Space Telescope | DeepSpaceTelescope | 0 | 0.3 | 0.6 | 0.1 |  |  |
| Energy Research Center | EnergyResearchCenter | 0.024 | 0.2 | 0.725 | 0.05 | 0.001 |  |
| Farm | Farm | 0.45 | 0.45 | 0.1 |  |  |  |
| Fission Reactor Array | FissionReactorArray | 0.05 | 0.3 | 0.5 | 0.1 | 0.05 |  |
| Fusion Reactor Array | FusionReactorArray | 0.03 | 0.3 | 0.35 | 0.3 | 0.02 |  |
| Heavy Fission Reactor Array | HeavyFissionReactorArray | 0.05 | 0.3 | 0.5 | 0.1 | 0.05 |  |
| Heavy Fusion Reactor Array | HeavyFusionReactorArray | 0.03 | 0.25 | 0.35 | 0.35 | 0.02 |  |
| Information Science Research Center | InformationScienceResearchCenter | 0 | 0.4 | 0.55 | 0.05 |  |  |
| Layered Defense Array | LayeredDefenseArray | 0 | 0.22 | 0.76 | 0.02 |  |  |
| Life Science Research Center | LifeScienceResearchCenter | 0.05 | 0.7 | 0.24 | 0.01 |  |  |
| Marine Company Barracks | MarineCompanyBarracks | 0 | 0.2 | 0.78 | 0.02 |  |  |
| Materials Research Center | MaterialsResearchCenter | 0.02 | 0.34 | 0.44 | 0.2 |  |  |
| Military Science Research Center | MilitaryScienceResearchCenter | 0 | 0.35 | 0.64 | 0.01 |  |  |
| Nanofactory | Nanofactory | 0 | 0.35 | 0.5 | 0.15 |  |  |
| Operations Center | OperationsCenter | 0 | 0.1 | 0.8 | 0.1 |  |  |
| Orbital Hospital | OrbitalHospital | 0.25 | 0.5 | 0.2 | 0.05 |  |  |
| Research Campus | ResearchCampus | 0.18 | 0.4 | 0.4 | 0.02 |  |  |
| Residential Module | ResidentialModule | 0.1 | 0.3 | 0.6 |  |  |  |
| Orbital Core | OrbitalCore | 0 | 0.5 | 0.5 |  |  |  |
| Settlement Core | SettlementCore | 0 | 0.5 | 0.5 |  |  |  |
| Settlement Mining Complex | SettlementMiningComplex | 0.1 | 0.1 | 0.79 | 0.01 |  |  |
| Shipyard | Shipyard | 0 | 0.22 | 0.68 | 0.1 |  |  |
| Skunk Works | SkunkWorks | 0.05 | 0.2 | 0.65 | 0.1 |  |  |
| Social Science Research Center | SocialScienceResearchCenter | 0 | 0.4 | 0.6 |  |  |  |
| Solar Array | SolarArray | 0 | 0.2 | 0.75 | 0.05 |  |  |
| Space Hotel | SpaceHotel | 0.2 | 0.38 | 0.4 | 0.02 |  |  |
| Space Science Research Center | SpaceScienceResearchCenter | 0 | 0.4 | 0.6 |  |  |  |
| Xenoscience Research Center | XenoscienceResearchCenter | 0.01 | 0.33 | 0.65 | 0.01 |  |  |
| Administration Complex | AdministrationComplex | 0.08 | 0.4 | 0.5 | 0.02 |  |  |
| Agriculture Complex | AgricultureComplex | 0.45 | 0.45 | 0.1 |  |  |  |
| Antimatter Farm | AntimatterFarm | 0.05 | 0.25 | 0.5 | 0.2 |  |  |
| Battlestations | Battlestations | 0 | 0.22 | 0.76 | 0.02 |  |  |
| Civilian Complex | CivilianComplex | 0.1 | 0.3 | 0.6 |  |  |  |
| Colony Core | ColonyCore | 0 | 0.5 | 0.5 |  |  |  |
| Colony Mining Complex | ColonyMiningComplex | 0.1 | 0.1 | 0.79 | 0.01 |  |  |
| Command Center | CommandCenter | 0 | 0.1 | 0.8 | 0.1 |  |  |
| Energy Institute | EnergyInstitute | 0 | 0.199 | 0.75 | 0.05 | 0.001 |  |
| Fission Reactor Farm | FissionReactorFarm | 0.05 | 0.3 | 0.5 | 0.1 | 0.05 |  |
| Foundry | Foundry | 0.05 | 0.2 | 0.55 | 0.2 |  |  |
| Fusion Reactor Farm | FusionReactorFarm | 0.03 | 0.3 | 0.35 | 0.3 | 0.02 |  |
| Geriatrics Facility | GeriatricsFacility | 0.2 | 0.45 | 0.34 | 0.01 |  |  |
| Heavy Fission Reactor Farm | HeavyFissionReactorFarm | 0.05 | 0.3 | 0.5 | 0.1 | 0.05 |  |
| Heavy Fusion Reactor Farm | HeavyFusionReactorFarm | 0.03 | 0.25 | 0.35 | 0.35 | 0.02 |  |
| Helium-3 Mine | Helium-3Mine | 0.05 | 0.15 | 0.55 | 0.25 |  |  |
| Information Science Institute | InformationScienceInstitute | 0 | 0.4 | 0.55 | 0.05 |  |  |
| Interstellar Launching Laser | InterstellarLaunchingLaser | 0.094 | 0.2 | 0.44 | 0.25 |  | 0.016 |
| Life Science Institute | LifeScienceInstitute | 0.05 | 0.7 | 0.24 | 0.01 |  |  |
| Marine Battalion Barracks | MarineBattalionBarracks | 0 | 0.2 | 0.78 | 0.02 |  |  |
| Materials Institute | MaterialsInstitute | 0.02 | 0.34 | 0.44 | 0.2 |  |  |
| Media Center | MediaCenter | 0 | 0.35 | 0.6 | 0.05 |  |  |
| Military Science Institute | MilitaryScienceInstitute | 0 | 0.35 | 0.64 | 0.01 |  |  |
| Nanofacturing Complex | NanofacturingComplex | 0 | 0.35 | 0.5 | 0.15 |  |  |
| Research University | ResearchUniversity | 0.18 | 0.4 | 0.4 | 0.02 |  |  |
| Sentinel Complex | SentinelComplex | 0 | 0.38 | 0.4 | 0.2 |  | 0.02 |
| Social Science Institute | SocialScienceInstitute | 0 | 0.4 | 0.6 |  |  |  |
| Solar Farm | SolarFarm | 0 | 0.2 | 0.75 | 0.05 |  |  |
| Space Resort | SpaceResort | 0.2 | 0.4 | 0.4 |  |  |  |
| Space Science Institute | SpaceScienceInstitute | 0 | 0.4 | 0.6 |  |  |  |
| Spaceworks | Spaceworks | 0 | 0.22 | 0.68 | 0.1 |  |  |
| Supercollider | Supercollider | 0.05 | 0.15 | 0.35 | 0.35 | 0.1 |  |
| Ring Core | RingCore | 0 | 0.5 | 0.5 |  |  |  |
| Xenoscience Institute | XenoscienceInstitute | 0.01 | 0.32 | 0.65 | 0.01 |  | 0.01 |
| Alien Outpost Core | AlienOutpostCore | 0 | 0.4 | 0.6 |  |  |  |
| Alien Settlement Core | AlienSettlementCore | 0 | 0.4 | 0.6 |  |  |  |
| Alien Colony Core | AlienColonyCore | 0 | 0.4 | 0.6 |  |  |  |
| Alien Platform Core | AlienPlatformCore | 0 | 0.4 | 0.6 |  |  |  |
| Alien Orbital Core | AlienOrbitalCore | 0 | 0.4 | 0.6 |  |  |  |
| Alien Ring Core | AlienRingCore | 0 | 0.4 | 0.6 |  |  |  |
| Alien Spacedock | AlienSpacedock | 0 | 0.3 | 0.6 | 0.1 |  |  |
| Alien Shipyard | AlienShipyard | 0 | 0.3 | 0.6 | 0.1 |  |  |
| Alien Spaceworks | AlienSpaceworks | 0 | 0.3 | 0.6 | 0.1 |  |  |
| Alien Fusion Pile | AlienFusionPile | 0.05 | 0.3 | 0.4 | 0.23 | 0.01 | 0.01 |
| Alien Fusion Reactor Array | AlienFusionReactorArray | 0.05 | 0.3 | 0.4 | 0.23 | 0.01 | 0.01 |
| Alien Fusion Reactor Farm | AlienFusionReactorFarm | 0.05 | 0.3 | 0.4 | 0.23 | 0.01 | 0.01 |
| Alien Assembler | AlienAssembler | 0 | 0.4 | 0.4 | 0.2 |  |  |
| Alien Nanofactory | AlienNanofactory | 0 | 0.4 | 0.4 | 0.2 |  |  |
| Alien Nanofacturing Complex | AlienNanofacturingComplex | 0 | 0.4 | 0.4 | 0.2 |  |  |
| Alien Wormhole Facility | AlienWormholeFacility | 0 | 0.25 | 0.25 | 0.2 | 0.1 | 0.15 |
| Alien Point Defense Array | AlienPointDefenseArray | 0 | 0.3 | 0.6 | 0.1 |  |  |
| Alien Layered Defense Array | AlienLayeredDefenseArray | 0 | 0.3 | 0.6 | 0.1 |  |  |
| Alien Battlestations | AlienBattlestations | 0 | 0.29 | 0.6 | 0.1 |  | 0.01 |
| Alien Outpost Mining Complex | AlienOutpostMiningComplex | 0.2 | 0.15 | 0.64 | 0.01 |  |  |
| Alien Settlement Mining Complex | AlienSettlementMiningComplex | 0.2 | 0.15 | 0.64 | 0.01 |  |  |
| Alien Colony Mining Complex | AlienColonyMiningComplex | 0.2 | 0.15 | 0.64 | 0.01 |  |  |
| Alien Barracks | AlienBarracks | 0 | 0.35 | 0.55 | 0.1 |  |  |
| Alien Garrison | AlienGarrison | 0 | 0.35 | 0.55 | 0.1 |  |  |
| Alien Citadel | AlienCitadel | 0 | 0.35 | 0.55 | 0.1 |  |  |
| Alien Observation Post | AlienObservationPost |  |  |  |  |  |  |
| Alien Surveillance Array | AlienSurveillanceArray |  |  |  |  |  |  |
| Alien Watchtower | AlienWatchtower |  |  |  |  |  |  |
| Destroyed Module 11 | DestroyedModule11 |  |  |  |  |  |  |
| Destroyed Module 12 | DestroyedModule12 |  |  |  |  |  |  |
| Destroyed Module 13 | DestroyedModule13 |  |  |  |  |  |  |
| Destroyed Module 21 | DestroyedModule21 |  |  |  |  |  |  |
| Destroyed Module 22 | DestroyedModule22 |  |  |  |  |  |  |
| Destroyed Module 23 | DestroyedModule23 |  |  |  |  |  |  |
| Destroyed Module 31 | DestroyedModule31 |  |  |  |  |  |  |
| Destroyed Module 32 | DestroyedModule32 |  |  |  |  |  |  |
| Destroyed Module 33 | DestroyedModule33 |  |  |  |  |  |  |
| Alien Destroyed Module 11 | AlienDestroyedModule11 |  |  |  |  |  |  |
| Alien Destroyed Module 12 | AlienDestroyedModule12 |  |  |  |  |  |  |
| Alien Destroyed Module 13 | AlienDestroyedModule13 |  |  |  |  |  |  |
| Alien Destroyed Module 21 | AlienDestroyedModule21 |  |  |  |  |  |  |
| Alien Destroyed Module 22 | AlienDestroyedModule22 |  |  |  |  |  |  |
| Alien Destroyed Module 23 | AlienDestroyedModule23 |  |  |  |  |  |  |
| Alien Destroyed Module 31 | AlienDestroyedModule31 |  |  |  |  |  |  |
| Alien Destroyed Module 32 | AlienDestroyedModule32 |  |  |  |  |  |  |
| Alien Destroyed Module 33 | AlienDestroyedModule33 |  |  |  |  |  |  |

