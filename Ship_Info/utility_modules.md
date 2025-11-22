# Utility Modules Reference

## Overview

Utility modules expand ship capabilities beyond core systems (drive, reactor, radiators, armor, weapons). They are placed in **utility hardpoint slots** on the ship hull. **Additional batteries** (same type as primary) and **heat sinks** can also be placed in utility slots.

> [!IMPORTANT]
> Every ship has ONE primary battery slot (required). Additional batteries of the SAME TYPE can be placed in utility slots for greater capacity. All batteries must match to save a design.

---

## Combat Systems

### Electronic Warfare

| Module | Mass (tons) | Effect |
|--------|-------------|---------|
| ECM | 10 | 20% chance to force an enemy weapon into cooldown when this ship is targeted |
| ECM Mark II | 10 | 40% chance to force an enemy weapon into cooldown when this ship is targeted |
| ECM Mark III | 10 | 60% chance to force an enemy weapon into cooldown when this ship is targeted |
| Targeting Computer | 10 | Improve ship's roll to overcome enemy ECM and damage to sensors by 10% |
| Targeting Computer Mark II | 10 | Improve ship's roll to overcome enemy ECM and damage to sensors by 30% |
| Targeting Computer Mark III | 10 | Improve ship's roll to overcome enemy ECM and damage to sensors by 50% |

**Notes**:
- ECM modules do NOT stack with each other on the same ship (highest level applies)
- Targeting Computers help overcome both enemy ECM and sensor damage
- ECM is highly effective against guided weapons and precision targeting

### Ship Defense & Survivability

| Module | Mass (tons) | Effect |
|--------|-------------|---------|
| Component Armor | 500 | -25% Internal Damage during combat |
| Armor Strut | 500 | Increase the amount of armor each facing on ship can carry by 100% |
| Vector Thrusters | 20 | Significantly increases the ship's turning speed |

**Notes**:
- Component Armor reduces damage that penetrates the outer armor to internal systems
- Armor Struts allow doubling armor thickness (critical for heavy warships)
- Vector Thrusters improve turn rate, especially valuable on longer hulls

---

## Science & Logistics

### Science Operations

| Module | Mass (tons) | Effect |
|--------|-------------|---------|
| Mobile Space Science Lab | 200 | +5% Space Science Research<br>Can prospect space bodies from interface orbits |

### Repair & Salvage

| Module | Mass (tons) | Effect |
|--------|-------------|---------|
| Repair Bay | 700 | Improves mid- and post-combat repairs |
| Salvage Bay | 1000 | Collects more Salvage after Winning Combats |

### Fleet Command

| Module | Mass (tons) | Effect |
|--------|-------------|---------|
| Flag Bridge | 90 | Reduces the fleet's Mission Control upkeep |

**Notes**:
- Flag Bridge bonuses do NOT stack (only one per fleet provides benefit)
- Repair Bays speed up damage control during and after combat
- Salvage Bays increase resource recovery from destroyed enemy ships

---

## Marines

### Marine Assault Units

| Module | Mass (tons) | Assault Value | Effect |
|--------|-------------|---------------|---------|
| Marine Assault Unit | 200 | 4 | Enables the Assault Hab fleet operation |
| Advanced Marine Assault Unit | 200 | 6 | Enables the Assault Hab fleet operation |
| Elite Marine Assault Unit | 200 | 8 | Enables the Assault Hab fleet operation |
| **Faction-Specific Elite Marines** | 200 | 10 | Enables the Assault Hab fleet operation |

**Faction-Specific Units**:
- **Humanity First**: Spartans
- **The Resistance**: Rangers
- **The Servants**: Immortals

**Notes**:
- Required to perform hab assault operations
- Higher assault values increase success chance
- Each faction gets unique elite units with assault value 10

---

## Weapon Enhancements

### Energy Weapon Boosters

| Module | Mass (tons) | Ship Requirements | Effect |
|--------|-------------|-------------------|---------|
| Laser Engine | 25 | - | +10MJ laser weapon power |
| Advanced Laser Engine | 50 | - | +20MJ laser weapon power |
| Cyclotron | 50 | - | +20MJ particle beam power |

### Ammunition Systems

| Module | Mass (tons) | Effect |
|--------|-------------|---------|
| Magazine | 100 | Projectile weapons gain +50% ammo. Mass increases accordingly. |

**Notes**:
- Laser/Cyclotron boosts affect ALL corresponding weapons on the ship
- Magazines are essential for sustained kinetic/missile combat
- Magazine mass increase is proportional to ammo added

---

## Drive Enhancements

### Thrust Boosters (Spikers)

| Module | Mass (tons) | Ship Requirements | Effect |
|--------|-------------|-------------------|---------|
| Muon Spiker | 40 | Nuclear Fusion Drive | +10% Thrust |
| Neutronium Spiker | 40 | Nuclear Fission Drive | +20% Thrust |
| Antimatter Spiker | 40 | Nuclear Drive | +30% Thrust |

### Hydrogen Propellant Optimization

| Module | Mass (tons) | Ship Requirements | Effect |
|--------|-------------|-------------------|---------|
| Liquid Hydrogen Containment | 5 | Hydrogen Propellant | +20% Exhaust Velocity |
| Slush Hydrogen Tankage | 10 | Hydrogen Propellant | +35% Exhaust Velocity |
| Hydron Trap | 20 | Hydrogen Propellant | +50% Exhaust Velocity |

**Notes**:
- Spikers only work with drives using the corresponding reactor type
- Only ONE spiker can be equipped per ship
- Hydrogen optimization modules only work with hydrogen-based propellant
- Only ONE hydrogen optimization module can be equipped per ship
- Exhaust velocity boosts directly improve Delta-V efficiency

---

## Resupply & Logistics

### Propellant Resupply

| Module | Mass (tons) | Effect |
|--------|-------------|---------|
| ISRU Module | 40 | Can replenish Propellant at unimproved hab sites that produce raw materials used in ship's propellant |
| Remass Scoop | 40 | Can replenish Propellant in interface orbits of Jovian planets if the ship uses 100% hydrogen or 'anything' as propellant<br>No aerobraking damage (aerobraking not implemented yet) |

**Notes**:
- ISRU allows refueling at mining sites without built habs
- Remass Scoops work at Gas Giants (Jupiter, Saturn, Uranus, Neptune)
- Some advanced drives (Mass Driver, E-Beam, Pulsed Plasmoid, Superconducting Mass Driver) have built-in ISRU
- Cannot share refueling modules between ships - each ship needs its own

---

## Heat Sinks

Heat sinks are critical for combat ships to avoid exposing vulnerable radiators to enemy fire.

### Heat Sink Mechanics

| Radiator State | Heat Sink Behavior | Effect |
|----------------|-------------------|---------|
| **Destroyed / Retracting / Retracted** | Absorbs heat | Heat generated by modules is added to Heat Sinks |
| **Extending / Extended** | Vents heat | Heat Sinks lose 0.1 GJ heat per second × Radiator Health % |
| **Heat exceeds capacity** | Critical damage | Apply (Excess Heat GJ × 50) Explosion Damage directly to ship Core |

**Usage Strategy**:
- Retract radiators at combat start to protect them
- Fight on heat sinks until capacity nearly full
- Extend radiators briefly to vent heat when safe
- Repeat cycle to maximize survivability

For specific heat sink stats, see [`Heat Sink List`](https://wiki.hoodedhorse.com/Terra_Invicta/Heat_Sink_List) or check `TIHeatSinkTemplate.json`.

---

## Colony Kits

Kits allow creation of small habs with construction modules. Can be replenished by repairing the ship at a dock or shipyard.

### Solar-Powered Kits

| Kit | Mass (tons) | Constructed Modules |
|-----|-------------|---------------------|
| Solar Platform | 200 | Platform Core, Construction Module, Solar Collector |
| Solar Outpost | 200 | Outpost Core, Construction Module, Solar Collector |

### Fission-Powered Kits

| Kit | Mass (tons) | Constructed Modules |
|-----|-------------|---------------------|
| Fission Platform | 250 | Platform Core, Construction Module, Fission Pile |
| Fission Outpost | 300 | Outpost Core, Construction Module, Fission Pile |

### Fusion-Powered Kits

| Kit | Mass (tons) | Constructed Modules |
|-----|-------------|---------------------|
| Fusion Platform | 250 | Platform Core, Construction Module, Fusion Pile |
| Fusion Outpost | 300 | Outpost Core, Construction Module, Fusion Pile |

### Automated Kits

| Kit | Mass (tons) | Constructed Modules |
|-----|-------------|---------------------|
| Automated Solar Platform | 250 | Automated Platform Core, Automated Supply Depot, Automated Solar Collector |
| Automated Solar Outpost | 1200 | Automated Outpost Core, Automated Mining Complex, Automated Solar Collector, Automated Solar Collector |
| Automated Fission Platform | 300 | Automated Platform Core, Automated Supply Depot, Automated Fission Pile |
| Automated Fission Outpost | 1800 | Automated Outpost Core, Automated Mining Complex, Automated Fission Pile, Automated Fission Pile |

**Notes**:
- Using a kit only **begins construction** - you still wait 180 days for the Construction Module to be built
- Solar kits are cheaper but only work well in inner system (closer to Sun)
- Fission/Fusion kits work anywhere but cost more
- Outposts have mining capability, Platforms do not
- Automated kits require no crew but are more expensive

---

## Design Guidelines

### Recommended Utility Loadouts by Role

**Interceptor / Patrol (Short Range Combat)**
- 1× ECM (Mark II or III)
- 1× Vector Thrusters
- 1× Magazine (if using kinetics)

**Space Superiority / Strike (Balanced Combat)**
- 1× ECM Mark II
- 1× Targeting Computer
- 1× Additional Battery (if using energy weapons) OR Magazine (if using kinetics)

**Bomber / Standoff (Long Range Combat)**
- 1× Targeting Computer Mark II or III
- 1× Magazine OR Additional Battery
- 1× ECM or Component Armor

**Protector (Point Defense Focus)**
- 1× ECM Mark III
- 1× Component Armor
- 1× Additional Battery (PD lasers drain batteries quickly)

**Explorer**
- 1× Mobile Space Science Lab (required)
- 1× ISRU Module (for extended range)
- 1× Repair Bay (self-sufficiency)

**Colony Ship**
- 1× Hab Kit (required - type depends on destination)
- 1× ISRU Module
- 1× Repair Bay

**Long-Range Fleet Flagship**
- 1× Flag Bridge
- 1× Repair Bay
- 1× Salvage Bay
- Additional slots: Remass Scoop or ISRU for extended operations

### Utility Slot Priority

1. **Role-Required Modules** (e.g., Lab for Explorer, Kit for Colony Ship, Marines for Assault)
2. **ECM** (combat survivability boost)
3. **Additional Batteries** (for energy weapon ships) OR **Magazines** (for kinetic ships)
4. **Targeting Computers** (for long-range precision ships)
5. **Drive Enhancers** (Spikers, Hydrogen optimization)
6. **Component Armor** (heavy combat ships)
7. **Vector Thrusters** (improves maneuverability on larger hulls)
8. **Logistics** (ISRU, Remass Scoop for long-range operations)
