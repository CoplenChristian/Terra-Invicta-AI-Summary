# Terra Invicta Ship Components

Source: Ship_Info/raw_json/*.json from the Again campaign export.
Each section summarizes one template file. Mass values are in tons where applicable.

---

## Batteries

| Component | Template ID | Required Project | Mass (t) | Crew | HP | Energy (GJ) | Recharge (GJ/s) |
|---|---|---|---|---|---|---|---|
| Lithium-Ion Battery | Lithium-IonBattery |  | 30 | 0 | 3 | 15 | 0.005 |
| Lithium-Sulfur Battery | Lithium-SulfurBattery | Project_Lithium-SulfurBattery | 35 | 0 | 3 | 21 | 0.00625 |
| Molten Salt Battery | MoltenSaltBattery | Project_MoltenSaltBattery | 80 | 0 | 3 | 40 | 0.0075 |
| Salt Water Battery | SaltWaterBattery | Project_SaltWaterBattery | 20 | 0 | 8 | 20 | 0.01 |
| Graphene Battery | GrapheneBattery | Project_GrapheneBattery | 120 | 1 | 3 | 48 | 0.025 |
| Quantum Battery | QuantumBattery | Project_QuantumBattery | 80 | 1 | 3 | 80 | 0.05 |
| Superconducting Coil Battery | SuperconductingCoilBattery | Project_SuperconductingCoilBattery | 2 | 1 | 4 | 40 | 0.075 |
| Exotic Nanowire Battery | ExoticNanowireBattery | Project_ExoticNanowireBattery | 10 | 1 | 4 | 60 | 0.1 |
| Alien Superconducting Coil Battery | AlienSuperconductingCoilBattery | Project_AlienMasterProject | 2 | 1 | 6 | 40 | 0.075 |
| Alien Exotic Nanowire Battery | AlienExoticNanowireBattery | Project_AlienMasterProject | 10 | 1 | 8 | 60 | 0.1 |

## Drives

| Component | Template ID | Required Project | Class | Thrusters | Mass (t) | Thrust (N) | Exhaust Vel. (km/s) | kg/MW | Eff. | Thrust Rating (GW) | Req. Power (GW) | Propellant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Apex Solid Rocket x1 | ApexSolidRocketx1 | Project_Solid-FuelSpaceRockets | Chemical | 1 | 66 | 14820000 | 2.6 | 0 | 1 | 19.266 | 0.000 | ReactionProducts |
| Apex Solid Rocket x2 | ApexSolidRocketx2 | Project_Solid-FuelSpaceRockets | Chemical | 2 | 132 | 29640000 | 2.6 | 0 | 1 | 38.532 | 0.000 | ReactionProducts |
| Apex Solid Rocket x3 | ApexSolidRocketx3 | Project_Solid-FuelSpaceRockets | Chemical | 3 | 198 | 44460000 | 2.6 | 0 | 1 | 57.798 | 0.000 | ReactionProducts |
| Apex Solid Rocket x4 | ApexSolidRocketx4 | Project_Solid-FuelSpaceRockets | Chemical | 4 | 264 | 59280000 | 2.6 | 0 | 1 | 77.064 | 0.000 | ReactionProducts |
| Apex Solid Rocket x5 | ApexSolidRocketx5 | Project_Solid-FuelSpaceRockets | Chemical | 5 | 330 | 74100000 | 2.6 | 0 | 1 | 96.330 | 0.000 | ReactionProducts |
| Apex Solid Rocket x6 | ApexSolidRocketx6 | Project_Solid-FuelSpaceRockets | Chemical | 6 | 396 | 88920000 | 2.6 | 0 | 1 | 115.596 | 0.000 | ReactionProducts |
| Meteor Liquid Rocket x1 | MeteorLiquidRocketx1 | Project_Liquid-FuelRockets | Chemical | 1 | 17 | 15481000 | 2.98 | 0 | 1 | 23.067 | 0.000 | ReactionProducts |
| Meteor Liquid Rocket x2 | MeteorLiquidRocketx2 | Project_Liquid-FuelRockets | Chemical | 2 | 34 | 30962000 | 2.98 | 0 | 1 | 46.133 | 0.000 | ReactionProducts |
| Meteor Liquid Rocket x3 | MeteorLiquidRocketx3 | Project_Liquid-FuelRockets | Chemical | 3 | 51 | 46443000 | 2.98 | 0 | 1 | 69.200 | 0.000 | ReactionProducts |
| Meteor Liquid Rocket x4 | MeteorLiquidRocketx4 | Project_Liquid-FuelRockets | Chemical | 4 | 68 | 61924000 | 2.98 | 0 | 1 | 92.267 | 0.000 | ReactionProducts |
| Meteor Liquid Rocket x5 | MeteorLiquidRocketx5 | Project_Liquid-FuelRockets | Chemical | 5 | 85 | 77405000 | 2.98 | 0 | 1 | 115.333 | 0.000 | ReactionProducts |
| Meteor Liquid Rocket x6 | MeteorLiquidRocketx6 | Project_Liquid-FuelRockets | Chemical | 6 | 102 | 92886000 | 2.98 | 0 | 1 | 138.400 | 0.000 | ReactionProducts |
| Neutron Liquid Rocket x1 | NeutronLiquidRocketx1 | Project_Liquid-FuelRockets | Chemical | 1 | 13 | 20376000 | 3.1 | 0 | 1 | 31.583 | 0.000 | ReactionProducts |
| Neutron Liquid Rocket x2 | NeutronLiquidRocketx2 | Project_Liquid-FuelRockets | Chemical | 2 | 26 | 40752000 | 3.1 | 0 | 1 | 63.166 | 0.000 | ReactionProducts |
| Neutron Liquid Rocket x3 | NeutronLiquidRocketx3 | Project_Liquid-FuelRockets | Chemical | 3 | 39 | 61128000 | 3.1 | 0 | 1 | 94.748 | 0.000 | ReactionProducts |
| Neutron Liquid Rocket x4 | NeutronLiquidRocketx4 | Project_Liquid-FuelRockets | Chemical | 4 | 52 | 81504000 | 3.1 | 0 | 1 | 126.331 | 0.000 | ReactionProducts |
| Neutron Liquid Rocket x5 | NeutronLiquidRocketx5 | Project_Liquid-FuelRockets | Chemical | 5 | 65 | 101880000 | 3.1 | 0 | 1 | 157.914 | 0.000 | ReactionProducts |
| Neutron Liquid Rocket x6 | NeutronLiquidRocketx6 | Project_Liquid-FuelRockets | Chemical | 6 | 78 | 122256000 | 3.1 | 0 | 1 | 189.497 | 0.000 | ReactionProducts |
| Venture Liquid Rocket x1 | VentureLiquidRocketx1 | Project_CryogenicLiquid-FuelRockets | Chemical | 1 | 14 | 9279600 | 4.44 | 0 | 1 | 20.601 | 0.000 | ReactionProducts |
| Venture Liquid Rocket x2 | VentureLiquidRocketx2 | Project_CryogenicLiquid-FuelRockets | Chemical | 2 | 28 | 18559200 | 4.44 | 0 | 1 | 41.201 | 0.000 | ReactionProducts |
| Venture Liquid Rocket x3 | VentureLiquidRocketx3 | Project_CryogenicLiquid-FuelRockets | Chemical | 3 | 42 | 27838800 | 4.44 | 0 | 1 | 61.802 | 0.000 | ReactionProducts |
| Venture Liquid Rocket x4 | VentureLiquidRocketx4 | Project_CryogenicLiquid-FuelRockets | Chemical | 4 | 56 | 37118400 | 4.44 | 0 | 1 | 82.403 | 0.000 | ReactionProducts |
| Venture Liquid Rocket x5 | VentureLiquidRocketx5 | Project_CryogenicLiquid-FuelRockets | Chemical | 5 | 70 | 46398000 | 4.44 | 0 | 1 | 103.004 | 0.000 | ReactionProducts |
| Venture Liquid Rocket x6 | VentureLiquidRocketx6 | Project_CryogenicLiquid-FuelRockets | Chemical | 6 | 84 | 55677600 | 4.44 | 0 | 1 | 123.604 | 0.000 | ReactionProducts |
| Diana Superheavy Rocket x1 | DianaSuperheavyRocketx1 | Project_SuperheavyRockets | Chemical | 1 | 14 | 20160000 | 3.73 | 0 | 1 | 37.598 | 0.000 | ReactionProducts |
| Diana Superheavy Rocket x2 | DianaSuperheavyRocketx2 | Project_SuperheavyRockets | Chemical | 2 | 28 | 40320000 | 3.73 | 0 | 1 | 75.197 | 0.000 | ReactionProducts |
| Diana Superheavy Rocket x3 | DianaSuperheavyRocketx3 | Project_SuperheavyRockets | Chemical | 3 | 42 | 60480000 | 3.73 | 0 | 1 | 112.795 | 0.000 | ReactionProducts |
| Diana Superheavy Rocket x4 | DianaSuperheavyRocketx4 | Project_SuperheavyRockets | Chemical | 4 | 56 | 80640000 | 3.73 | 0 | 1 | 150.394 | 0.000 | ReactionProducts |
| Diana Superheavy Rocket x5 | DianaSuperheavyRocketx5 | Project_SuperheavyRockets | Chemical | 5 | 70 | 100800000 | 3.73 | 0 | 1 | 187.992 | 0.000 | ReactionProducts |
| Diana Superheavy Rocket x6 | DianaSuperheavyRocketx6 | Project_SuperheavyRockets | Chemical | 6 | 84 | 120960000 | 3.73 | 0 | 1 | 225.590 | 0.000 | ReactionProducts |
| Nova Liquid Rocket x1 | NovaLiquidRocketx1 | Project_ImprovedInterplanetaryRockets | Chemical | 1 | 15 | 7850000 | 5.6 | 0 | 1 | 21.980 | 0.000 | ReactionProducts |
| Nova Liquid Rocket x2 | NovaLiquidRocketx2 | Project_ImprovedInterplanetaryRockets | Chemical | 2 | 30 | 15700000 | 5.6 | 0 | 1 | 43.960 | 0.000 | ReactionProducts |
| Nova Liquid Rocket x3 | NovaLiquidRocketx3 | Project_ImprovedInterplanetaryRockets | Chemical | 3 | 45 | 23550000 | 5.6 | 0 | 1 | 65.940 | 0.000 | ReactionProducts |
| Nova Liquid Rocket x4 | NovaLiquidRocketx4 | Project_ImprovedInterplanetaryRockets | Chemical | 4 | 60 | 31400000 | 5.6 | 0 | 1 | 87.920 | 0.000 | ReactionProducts |
| Nova Liquid Rocket x5 | NovaLiquidRocketx5 | Project_ImprovedInterplanetaryRockets | Chemical | 5 | 75 | 39250000 | 5.6 | 0 | 1 | 109.900 | 0.000 | ReactionProducts |
| Nova Liquid Rocket x6 | NovaLiquidRocketx6 | Project_ImprovedInterplanetaryRockets | Chemical | 6 | 90 | 47100000 | 5.6 | 0 | 1 | 131.880 | 0.000 | ReactionProducts |
| Super Kronos Liquid Rocket x1 | SuperKronosLiquidRocketx1 | Project_AdvancedInterplanetaryRockets | Chemical | 1 | 10 | 2500000 | 21.6 | 0 | 1 | 27.000 | 0.000 | ReactionProducts |
| Super Kronos Liquid Rocket x2 | SuperKronosLiquidRocketx2 | Project_AdvancedInterplanetaryRockets | Chemical | 2 | 20 | 5000000 | 21.6 | 0 | 1 | 54.000 | 0.000 | ReactionProducts |
| Super Kronos Liquid Rocket x3 | SuperKronosLiquidRocketx3 | Project_AdvancedInterplanetaryRockets | Chemical | 3 | 30 | 7500000 | 21.6 | 0 | 1 | 81.000 | 0.000 | ReactionProducts |
| Super Kronos Liquid Rocket x4 | SuperKronosLiquidRocketx4 | Project_AdvancedInterplanetaryRockets | Chemical | 4 | 40 | 10000000 | 21.6 | 0 | 1 | 108.000 | 0.000 | ReactionProducts |
| Super Kronos Liquid Rocket x5 | SuperKronosLiquidRocketx5 | Project_AdvancedInterplanetaryRockets | Chemical | 5 | 50 | 12500000 | 21.6 | 0 | 1 | 135.000 | 0.000 | ReactionProducts |
| Super Kronos Liquid Rocket x6 | SuperKronosLiquidRocketx6 | Project_AdvancedInterplanetaryRockets | Chemical | 6 | 60 | 15000000 | 21.6 | 0 | 1 | 162.000 | 0.000 | ReactionProducts |
| Tungsten Resistojet x1 | TungstenResistojetx1 | Project_TungstenResistojet | Electrothermal | 1 | 0 | 9900 | 9.8 | 0 | 0.81 | 0.049 | 0.060 | Hydrogen |
| Tungsten Resistojet x2 | TungstenResistojetx2 | Project_TungstenResistojet | Electrothermal | 2 | 0 | 19800 | 9.8 | 0 | 0.81 | 0.097 | 0.120 | Hydrogen |
| Tungsten Resistojet x3 | TungstenResistojetx3 | Project_TungstenResistojet | Electrothermal | 3 | 0 | 29700 | 9.8 | 0 | 0.81 | 0.146 | 0.180 | Hydrogen |
| Tungsten Resistojet x4 | TungstenResistojetx4 | Project_TungstenResistojet | Electrothermal | 4 | 0 | 39600 | 9.8 | 0 | 0.81 | 0.194 | 0.240 | Hydrogen |
| Tungsten Resistojet x5 | TungstenResistojetx5 | Project_TungstenResistojet | Electrothermal | 5 | 0 | 49500 | 9.8 | 0 | 0.81 | 0.243 | 0.299 | Hydrogen |
| Tungsten Resistojet x6 | TungstenResistojetx6 | Project_TungstenResistojet | Electrothermal | 6 | 0 | 59400 | 9.8 | 0 | 0.81 | 0.291 | 0.359 | Hydrogen |
| E-Beam Drive x1 | E-BeamDrivex1 | Project_E-BeamDrive | Electrothermal | 1 | 0 | 4600 | 19.62 | 0 | 0.76 | 0.045 | 0.059 | Anything |
| E-Beam Drive x2 | E-BeamDrivex2 | Project_E-BeamDrive | Electrothermal | 2 | 0 | 9200 | 19.62 | 0 | 0.76 | 0.090 | 0.119 | Anything |
| E-Beam Drive x3 | E-BeamDrivex3 | Project_E-BeamDrive | Electrothermal | 3 | 0 | 13800 | 19.62 | 0 | 0.76 | 0.135 | 0.178 | Anything |
| E-Beam Drive x4 | E-BeamDrivex4 | Project_E-BeamDrive | Electrothermal | 4 | 0 | 18400 | 19.62 | 0 | 0.76 | 0.181 | 0.238 | Anything |
| E-Beam Drive x5 | E-BeamDrivex5 | Project_E-BeamDrive | Electrothermal | 5 | 0 | 23000 | 19.62 | 0 | 0.76 | 0.226 | 0.297 | Anything |
| E-Beam Drive x6 | E-BeamDrivex6 | Project_E-BeamDrive | Electrothermal | 6 | 0 | 27600 | 19.62 | 0 | 0.76 | 0.271 | 0.356 | Anything |
| Amplitron Drive x1 | AmplitronDrivex1 | Project_AmplitronDrive | Electrothermal | 1 | 0 | 12000 | 9.81 | 0 | 0.81 | 0.059 | 0.073 | Water |
| Amplitron Drive x2 | AmplitronDrivex2 | Project_AmplitronDrive | Electrothermal | 2 | 0 | 24000 | 9.81 | 0 | 0.81 | 0.118 | 0.145 | Water |
| Amplitron Drive x3 | AmplitronDrivex3 | Project_AmplitronDrive | Electrothermal | 3 | 0 | 36000 | 9.81 | 0 | 0.81 | 0.177 | 0.218 | Water |
| Amplitron Drive x4 | AmplitronDrivex4 | Project_AmplitronDrive | Electrothermal | 4 | 0 | 48000 | 9.81 | 0 | 0.81 | 0.235 | 0.291 | Water |
| Amplitron Drive x5 | AmplitronDrivex5 | Project_AmplitronDrive | Electrothermal | 5 | 0 | 60000 | 9.81 | 0 | 0.81 | 0.294 | 0.363 | Water |
| Amplitron Drive x6 | AmplitronDrivex6 | Project_AmplitronDrive | Electrothermal | 6 | 0 | 72000 | 9.81 | 0 | 0.81 | 0.353 | 0.436 | Water |
| Ion Drive x1 | IonDrivex1 | Project_IonDrive | Electrostatic | 1 | 0 | 3300 | 78.4 | 0 | 0.95 | 0.129 | 0.136 | NobleGases |
| Ion Drive x2 | IonDrivex2 | Project_IonDrive | Electrostatic | 2 | 0 | 6600 | 78.4 | 0 | 0.95 | 0.259 | 0.272 | NobleGases |
| Ion Drive x3 | IonDrivex3 | Project_IonDrive | Electrostatic | 3 | 0 | 9900 | 78.4 | 0 | 0.95 | 0.388 | 0.409 | NobleGases |
| Ion Drive x4 | IonDrivex4 | Project_IonDrive | Electrostatic | 4 | 0 | 13200 | 78.4 | 0 | 0.95 | 0.517 | 0.545 | NobleGases |
| Ion Drive x5 | IonDrivex5 | Project_IonDrive | Electrostatic | 5 | 0 | 16500 | 78.4 | 0 | 0.95 | 0.647 | 0.681 | NobleGases |
| Ion Drive x6 | IonDrivex6 | Project_IonDrive | Electrostatic | 6 | 0 | 19800 | 78.4 | 0 | 0.95 | 0.776 | 0.817 | NobleGases |
| Colloid Drive x1 | ColloidDrivex1 | Project_ColloidDrive | Electrostatic | 1 | 0 | 8000 | 43 | 0 | 0.85 | 0.172 | 0.202 | Volatiles |
| Colloid Drive x2 | ColloidDrivex2 | Project_ColloidDrive | Electrostatic | 2 | 0 | 16000 | 43 | 0 | 0.85 | 0.344 | 0.405 | Volatiles |
| Colloid Drive x3 | ColloidDrivex3 | Project_ColloidDrive | Electrostatic | 3 | 0 | 24000 | 43 | 0 | 0.85 | 0.516 | 0.607 | Volatiles |
| Colloid Drive x4 | ColloidDrivex4 | Project_ColloidDrive | Electrostatic | 4 | 0 | 32000 | 43 | 0 | 0.85 | 0.688 | 0.809 | Volatiles |
| Colloid Drive x5 | ColloidDrivex5 | Project_ColloidDrive | Electrostatic | 5 | 0 | 40000 | 43 | 0 | 0.85 | 0.860 | 1.012 | Volatiles |
| Colloid Drive x6 | ColloidDrivex6 | Project_ColloidDrive | Electrostatic | 6 | 0 | 48000 | 43 | 0 | 0.85 | 1.032 | 1.214 | Volatiles |
| Grid Drive x1 | GridDrivex1 | Project_GridDrive | Electrostatic | 1 | 0 | 10000 | 210 | 0 | 0.95 | 1.050 | 1.105 | NobleGases |
| Grid Drive x2 | GridDrivex2 | Project_GridDrive | Electrostatic | 2 | 0 | 20000 | 210 | 0 | 0.95 | 2.100 | 2.211 | NobleGases |
| Grid Drive x3 | GridDrivex3 | Project_GridDrive | Electrostatic | 3 | 0 | 30000 | 210 | 0 | 0.95 | 3.150 | 3.316 | NobleGases |
| Grid Drive x4 | GridDrivex4 | Project_GridDrive | Electrostatic | 4 | 0 | 40000 | 210 | 0 | 0.95 | 4.200 | 4.421 | NobleGases |
| Grid Drive x5 | GridDrivex5 | Project_GridDrive | Electrostatic | 5 | 0 | 50000 | 210 | 0 | 0.95 | 5.250 | 5.526 | NobleGases |
| Grid Drive x6 | GridDrivex6 | Project_GridDrive | Electrostatic | 6 | 0 | 60000 | 210 | 0 | 0.95 | 6.300 | 6.632 | NobleGases |
| VASIMR x1 | VASIMRx1 | Project_VASIMR | Electromagnetic | 1 | 0 | 1000 | 147 | 0 | 0.6 | 0.074 | 0.123 | Hydrogen |
| VASIMR x2 | VASIMRx2 | Project_VASIMR | Electromagnetic | 2 | 0 | 2000 | 147 | 0 | 0.6 | 0.147 | 0.245 | Hydrogen |
| VASIMR x3 | VASIMRx3 | Project_VASIMR | Electromagnetic | 3 | 0 | 3000 | 147 | 0 | 0.6 | 0.221 | 0.368 | Hydrogen |
| VASIMR x4 | VASIMRx4 | Project_VASIMR | Electromagnetic | 4 | 0 | 4000 | 147 | 0 | 0.6 | 0.294 | 0.490 | Hydrogen |
| VASIMR x5 | VASIMRx5 | Project_VASIMR | Electromagnetic | 5 | 0 | 5000 | 147 | 0 | 0.6 | 0.368 | 0.613 | Hydrogen |
| VASIMR x6 | VASIMRx6 | Project_VASIMR | Electromagnetic | 6 | 0 | 6000 | 147 | 0 | 0.6 | 0.441 | 0.735 | Hydrogen |
| Ponderomotive VASIMR x1 | PonderomotiveVASIMRx1 | Project_PonderomotiveVASIMR | Electromagnetic | 1 | 0 | 2250 | 147 | 0 | 0.72 | 0.165 | 0.230 | Hydrogen |
| Ponderomotive VASIMR x2 | PonderomotiveVASIMRx2 | Project_PonderomotiveVASIMR | Electromagnetic | 2 | 0 | 4500 | 147 | 0 | 0.72 | 0.331 | 0.459 | Hydrogen |
| Ponderomotive VASIMR x3 | PonderomotiveVASIMRx3 | Project_PonderomotiveVASIMR | Electromagnetic | 3 | 0 | 6750 | 147 | 0 | 0.72 | 0.496 | 0.689 | Hydrogen |
| Ponderomotive VASIMR x4 | PonderomotiveVASIMRx4 | Project_PonderomotiveVASIMR | Electromagnetic | 4 | 0 | 9000 | 147 | 0 | 0.72 | 0.662 | 0.919 | Hydrogen |
| Ponderomotive VASIMR x5 | PonderomotiveVASIMRx5 | Project_PonderomotiveVASIMR | Electromagnetic | 5 | 0 | 11250 | 147 | 0 | 0.72 | 0.827 | 1.148 | Hydrogen |
| Ponderomotive VASIMR x6 | PonderomotiveVASIMRx6 | Project_PonderomotiveVASIMR | Electromagnetic | 6 | 0 | 13500 | 147 | 0 | 0.72 | 0.992 | 1.378 | Hydrogen |
| Pulsed Plasmoid Drive x1 | PulsedPlasmoidDrivex1 | Project_PulsedPlasmoidDrive | Electromagnetic | 1 | 0 | 2200 | 425 | 0 | 0.72 | 0.468 | 0.649 | Anything |
| Pulsed Plasmoid Drive x2 | PulsedPlasmoidDrivex2 | Project_PulsedPlasmoidDrive | Electromagnetic | 2 | 0 | 4400 | 425 | 0 | 0.72 | 0.935 | 1.299 | Anything |
| Pulsed Plasmoid Drive x3 | PulsedPlasmoidDrivex3 | Project_PulsedPlasmoidDrive | Electromagnetic | 3 | 0 | 6600 | 425 | 0 | 0.72 | 1.403 | 1.948 | Anything |
| Pulsed Plasmoid Drive x4 | PulsedPlasmoidDrivex4 | Project_PulsedPlasmoidDrive | Electromagnetic | 4 | 0 | 8800 | 425 | 0 | 0.72 | 1.870 | 2.597 | Anything |
| Pulsed Plasmoid Drive x5 | PulsedPlasmoidDrivex5 | Project_PulsedPlasmoidDrive | Electromagnetic | 5 | 0 | 11000 | 425 | 0 | 0.72 | 2.338 | 3.247 | Anything |
| Pulsed Plasmoid Drive x6 | PulsedPlasmoidDrivex6 | Project_PulsedPlasmoidDrive | Electromagnetic | 6 | 0 | 13200 | 425 | 0 | 0.72 | 2.805 | 3.896 | Anything |
| Plasma Wave Drive x1 | PlasmaWaveDrivex1 | Project_PlasmaWaveDrive | Electromagnetic | 1 | 0 | 1200 | 78.4 | 0 | 0.81 | 0.047 | 0.058 | Anything |
| Plasma Wave Drive x2 | PlasmaWaveDrivex2 | Project_PlasmaWaveDrive | Electromagnetic | 2 | 0 | 2400 | 78.4 | 0 | 0.81 | 0.094 | 0.116 | Anything |
| Plasma Wave Drive x3 | PlasmaWaveDrivex3 | Project_PlasmaWaveDrive | Electromagnetic | 3 | 0 | 3600 | 78.4 | 0 | 0.81 | 0.141 | 0.174 | Anything |
| Plasma Wave Drive x4 | PlasmaWaveDrivex4 | Project_PlasmaWaveDrive | Electromagnetic | 4 | 0 | 4800 | 78.4 | 0 | 0.81 | 0.188 | 0.232 | Anything |
| Plasma Wave Drive x5 | PlasmaWaveDrivex5 | Project_PlasmaWaveDrive | Electromagnetic | 5 | 0 | 6000 | 78.4 | 0 | 0.81 | 0.235 | 0.290 | Anything |
| Plasma Wave Drive x6 | PlasmaWaveDrivex6 | Project_PlasmaWaveDrive | Electromagnetic | 6 | 0 | 7200 | 78.4 | 0 | 0.81 | 0.282 | 0.348 | Anything |
| Lorentz Drive x1 | LorentzDrivex1 | Project_LorentzDrive | Electromagnetic | 1 | 0 | 20000 | 110 | 0 | 0.79 | 1.100 | 1.392 | NobleGases |
| Lorentz Drive x2 | LorentzDrivex2 | Project_LorentzDrive | Electromagnetic | 2 | 0 | 40000 | 110 | 0 | 0.79 | 2.200 | 2.785 | NobleGases |
| Lorentz Drive x3 | LorentzDrivex3 | Project_LorentzDrive | Electromagnetic | 3 | 0 | 60000 | 110 | 0 | 0.79 | 3.300 | 4.177 | NobleGases |
| Lorentz Drive x4 | LorentzDrivex4 | Project_LorentzDrive | Electromagnetic | 4 | 0 | 80000 | 110 | 0 | 0.79 | 4.400 | 5.570 | NobleGases |
| Lorentz Drive x5 | LorentzDrivex5 | Project_LorentzDrive | Electromagnetic | 5 | 0 | 100000 | 110 | 0 | 0.79 | 5.500 | 6.962 | NobleGases |
| Lorentz Drive x6 | LorentzDrivex6 | Project_LorentzDrive | Electromagnetic | 6 | 0 | 120000 | 110 | 0 | 0.79 | 6.600 | 8.354 | NobleGases |
| Helicon Drive x1 | HeliconDrivex1 | Project_HeliconDrive | Electromagnetic | 1 | 0 | 20000 | 314 | 0 | 0.79 | 3.140 | 3.975 | NobleGases |
| Helicon Drive x2 | HeliconDrivex2 | Project_HeliconDrive | Electromagnetic | 2 | 0 | 40000 | 314 | 0 | 0.79 | 6.280 | 7.949 | NobleGases |
| Helicon Drive x3 | HeliconDrivex3 | Project_HeliconDrive | Electromagnetic | 3 | 0 | 60000 | 314 | 0 | 0.79 | 9.420 | 11.924 | NobleGases |
| Helicon Drive x4 | HeliconDrivex4 | Project_HeliconDrive | Electromagnetic | 4 | 0 | 80000 | 314 | 0 | 0.79 | 12.560 | 15.899 | NobleGases |
| Helicon Drive x5 | HeliconDrivex5 | Project_HeliconDrive | Electromagnetic | 5 | 0 | 100000 | 314 | 0 | 0.79 | 15.700 | 19.873 | NobleGases |
| Helicon Drive x6 | HeliconDrivex6 | Project_HeliconDrive | Electromagnetic | 6 | 0 | 120000 | 314 | 0 | 0.79 | 18.840 | 23.848 | NobleGases |
| Mass Driver x1 | MassDriverx1 | Project_MassDriver | Electromagnetic | 1 | 0 | 10400 | 9.81 | 50 | 0.65 | 0.051 | 0.078 | Anything |
| Mass Driver x2 | MassDriverx2 | Project_MassDriver | Electromagnetic | 2 | 0 | 20800 | 9.81 | 50 | 0.65 | 0.102 | 0.157 | Anything |
| Mass Driver x3 | MassDriverx3 | Project_MassDriver | Electromagnetic | 3 | 0 | 31200 | 9.81 | 50 | 0.65 | 0.153 | 0.235 | Anything |
| Mass Driver x4 | MassDriverx4 | Project_MassDriver | Electromagnetic | 4 | 0 | 41600 | 9.81 | 50 | 0.65 | 0.204 | 0.314 | Anything |
| Mass Driver x5 | MassDriverx5 | Project_MassDriver | Electromagnetic | 5 | 0 | 52000 | 9.81 | 50 | 0.65 | 0.255 | 0.392 | Anything |
| Mass Driver x6 | MassDriverx6 | Project_MassDriver | Electromagnetic | 6 | 0 | 62400 | 9.81 | 50 | 0.65 | 0.306 | 0.471 | Anything |
| Superconducting Mass Driver x1 | SuperconductingMassDriverx1 | Project_SuperconductingMassDriver | Electromagnetic | 1 | 0 | 20000 | 30 | 10 | 0.85 | 0.300 | 0.353 | Anything |
| Superconducting Mass Driver x2 | SuperconductingMassDriverx2 | Project_SuperconductingMassDriver | Electromagnetic | 2 | 0 | 40000 | 30 | 10 | 0.85 | 0.600 | 0.706 | Anything |
| Superconducting Mass Driver x3 | SuperconductingMassDriverx3 | Project_SuperconductingMassDriver | Electromagnetic | 3 | 0 | 60000 | 30 | 10 | 0.85 | 0.900 | 1.059 | Anything |
| Superconducting Mass Driver x4 | SuperconductingMassDriverx4 | Project_SuperconductingMassDriver | Electromagnetic | 4 | 0 | 80000 | 30 | 10 | 0.85 | 1.200 | 1.412 | Anything |
| Superconducting Mass Driver x5 | SuperconductingMassDriverx5 | Project_SuperconductingMassDriver | Electromagnetic | 5 | 0 | 100000 | 30 | 10 | 0.85 | 1.500 | 1.765 | Anything |
| Superconducting Mass Driver x6 | SuperconductingMassDriverx6 | Project_SuperconductingMassDriver | Electromagnetic | 6 | 0 | 120000 | 30 | 10 | 0.85 | 1.800 | 2.118 | Anything |
| Kiwi Drive x1 | KiwiDrivex1 | Project_KiwiDrive | Fission_Thermal | 1 | 0 | 33000 | 8.77 | 0 | 0.7 | 0.145 | 0.207 | Hydrogen |
| Kiwi Drive x2 | KiwiDrivex2 | Project_KiwiDrive | Fission_Thermal | 2 | 0 | 66000 | 8.77 | 0 | 0.7 | 0.289 | 0.413 | Hydrogen |
| Kiwi Drive x3 | KiwiDrivex3 | Project_KiwiDrive | Fission_Thermal | 3 | 0 | 99000 | 8.77 | 0 | 0.7 | 0.434 | 0.620 | Hydrogen |
| Kiwi Drive x4 | KiwiDrivex4 | Project_KiwiDrive | Fission_Thermal | 4 | 0 | 132000 | 8.77 | 0 | 0.7 | 0.579 | 0.827 | Hydrogen |
| Kiwi Drive x5 | KiwiDrivex5 | Project_KiwiDrive | Fission_Thermal | 5 | 0 | 165000 | 8.77 | 0 | 0.7 | 0.724 | 1.034 | Hydrogen |
| Kiwi Drive x6 | KiwiDrivex6 | Project_KiwiDrive | Fission_Thermal | 6 | 0 | 198000 | 8.77 | 0 | 0.7 | 0.868 | 1.240 | Hydrogen |
| Nerva Drive x1 | NervaDrivex1 | Project_NervaDrive | Fission_Thermal | 1 | 0 | 49000 | 8.09 | 0 | 0.7 | 0.198 | 0.283 | Hydrogen |
| Nerva Drive x2 | NervaDrivex2 | Project_NervaDrive | Fission_Thermal | 2 | 0 | 98000 | 8.09 | 0 | 0.7 | 0.397 | 0.567 | Hydrogen |
| Nerva Drive x3 | NervaDrivex3 | Project_NervaDrive | Fission_Thermal | 3 | 0 | 147000 | 8.09 | 0 | 0.7 | 0.595 | 0.850 | Hydrogen |
| Nerva Drive x4 | NervaDrivex4 | Project_NervaDrive | Fission_Thermal | 4 | 0 | 196000 | 8.09 | 0 | 0.7 | 0.793 | 1.133 | Hydrogen |
| Nerva Drive x5 | NervaDrivex5 | Project_NervaDrive | Fission_Thermal | 5 | 0 | 245000 | 8.09 | 0 | 0.7 | 0.991 | 1.416 | Hydrogen |
| Nerva Drive x6 | NervaDrivex6 | Project_NervaDrive | Fission_Thermal | 6 | 0 | 294000 | 8.09 | 0 | 0.7 | 1.190 | 1.700 | Hydrogen |
| Snare Drive x1 | SnareDrivex1 | Project_SnareDrive | Fission_Thermal | 1 | 0 | 73000 | 8.83 | 0 | 0.7 | 0.322 | 0.460 | Hydrogen |
| Snare Drive x2 | SnareDrivex2 | Project_SnareDrive | Fission_Thermal | 2 | 0 | 146000 | 8.83 | 0 | 0.7 | 0.645 | 0.921 | Hydrogen |
| Snare Drive x3 | SnareDrivex3 | Project_SnareDrive | Fission_Thermal | 3 | 0 | 219000 | 8.83 | 0 | 0.7 | 0.967 | 1.381 | Hydrogen |
| Snare Drive x4 | SnareDrivex4 | Project_SnareDrive | Fission_Thermal | 4 | 0 | 292000 | 8.83 | 0 | 0.7 | 1.289 | 1.841 | Hydrogen |
| Snare Drive x5 | SnareDrivex5 | Project_SnareDrive | Fission_Thermal | 5 | 0 | 365000 | 8.83 | 0 | 0.7 | 1.611 | 2.302 | Hydrogen |
| Snare Drive x6 | SnareDrivex6 | Project_SnareDrive | Fission_Thermal | 6 | 0 | 438000 | 8.83 | 0 | 0.7 | 1.934 | 2.762 | Hydrogen |
| Rover Drive x1 | RoverDrivex1 | Project_RoverDrive | Fission_Thermal | 1 | 0 | 245000 | 8.18 | 0 | 0.7 | 1.002 | 1.432 | Hydrogen |
| Rover Drive x2 | RoverDrivex2 | Project_RoverDrive | Fission_Thermal | 2 | 0 | 490000 | 8.18 | 0 | 0.7 | 2.004 | 2.863 | Hydrogen |
| Rover Drive x3 | RoverDrivex3 | Project_RoverDrive | Fission_Thermal | 3 | 0 | 735000 | 8.18 | 0 | 0.7 | 3.006 | 4.295 | Hydrogen |
| Rover Drive x4 | RoverDrivex4 | Project_RoverDrive | Fission_Thermal | 4 | 0 | 980000 | 8.18 | 0 | 0.7 | 4.008 | 5.726 | Hydrogen |
| Rover Drive x5 | RoverDrivex5 | Project_RoverDrive | Fission_Thermal | 5 | 0 | 1225000 | 8.18 | 0 | 0.7 | 5.010 | 7.158 | Hydrogen |
| Rover Drive x6 | RoverDrivex6 | Project_RoverDrive | Fission_Thermal | 6 | 0 | 1470000 | 8.18 | 0 | 0.7 | 6.012 | 8.589 | Hydrogen |
| Cermet Nerva x1 | CermetNervax1 | Project_CermetNerva | Fission_Thermal | 1 | 0 | 134400 | 9.81 | 0 | 0.7 | 0.659 | 0.942 | Hydrogen |
| Cermet Nerva x2 | CermetNervax2 | Project_CermetNerva | Fission_Thermal | 2 | 0 | 268800 | 9.81 | 0 | 0.7 | 1.318 | 1.884 | Hydrogen |
| Cermet Nerva x3 | CermetNervax3 | Project_CermetNerva | Fission_Thermal | 3 | 0 | 403200 | 9.81 | 0 | 0.7 | 1.978 | 2.825 | Hydrogen |
| Cermet Nerva x4 | CermetNervax4 | Project_CermetNerva | Fission_Thermal | 4 | 0 | 537600 | 9.81 | 0 | 0.7 | 2.637 | 3.767 | Hydrogen |
| Cermet Nerva x5 | CermetNervax5 | Project_CermetNerva | Fission_Thermal | 5 | 0 | 672000 | 9.81 | 0 | 0.7 | 3.296 | 4.709 | Hydrogen |
| Cermet Nerva x6 | CermetNervax6 | Project_CermetNerva | Fission_Thermal | 6 | 0 | 806400 | 9.81 | 0 | 0.7 | 3.955 | 5.651 | Hydrogen |
| Advanced Nerva Drive x1 | AdvancedNervaDrivex1 | Project_AdvancedNervaDrive | Fission_Thermal | 1 | 0 | 334061 | 8.09 | 0 | 0.7 | 1.350 | 1.929 | Hydrogen |
| Advanced Nerva Drive x2 | AdvancedNervaDrivex2 | Project_AdvancedNervaDrive | Fission_Thermal | 2 | 0 | 668122 | 8.09 | 0 | 0.7 | 2.701 | 3.858 | Hydrogen |
| Advanced Nerva Drive x3 | AdvancedNervaDrivex3 | Project_AdvancedNervaDrive | Fission_Thermal | 3 | 0 | 1002183 | 8.09 | 0 | 0.7 | 4.051 | 5.788 | Hydrogen |
| Advanced Nerva Drive x4 | AdvancedNervaDrivex4 | Project_AdvancedNervaDrive | Fission_Thermal | 4 | 0 | 1336244 | 8.09 | 0 | 0.7 | 5.402 | 7.717 | Hydrogen |
| Advanced Nerva Drive x5 | AdvancedNervaDrivex5 | Project_AdvancedNervaDrive | Fission_Thermal | 5 | 0 | 1670305 | 8.09 | 0 | 0.7 | 6.752 | 9.646 | Hydrogen |
| Advanced Nerva Drive x6 | AdvancedNervaDrivex6 | Project_AdvancedNervaDrive | Fission_Thermal | 6 | 0 | 2004366 | 8.09 | 0 | 0.7 | 8.103 | 11.575 | Hydrogen |
| Dumbo x1 | Dumbox1 | Project_Dumbo | Fission_Thermal | 1 | 0 | 400000 | 8.3 | 0 | 0.725 | 1.660 | 2.290 | Hydrogen |
| Dumbo x2 | Dumbox2 | Project_Dumbo | Fission_Thermal | 2 | 0 | 800000 | 8.3 | 0 | 0.725 | 3.320 | 4.579 | Hydrogen |
| Dumbo x3 | Dumbox3 | Project_Dumbo | Fission_Thermal | 3 | 0 | 1200000 | 8.3 | 0 | 0.725 | 4.980 | 6.869 | Hydrogen |
| Dumbo x4 | Dumbox4 | Project_Dumbo | Fission_Thermal | 4 | 0 | 1600000 | 8.3 | 0 | 0.725 | 6.640 | 9.159 | Hydrogen |
| Dumbo x5 | Dumbox5 | Project_Dumbo | Fission_Thermal | 5 | 0 | 2000000 | 8.3 | 0 | 0.725 | 8.300 | 11.448 | Hydrogen |
| Dumbo x6 | Dumbox6 | Project_Dumbo | Fission_Thermal | 6 | 0 | 2400000 | 8.3 | 0 | 0.725 | 9.960 | 13.738 | Hydrogen |
| Advanced Cermet Nerva x1 | AdvancedCermetNervax1 | Project_AdvancedCermetNerva | Fission_Thermal | 1 | 0 | 445267 | 9.12 | 0 | 0.75 | 2.030 | 2.707 | Hydrogen |
| Advanced Cermet Nerva x2 | AdvancedCermetNervax2 | Project_AdvancedCermetNerva | Fission_Thermal | 2 | 0 | 890534 | 9.12 | 0 | 0.75 | 4.061 | 5.414 | Hydrogen |
| Advanced Cermet Nerva x3 | AdvancedCermetNervax3 | Project_AdvancedCermetNerva | Fission_Thermal | 3 | 0 | 1335801 | 9.12 | 0 | 0.75 | 6.091 | 8.122 | Hydrogen |
| Advanced Cermet Nerva x4 | AdvancedCermetNervax4 | Project_AdvancedCermetNerva | Fission_Thermal | 4 | 0 | 1781068 | 9.12 | 0 | 0.75 | 8.122 | 10.829 | Hydrogen |
| Advanced Cermet Nerva x5 | AdvancedCermetNervax5 | Project_AdvancedCermetNerva | Fission_Thermal | 5 | 0 | 2226335 | 9.12 | 0 | 0.75 | 10.152 | 13.536 | Hydrogen |
| Advanced Cermet Nerva x6 | AdvancedCermetNervax6 | Project_AdvancedCermetNerva | Fission_Thermal | 6 | 0 | 2671602 | 9.12 | 0 | 0.75 | 12.183 | 16.243 | Hydrogen |
| Heavy Dumbo x1 | HeavyDumbox1 | Project_HeavyDumbo | Fission_Thermal | 1 | 0 | 3500000 | 8.09 | 0 | 0.725 | 14.163 | 19.535 | Hydrogen |
| Heavy Dumbo x2 | HeavyDumbox2 | Project_HeavyDumbo | Fission_Thermal | 2 | 0 | 7000000 | 8.09 | 0 | 0.725 | 28.326 | 39.070 | Hydrogen |
| Heavy Dumbo x3 | HeavyDumbox3 | Project_HeavyDumbo | Fission_Thermal | 3 | 0 | 10500000 | 8.09 | 0 | 0.725 | 42.488 | 58.604 | Hydrogen |
| Heavy Dumbo x4 | HeavyDumbox4 | Project_HeavyDumbo | Fission_Thermal | 4 | 0 | 14000000 | 8.09 | 0 | 0.725 | 56.651 | 78.139 | Hydrogen |
| Heavy Dumbo x5 | HeavyDumbox5 | Project_HeavyDumbo | Fission_Thermal | 5 | 0 | 17500000 | 8.09 | 0 | 0.725 | 70.814 | 97.674 | Hydrogen |
| Heavy Dumbo x6 | HeavyDumbox6 | Project_HeavyDumbo | Fission_Thermal | 6 | 0 | 21000000 | 8.09 | 0 | 0.725 | 84.977 | 117.209 | Hydrogen |
| Pulsar Drive x1 | PulsarDrivex1 | Project_PulsarDrive | Fission_Thermal | 1 | 0 | 100000 | 16 | 0 | 0.85 | 0.800 | 0.941 | Hydrogen |
| Pulsar Drive x2 | PulsarDrivex2 | Project_PulsarDrive | Fission_Thermal | 2 | 0 | 200000 | 16 | 0 | 0.85 | 1.600 | 1.882 | Hydrogen |
| Pulsar Drive x3 | PulsarDrivex3 | Project_PulsarDrive | Fission_Thermal | 3 | 0 | 300000 | 16 | 0 | 0.85 | 2.400 | 2.824 | Hydrogen |
| Pulsar Drive x4 | PulsarDrivex4 | Project_PulsarDrive | Fission_Thermal | 4 | 0 | 400000 | 16 | 0 | 0.85 | 3.200 | 3.765 | Hydrogen |
| Pulsar Drive x5 | PulsarDrivex5 | Project_PulsarDrive | Fission_Thermal | 5 | 0 | 500000 | 16 | 0 | 0.85 | 4.000 | 4.706 | Hydrogen |
| Pulsar Drive x6 | PulsarDrivex6 | Project_PulsarDrive | Fission_Thermal | 6 | 0 | 600000 | 16 | 0 | 0.85 | 4.800 | 5.647 | Hydrogen |
| Advanced Pulsar Drive x1 | AdvancedPulsarDrivex1 | Project_AdvancedPulsarDrive | Fission_Thermal | 1 | 0 | 180000 | 32 | 0 | 0.9 | 2.880 | 3.200 | Hydrogen |
| Advanced Pulsar Drive x2 | AdvancedPulsarDrivex2 | Project_AdvancedPulsarDrive | Fission_Thermal | 2 | 0 | 360000 | 32 | 0 | 0.9 | 5.760 | 6.400 | Hydrogen |
| Advanced Pulsar Drive x3 | AdvancedPulsarDrivex3 | Project_AdvancedPulsarDrive | Fission_Thermal | 3 | 0 | 540000 | 32 | 0 | 0.9 | 8.640 | 9.600 | Hydrogen |
| Advanced Pulsar Drive x4 | AdvancedPulsarDrivex4 | Project_AdvancedPulsarDrive | Fission_Thermal | 4 | 0 | 720000 | 32 | 0 | 0.9 | 11.520 | 12.800 | Hydrogen |
| Advanced Pulsar Drive x5 | AdvancedPulsarDrivex5 | Project_AdvancedPulsarDrive | Fission_Thermal | 5 | 0 | 900000 | 32 | 0 | 0.9 | 14.400 | 16.000 | Hydrogen |
| Advanced Pulsar Drive x6 | AdvancedPulsarDrivex6 | Project_AdvancedPulsarDrive | Fission_Thermal | 6 | 0 | 1080000 | 32 | 0 | 0.9 | 17.280 | 19.200 | Hydrogen |
| Pebble Drive x1 | PebbleDrivex1 | Project_PebbleDrive | Fission_Thermal | 1 | 0 | 172700 | 9.81 | 0 | 0.94 | 0.847 | 0.901 | Hydrogen |
| Pebble Drive x2 | PebbleDrivex2 | Project_PebbleDrive | Fission_Thermal | 2 | 0 | 345400 | 9.81 | 0 | 0.94 | 1.694 | 1.802 | Hydrogen |
| Pebble Drive x3 | PebbleDrivex3 | Project_PebbleDrive | Fission_Thermal | 3 | 0 | 518100 | 9.81 | 0 | 0.94 | 2.541 | 2.703 | Hydrogen |
| Pebble Drive x4 | PebbleDrivex4 | Project_PebbleDrive | Fission_Thermal | 4 | 0 | 690800 | 9.81 | 0 | 0.94 | 3.388 | 3.605 | Hydrogen |
| Pebble Drive x5 | PebbleDrivex5 | Project_PebbleDrive | Fission_Thermal | 5 | 0 | 863500 | 9.81 | 0 | 0.94 | 4.235 | 4.506 | Hydrogen |
| Pebble Drive x6 | PebbleDrivex6 | Project_PebbleDrive | Fission_Thermal | 6 | 0 | 1036200 | 9.81 | 0 | 0.94 | 5.083 | 5.407 | Hydrogen |
| Advanced Pebble Drive x1 | AdvancedPebbleDrivex1 | Project_AdvancedPebbleDrive | Fission_Thermal | 1 | 0 | 333617 | 9.53 | 0 | 0.85 | 1.590 | 1.870 | Hydrogen |
| Advanced Pebble Drive x2 | AdvancedPebbleDrivex2 | Project_AdvancedPebbleDrive | Fission_Thermal | 2 | 0 | 667234 | 9.53 | 0 | 0.85 | 3.179 | 3.740 | Hydrogen |
| Advanced Pebble Drive x3 | AdvancedPebbleDrivex3 | Project_AdvancedPebbleDrive | Fission_Thermal | 3 | 0 | 1000851 | 9.53 | 0 | 0.85 | 4.769 | 5.611 | Hydrogen |
| Advanced Pebble Drive x4 | AdvancedPebbleDrivex4 | Project_AdvancedPebbleDrive | Fission_Thermal | 4 | 0 | 1334468 | 9.53 | 0 | 0.85 | 6.359 | 7.481 | Hydrogen |
| Advanced Pebble Drive x5 | AdvancedPebbleDrivex5 | Project_AdvancedPebbleDrive | Fission_Thermal | 5 | 0 | 1668085 | 9.53 | 0 | 0.85 | 7.948 | 9.351 | Hydrogen |
| Advanced Pebble Drive x6 | AdvancedPebbleDrivex6 | Project_AdvancedPebbleDrive | Fission_Thermal | 6 | 0 | 2001702 | 9.53 | 0 | 0.85 | 9.538 | 11.221 | Hydrogen |
| Lars Drive x1 | LarsDrivex1 | Project_LarsDrive | Fission_Thermal | 1 | 0 | 98000 | 19.62 | 0 | 0.85 | 0.961 | 1.131 | Hydrogen |
| Lars Drive x2 | LarsDrivex2 | Project_LarsDrive | Fission_Thermal | 2 | 0 | 196000 | 19.62 | 0 | 0.85 | 1.923 | 2.262 | Hydrogen |
| Lars Drive x3 | LarsDrivex3 | Project_LarsDrive | Fission_Thermal | 3 | 0 | 294000 | 19.62 | 0 | 0.85 | 2.884 | 3.393 | Hydrogen |
| Lars Drive x4 | LarsDrivex4 | Project_LarsDrive | Fission_Thermal | 4 | 0 | 392000 | 19.62 | 0 | 0.85 | 3.846 | 4.524 | Hydrogen |
| Lars Drive x5 | LarsDrivex5 | Project_LarsDrive | Fission_Thermal | 5 | 0 | 490000 | 19.62 | 0 | 0.85 | 4.807 | 5.655 | Hydrogen |
| Lars Drive x6 | LarsDrivex6 | Project_LarsDrive | Fission_Thermal | 6 | 0 | 588000 | 19.62 | 0 | 0.85 | 5.768 | 6.786 | Hydrogen |
| Teardrop Drive x1 | TeardropDrivex1 | Project_TeardropDrive | Fission_Thermal | 1 | 0 | 333000 | 19.62 | 0 | 0.75 | 3.267 | 4.356 | Hydrogen |
| Teardrop Drive x2 | TeardropDrivex2 | Project_TeardropDrive | Fission_Thermal | 2 | 0 | 666000 | 19.62 | 0 | 0.75 | 6.533 | 8.711 | Hydrogen |
| Teardrop Drive x3 | TeardropDrivex3 | Project_TeardropDrive | Fission_Thermal | 3 | 0 | 999000 | 19.62 | 0 | 0.75 | 9.800 | 13.067 | Hydrogen |
| Teardrop Drive x4 | TeardropDrivex4 | Project_TeardropDrive | Fission_Thermal | 4 | 0 | 1332000 | 19.62 | 0 | 0.75 | 13.067 | 17.423 | Hydrogen |
| Teardrop Drive x5 | TeardropDrivex5 | Project_TeardropDrive | Fission_Thermal | 5 | 0 | 1665000 | 19.62 | 0 | 0.75 | 16.334 | 21.778 | Hydrogen |
| Teardrop Drive x6 | TeardropDrivex6 | Project_TeardropDrive | Fission_Thermal | 6 | 0 | 1998000 | 19.62 | 0 | 0.75 | 19.600 | 26.134 | Hydrogen |
| Fission Spinner Drive x1 | FissionSpinnerDrivex1 | Project_FissionSpinnerDrive | Fission_Thermal | 1 | 0 | 540000 | 17.7 | 0 | 0.85 | 4.779 | 5.622 | Hydrogen |
| Fission Spinner Drive x2 | FissionSpinnerDrivex2 | Project_FissionSpinnerDrive | Fission_Thermal | 2 | 0 | 1080000 | 17.7 | 0 | 0.85 | 9.558 | 11.245 | Hydrogen |
| Fission Spinner Drive x3 | FissionSpinnerDrivex3 | Project_FissionSpinnerDrive | Fission_Thermal | 3 | 0 | 1620000 | 17.7 | 0 | 0.85 | 14.337 | 16.867 | Hydrogen |
| Fission Spinner Drive x4 | FissionSpinnerDrivex4 | Project_FissionSpinnerDrive | Fission_Thermal | 4 | 0 | 2160000 | 17.7 | 0 | 0.85 | 19.116 | 22.489 | Hydrogen |
| Fission Spinner Drive x5 | FissionSpinnerDrivex5 | Project_FissionSpinnerDrive | Fission_Thermal | 5 | 0 | 2700000 | 17.7 | 0 | 0.85 | 23.895 | 28.112 | Hydrogen |
| Fission Spinner Drive x6 | FissionSpinnerDrivex6 | Project_FissionSpinnerDrive | Fission_Thermal | 6 | 0 | 3240000 | 17.7 | 0 | 0.85 | 28.674 | 33.734 | Hydrogen |
| Pegasus Drive x1 | PegasusDrivex1 | Project_PegasusDrive | Fission_Thermal | 1 | 0 | 7000000 | 16 | 0 | 0.85 | 56.000 | 65.882 | Hydrogen |
| Pegasus Drive x2 | PegasusDrivex2 | Project_PegasusDrive | Fission_Thermal | 2 | 0 | 14000000 | 16 | 0 | 0.85 | 112.000 | 131.765 | Hydrogen |
| Pegasus Drive x3 | PegasusDrivex3 | Project_PegasusDrive | Fission_Thermal | 3 | 0 | 21000000 | 16 | 0 | 0.85 | 168.000 | 197.647 | Hydrogen |
| Pegasus Drive x4 | PegasusDrivex4 | Project_PegasusDrive | Fission_Thermal | 4 | 0 | 28000000 | 16 | 0 | 0.85 | 224.000 | 263.529 | Hydrogen |
| Pegasus Drive x5 | PegasusDrivex5 | Project_PegasusDrive | Fission_Thermal | 5 | 0 | 35000000 | 16 | 0 | 0.85 | 280.000 | 329.412 | Hydrogen |
| Pegasus Drive x6 | PegasusDrivex6 | Project_PegasusDrive | Fission_Thermal | 6 | 0 | 42000000 | 16 | 0 | 0.85 | 336.000 | 395.294 | Hydrogen |
| Vortex Drive x1 | VortexDrivex1 | Project_VortexDrive | Fission_Thermal | 1 | 0 | 330000 | 19.62 | 0 | 0.7 | 3.237 | 4.625 | Hydrogen |
| Vortex Drive x2 | VortexDrivex2 | Project_VortexDrive | Fission_Thermal | 2 | 0 | 660000 | 19.62 | 0 | 0.7 | 6.475 | 9.249 | Hydrogen |
| Vortex Drive x3 | VortexDrivex3 | Project_VortexDrive | Fission_Thermal | 3 | 0 | 990000 | 19.62 | 0 | 0.7 | 9.712 | 13.874 | Hydrogen |
| Vortex Drive x4 | VortexDrivex4 | Project_VortexDrive | Fission_Thermal | 4 | 0 | 1320000 | 19.62 | 0 | 0.7 | 12.949 | 18.499 | Hydrogen |
| Vortex Drive x5 | VortexDrivex5 | Project_VortexDrive | Fission_Thermal | 5 | 0 | 1650000 | 19.62 | 0 | 0.7 | 16.187 | 23.124 | Hydrogen |
| Vortex Drive x6 | VortexDrivex6 | Project_VortexDrive | Fission_Thermal | 6 | 0 | 1980000 | 19.62 | 0 | 0.7 | 19.424 | 27.748 | Hydrogen |
| Advanced Vortex Drive x1 | AdvancedVortexDrivex1 | Project_AdvancedVortexDrive | Fission_Thermal | 1 | 0 | 504000 | 19.62 | 0 | 0.7 | 4.944 | 7.063 | Hydrogen |
| Advanced Vortex Drive x2 | AdvancedVortexDrivex2 | Project_AdvancedVortexDrive | Fission_Thermal | 2 | 0 | 1008000 | 19.62 | 0 | 0.7 | 9.888 | 14.126 | Hydrogen |
| Advanced Vortex Drive x3 | AdvancedVortexDrivex3 | Project_AdvancedVortexDrive | Fission_Thermal | 3 | 0 | 1512000 | 19.62 | 0 | 0.7 | 14.833 | 21.190 | Hydrogen |
| Advanced Vortex Drive x4 | AdvancedVortexDrivex4 | Project_AdvancedVortexDrive | Fission_Thermal | 4 | 0 | 2016000 | 19.62 | 0 | 0.7 | 19.777 | 28.253 | Hydrogen |
| Advanced Vortex Drive x5 | AdvancedVortexDrivex5 | Project_AdvancedVortexDrive | Fission_Thermal | 5 | 0 | 2520000 | 19.62 | 0 | 0.7 | 24.721 | 35.316 | Hydrogen |
| Advanced Vortex Drive x6 | AdvancedVortexDrivex6 | Project_AdvancedVortexDrive | Fission_Thermal | 6 | 0 | 3024000 | 19.62 | 0 | 0.7 | 29.665 | 42.379 | Hydrogen |
| Cavity Drive x1 | CavityDrivex1 | Project_CavityDrive | Fission_Thermal | 1 | 0 | 56400 | 19.62 | 0 | 0.85 | 0.553 | 0.651 | Hydrogen |
| Cavity Drive x2 | CavityDrivex2 | Project_CavityDrive | Fission_Thermal | 2 | 0 | 112800 | 19.62 | 0 | 0.85 | 1.107 | 1.302 | Hydrogen |
| Cavity Drive x3 | CavityDrivex3 | Project_CavityDrive | Fission_Thermal | 3 | 0 | 169200 | 19.62 | 0 | 0.85 | 1.660 | 1.953 | Hydrogen |
| Cavity Drive x4 | CavityDrivex4 | Project_CavityDrive | Fission_Thermal | 4 | 0 | 225600 | 19.62 | 0 | 0.85 | 2.213 | 2.604 | Hydrogen |
| Cavity Drive x5 | CavityDrivex5 | Project_CavityDrive | Fission_Thermal | 5 | 0 | 282000 | 19.62 | 0 | 0.85 | 2.766 | 3.255 | Hydrogen |
| Cavity Drive x6 | CavityDrivex6 | Project_CavityDrive | Fission_Thermal | 6 | 0 | 338400 | 19.62 | 0 | 0.85 | 3.320 | 3.906 | Hydrogen |
| Advanced Cavity Drive x1 | AdvancedCavityDrivex1 | Project_AdvancedCavityDrive | Fission_Thermal | 1 | 0 | 330000 | 24.48 | 0 | 0.85 | 4.039 | 4.752 | Hydrogen |
| Advanced Cavity Drive x2 | AdvancedCavityDrivex2 | Project_AdvancedCavityDrive | Fission_Thermal | 2 | 0 | 660000 | 24.48 | 0 | 0.85 | 8.078 | 9.504 | Hydrogen |
| Advanced Cavity Drive x3 | AdvancedCavityDrivex3 | Project_AdvancedCavityDrive | Fission_Thermal | 3 | 0 | 990000 | 24.48 | 0 | 0.85 | 12.118 | 14.256 | Hydrogen |
| Advanced Cavity Drive x4 | AdvancedCavityDrivex4 | Project_AdvancedCavityDrive | Fission_Thermal | 4 | 0 | 1320000 | 24.48 | 0 | 0.85 | 16.157 | 19.008 | Hydrogen |
| Advanced Cavity Drive x5 | AdvancedCavityDrivex5 | Project_AdvancedCavityDrive | Fission_Thermal | 5 | 0 | 1650000 | 24.48 | 0 | 0.85 | 20.196 | 23.760 | Hydrogen |
| Advanced Cavity Drive x6 | AdvancedCavityDrivex6 | Project_AdvancedCavityDrive | Fission_Thermal | 6 | 0 | 1980000 | 24.48 | 0 | 0.85 | 24.235 | 28.512 | Hydrogen |
| Quartz Drive x1 | QuartzDrivex1 | Project_QuartzDrive | Fission_Thermal | 1 | 0 | 117700 | 10.8 | 0 | 0.85 | 0.636 | 0.748 | Hydrogen |
| Quartz Drive x2 | QuartzDrivex2 | Project_QuartzDrive | Fission_Thermal | 2 | 0 | 235400 | 10.8 | 0 | 0.85 | 1.271 | 1.495 | Hydrogen |
| Quartz Drive x3 | QuartzDrivex3 | Project_QuartzDrive | Fission_Thermal | 3 | 0 | 353100 | 10.8 | 0 | 0.85 | 1.907 | 2.243 | Hydrogen |
| Quartz Drive x4 | QuartzDrivex4 | Project_QuartzDrive | Fission_Thermal | 4 | 0 | 470800 | 10.8 | 0 | 0.85 | 2.542 | 2.991 | Hydrogen |
| Quartz Drive x5 | QuartzDrivex5 | Project_QuartzDrive | Fission_Thermal | 5 | 0 | 588500 | 10.8 | 0 | 0.85 | 3.178 | 3.739 | Hydrogen |
| Quartz Drive x6 | QuartzDrivex6 | Project_QuartzDrive | Fission_Thermal | 6 | 0 | 706200 | 10.8 | 0 | 0.85 | 3.813 | 4.486 | Hydrogen |
| Lightbulb Drive x1 | LightbulbDrivex1 | Project_LightbulbDrive | Fission_Thermal | 1 | 0 | 409000 | 18.3 | 0 | 0.85 | 3.742 | 4.403 | Hydrogen |
| Lightbulb Drive x2 | LightbulbDrivex2 | Project_LightbulbDrive | Fission_Thermal | 2 | 0 | 818000 | 18.3 | 0 | 0.85 | 7.485 | 8.806 | Hydrogen |
| Lightbulb Drive x3 | LightbulbDrivex3 | Project_LightbulbDrive | Fission_Thermal | 3 | 0 | 1227000 | 18.3 | 0 | 0.85 | 11.227 | 13.208 | Hydrogen |
| Lightbulb Drive x4 | LightbulbDrivex4 | Project_LightbulbDrive | Fission_Thermal | 4 | 0 | 1636000 | 18.3 | 0 | 0.85 | 14.969 | 17.611 | Hydrogen |
| Lightbulb Drive x5 | LightbulbDrivex5 | Project_LightbulbDrive | Fission_Thermal | 5 | 0 | 2045000 | 18.3 | 0 | 0.85 | 18.712 | 22.014 | Hydrogen |
| Lightbulb Drive x6 | LightbulbDrivex6 | Project_LightbulbDrive | Fission_Thermal | 6 | 0 | 2454000 | 18.3 | 0 | 0.85 | 22.454 | 26.417 | Hydrogen |
| Pharos Drive x1 | PharosDrivex1 | Project_PharosDrive | Fission_Thermal | 1 | 0 | 445000 | 20.4 | 0 | 0.85 | 4.539 | 5.340 | Hydrogen |
| Pharos Drive x2 | PharosDrivex2 | Project_PharosDrive | Fission_Thermal | 2 | 0 | 890000 | 20.4 | 0 | 0.85 | 9.078 | 10.680 | Hydrogen |
| Pharos Drive x3 | PharosDrivex3 | Project_PharosDrive | Fission_Thermal | 3 | 0 | 1335000 | 20.4 | 0 | 0.85 | 13.617 | 16.020 | Hydrogen |
| Pharos Drive x4 | PharosDrivex4 | Project_PharosDrive | Fission_Thermal | 4 | 0 | 1780000 | 20.4 | 0 | 0.85 | 18.156 | 21.360 | Hydrogen |
| Pharos Drive x5 | PharosDrivex5 | Project_PharosDrive | Fission_Thermal | 5 | 0 | 2225000 | 20.4 | 0 | 0.85 | 22.695 | 26.700 | Hydrogen |
| Pharos Drive x6 | PharosDrivex6 | Project_PharosDrive | Fission_Thermal | 6 | 0 | 2670000 | 20.4 | 0 | 0.85 | 27.234 | 32.040 | Hydrogen |
| Lodestar Fission Lantern x1 | LodestarFissionLanternx1 | Project_LodestarFissionLantern | Fission_Thermal | 1 | 0 | 11000000 | 31.4 | 0 | 0.925 | 172.700 | 186.703 | Hydrogen |
| Lodestar Fission Lantern x2 | LodestarFissionLanternx2 | Project_LodestarFissionLantern | Fission_Thermal | 2 | 0 | 22000000 | 31.4 | 0 | 0.925 | 345.400 | 373.405 | Hydrogen |
| Lodestar Fission Lantern x3 | LodestarFissionLanternx3 | Project_LodestarFissionLantern | Fission_Thermal | 3 | 0 | 33000000 | 31.4 | 0 | 0.925 | 518.100 | 560.108 | Hydrogen |
| Lodestar Fission Lantern x4 | LodestarFissionLanternx4 | Project_LodestarFissionLantern | Fission_Thermal | 4 | 0 | 44000000 | 31.4 | 0 | 0.925 | 690.800 | 746.811 | Hydrogen |
| Lodestar Fission Lantern x5 | LodestarFissionLanternx5 | Project_LodestarFissionLantern | Fission_Thermal | 5 | 0 | 55000000 | 31.4 | 0 | 0.925 | 863.500 | 933.514 | Hydrogen |
| Lodestar Fission Lantern x6 | LodestarFissionLanternx6 | Project_LodestarFissionLantern | Fission_Thermal | 6 | 0 | 66000000 | 31.4 | 0 | 0.925 | 1,036.200 | 1,120.216 | Hydrogen |
| Fission Frag Drive x1 | FissionFragDrivex1 | Project_FissionFragDrive | Fission_Thermal | 1 | 0 | 4651 | 313.9 | 0 | 0.46 | 0.730 | 1.587 | ReactionProducts |
| Fission Frag Drive x2 | FissionFragDrivex2 | Project_FissionFragDrive | Fission_Thermal | 2 | 0 | 9302 | 313.9 | 0 | 0.46 | 1.460 | 3.174 | ReactionProducts |
| Fission Frag Drive x3 | FissionFragDrivex3 | Project_FissionFragDrive | Fission_Thermal | 3 | 0 | 13953 | 313.9 | 0 | 0.46 | 2.190 | 4.761 | ReactionProducts |
| Fission Frag Drive x4 | FissionFragDrivex4 | Project_FissionFragDrive | Fission_Thermal | 4 | 0 | 18604 | 313.9 | 0 | 0.46 | 2.920 | 6.348 | ReactionProducts |
| Fission Frag Drive x5 | FissionFragDrivex5 | Project_FissionFragDrive | Fission_Thermal | 5 | 0 | 23255 | 313.9 | 0 | 0.46 | 3.650 | 7.935 | ReactionProducts |
| Fission Frag Drive x6 | FissionFragDrivex6 | Project_FissionFragDrive | Fission_Thermal | 6 | 0 | 27906 | 313.9 | 0 | 0.46 | 4.380 | 9.521 | ReactionProducts |
| Dusty Plasma Drive x1 | DustyPlasmaDrivex1 | Project_DustyPlasmaDrive | Fission_Thermal | 1 | 0 | 5504 | 3750 | 0 | 0.46 | 10.320 | 22.435 | ReactionProducts |
| Dusty Plasma Drive x2 | DustyPlasmaDrivex2 | Project_DustyPlasmaDrive | Fission_Thermal | 2 | 0 | 11008 | 3750 | 0 | 0.46 | 20.640 | 44.870 | ReactionProducts |
| Dusty Plasma Drive x3 | DustyPlasmaDrivex3 | Project_DustyPlasmaDrive | Fission_Thermal | 3 | 0 | 16512 | 3750 | 0 | 0.46 | 30.960 | 67.304 | ReactionProducts |
| Dusty Plasma Drive x4 | DustyPlasmaDrivex4 | Project_DustyPlasmaDrive | Fission_Thermal | 4 | 0 | 22016 | 3750 | 0 | 0.46 | 41.280 | 89.739 | ReactionProducts |
| Dusty Plasma Drive x5 | DustyPlasmaDrivex5 | Project_DustyPlasmaDrive | Fission_Thermal | 5 | 0 | 27520 | 3750 | 0 | 0.46 | 51.600 | 112.174 | ReactionProducts |
| Dusty Plasma Drive x6 | DustyPlasmaDrivex6 | Project_DustyPlasmaDrive | Fission_Thermal | 6 | 0 | 33024 | 3750 | 0 | 0.46 | 61.920 | 134.609 | ReactionProducts |
| Burner Drive x1 | BurnerDrivex1 | Project_BurnerDrive | Fission_Thermal | 1 | 0 | 108000 | 69 | 0 | 0.85 | 3.726 | 4.384 | Hydrogen |
| Burner Drive x2 | BurnerDrivex2 | Project_BurnerDrive | Fission_Thermal | 2 | 0 | 216000 | 69 | 0 | 0.85 | 7.452 | 8.767 | Hydrogen |
| Burner Drive x3 | BurnerDrivex3 | Project_BurnerDrive | Fission_Thermal | 3 | 0 | 324000 | 69 | 0 | 0.85 | 11.178 | 13.151 | Hydrogen |
| Burner Drive x4 | BurnerDrivex4 | Project_BurnerDrive | Fission_Thermal | 4 | 0 | 432000 | 69 | 0 | 0.85 | 14.904 | 17.534 | Hydrogen |
| Burner Drive x5 | BurnerDrivex5 | Project_BurnerDrive | Fission_Thermal | 5 | 0 | 540000 | 69 | 0 | 0.85 | 18.630 | 21.918 | Hydrogen |
| Burner Drive x6 | BurnerDrivex6 | Project_BurnerDrive | Fission_Thermal | 6 | 0 | 648000 | 69 | 0 | 0.85 | 22.356 | 26.301 | Hydrogen |
| Flare Drive x1 | FlareDrivex1 | Project_FlareDrive | Fission_Thermal | 1 | 0 | 3500000 | 35 | 0 | 0.85 | 61.250 | 72.059 | Hydrogen |
| Flare Drive x2 | FlareDrivex2 | Project_FlareDrive | Fission_Thermal | 2 | 0 | 7000000 | 35 | 0 | 0.85 | 122.500 | 144.118 | Hydrogen |
| Flare Drive x3 | FlareDrivex3 | Project_FlareDrive | Fission_Thermal | 3 | 0 | 10500000 | 35 | 0 | 0.85 | 183.750 | 216.176 | Hydrogen |
| Flare Drive x4 | FlareDrivex4 | Project_FlareDrive | Fission_Thermal | 4 | 0 | 14000000 | 35 | 0 | 0.85 | 245.000 | 288.235 | Hydrogen |
| Flare Drive x5 | FlareDrivex5 | Project_FlareDrive | Fission_Thermal | 5 | 0 | 17500000 | 35 | 0 | 0.85 | 306.250 | 360.294 | Hydrogen |
| Flare Drive x6 | FlareDrivex6 | Project_FlareDrive | Fission_Thermal | 6 | 0 | 21000000 | 35 | 0 | 0.85 | 367.500 | 432.353 | Hydrogen |
| Firestar Fission Lantern x1 | FirestarFissionLanternx1 | Project_FirestarFissionLantern | Fission_Thermal | 1 | 0 | 5000000 | 50 | 0 | 0.85 | 125.000 | 147.059 | Hydrogen |
| Firestar Fission Lantern x2 | FirestarFissionLanternx2 | Project_FirestarFissionLantern | Fission_Thermal | 2 | 0 | 10000000 | 50 | 0 | 0.85 | 250.000 | 294.118 | Hydrogen |
| Firestar Fission Lantern x3 | FirestarFissionLanternx3 | Project_FirestarFissionLantern | Fission_Thermal | 3 | 0 | 15000000 | 50 | 0 | 0.85 | 375.000 | 441.176 | Hydrogen |
| Firestar Fission Lantern x4 | FirestarFissionLanternx4 | Project_FirestarFissionLantern | Fission_Thermal | 4 | 0 | 20000000 | 50 | 0 | 0.85 | 500.000 | 588.235 | Hydrogen |
| Firestar Fission Lantern x5 | FirestarFissionLanternx5 | Project_FirestarFissionLantern | Fission_Thermal | 5 | 0 | 25000000 | 50 | 0 | 0.85 | 625.000 | 735.294 | Hydrogen |
| Firestar Fission Lantern x6 | FirestarFissionLanternx6 | Project_FirestarFissionLantern | Fission_Thermal | 6 | 0 | 30000000 | 50 | 0 | 0.85 | 750.000 | 882.353 | Hydrogen |
| Neutron Flux Lantern x1 | NeutronFluxLanternx1 | Project_NeutronFluxLantern | NuclearSaltWater | 1 | 0 | 12900000 | 66 | 0.77 | 0.8 | 425.700 | 0.000 | Water |
| Neutron Flux Lantern x2 | NeutronFluxLanternx2 | Project_NeutronFluxLantern | NuclearSaltWater | 2 | 0 | 25800000 | 66 | 0.77 | 0.8 | 851.400 | 0.000 | Water |
| Neutron Flux Lantern x3 | NeutronFluxLanternx3 | Project_NeutronFluxLantern | NuclearSaltWater | 3 | 0 | 38700000 | 66 | 0.77 | 0.8 | 1,277.100 | 0.000 | Water |
| Neutron Flux Lantern x4 | NeutronFluxLanternx4 | Project_NeutronFluxLantern | NuclearSaltWater | 4 | 0 | 51600000 | 66 | 0.77 | 0.8 | 1,702.800 | 0.000 | Water |
| Neutron Flux Lantern x5 | NeutronFluxLanternx5 | Project_NeutronFluxLantern | NuclearSaltWater | 5 | 0 | 64500000 | 66 | 0.77 | 0.8 | 2,128.500 | 0.000 | Water |
| Neutron Flux Lantern x6 | NeutronFluxLanternx6 | Project_NeutronFluxLantern | NuclearSaltWater | 6 | 0 | 77400000 | 66 | 0.77 | 0.8 | 2,554.200 | 0.000 | Water |
| Neutron Flux Torch x1 | NeutronFluxTorchx1 | Project_NeutronFluxTorch | NuclearSaltWater | 1 | 0 | 13000000 | 1700 | 0.145 | 0.8 | 11,050.000 | 0.000 | Water |
| Neutron Flux Torch x2 | NeutronFluxTorchx2 | Project_NeutronFluxTorch | NuclearSaltWater | 2 | 0 | 26000000 | 1700 | 0.145 | 0.8 | 22,100.000 | 0.000 | Water |
| Neutron Flux Torch x3 | NeutronFluxTorchx3 | Project_NeutronFluxTorch | NuclearSaltWater | 3 | 0 | 39000000 | 1700 | 0.145 | 0.8 | 33,150.000 | 0.000 | Water |
| Neutron Flux Torch x4 | NeutronFluxTorchx4 | Project_NeutronFluxTorch | NuclearSaltWater | 4 | 0 | 52000000 | 1700 | 0.145 | 0.8 | 44,200.000 | 0.000 | Water |
| Neutron Flux Torch x5 | NeutronFluxTorchx5 | Project_NeutronFluxTorch | NuclearSaltWater | 5 | 0 | 65000000 | 1700 | 0.145 | 0.8 | 55,250.000 | 0.000 | Water |
| Neutron Flux Torch x6 | NeutronFluxTorchx6 | Project_NeutronFluxTorch | NuclearSaltWater | 6 | 0 | 78000000 | 1700 | 0.145 | 0.8 | 66,300.000 | 0.000 | Water |
| Z-pinch Microfission Drive x1 | Z-pinchMicrofissionDrivex1 | Project_Z-pinchMicrofissionDrive | Fission_Pulse | 1 | 0 | 24000 | 156.96 | 68 | 0.98 | 1.884 | 1.922 | ReactionProducts |
| Neutronium Microfission Drive x1 | NeutroniumMicrofissionDrivex1 | Project_NeutroniumMicrofissionDrive | Fission_Pulse | 1 | 0 | 180000 | 156.96 | 12 | 0.99 | 14.126 | 14.269 | ReactionProducts |
| Antimatter Microfission Drive x1 | AntimatterMicrofissionDrivex1 | Project_AntimatterMicrofissionDrive | Fission_Pulse | 1 | 0 | 275000 | 132.44 | 2 | 0.98 | 18.210 | 18.581 | ReactionProducts |
| Minimag Orion x1 | MinimagOrionx1 | Project_MinimagOrion | Fission_Pulse | 1 | 0 | 642000 | 93.16 | 0.05 | 1 | 29.906 | 29.906 | ReactionProducts |
| Advanced Minimag Orion x1 | AdvancedMinimagOrionx1 | Project_AdvancedMinimagOrion | Fission_Pulse | 1 | 0 | 1870000 | 157 | 0.005 | 1 | 146.795 | 146.795 | ReactionProducts |
| Orion Drive x1 | OrionDrivex1 | Project_OrionDrive | Fission_Pulse | 1 | 0 | 16000000 | 42.1 | 1.09 | 1 | 336.800 | 336.800 | ReactionProducts |
| Advanced Orion Drive x1 | AdvancedOrionDrivex1 | Project_AdvancedOrionDrive | Fission_Pulse | 1 | 0 | 24000000 | 120 | 0.14 | 1 | 1,440.000 | 1,440.000 | ReactionProducts |
| Triton Fusor Drive x1 | TritonFusorDrivex1 | Project_TritonFusorDrive | Fusion_Thermal | 1 | 0 | 38500 | 364 | 0 | 0.93 | 7.007 | 7.534 | ReactionProducts |
| Triton Fusor Drive x2 | TritonFusorDrivex2 | Project_TritonFusorDrive | Fusion_Thermal | 2 | 0 | 77000 | 364 | 0 | 0.93 | 14.014 | 15.069 | ReactionProducts |
| Triton Fusor Drive x3 | TritonFusorDrivex3 | Project_TritonFusorDrive | Fusion_Thermal | 3 | 0 | 115500 | 364 | 0 | 0.93 | 21.021 | 22.603 | ReactionProducts |
| Triton Fusor Drive x4 | TritonFusorDrivex4 | Project_TritonFusorDrive | Fusion_Thermal | 4 | 0 | 154000 | 364 | 0 | 0.93 | 28.028 | 30.138 | ReactionProducts |
| Triton Fusor Drive x5 | TritonFusorDrivex5 | Project_TritonFusorDrive | Fusion_Thermal | 5 | 0 | 192500 | 364 | 0 | 0.93 | 35.035 | 37.672 | ReactionProducts |
| Triton Fusor Drive x6 | TritonFusorDrivex6 | Project_TritonFusorDrive | Fusion_Thermal | 6 | 0 | 231000 | 364 | 0 | 0.93 | 42.042 | 45.206 | ReactionProducts |
| Deuteron Fusor Drive x1 | DeuteronFusorDrivex1 | Project_DeuteronFusorDrive | Fusion_Thermal | 1 | 0 | 19200 | 1250 | 0 | 0.98 | 12.000 | 12.245 | ReactionProducts |
| Deuteron Fusor Drive x2 | DeuteronFusorDrivex2 | Project_DeuteronFusorDrive | Fusion_Thermal | 2 | 0 | 38400 | 1250 | 0 | 0.98 | 24.000 | 24.490 | ReactionProducts |
| Deuteron Fusor Drive x3 | DeuteronFusorDrivex3 | Project_DeuteronFusorDrive | Fusion_Thermal | 3 | 0 | 57600 | 1250 | 0 | 0.98 | 36.000 | 36.735 | ReactionProducts |
| Deuteron Fusor Drive x4 | DeuteronFusorDrivex4 | Project_DeuteronFusorDrive | Fusion_Thermal | 4 | 0 | 76800 | 1250 | 0 | 0.98 | 48.000 | 48.980 | ReactionProducts |
| Deuteron Fusor Drive x5 | DeuteronFusorDrivex5 | Project_DeuteronFusorDrive | Fusion_Thermal | 5 | 0 | 96000 | 1250 | 0 | 0.98 | 60.000 | 61.224 | ReactionProducts |
| Deuteron Fusor Drive x6 | DeuteronFusorDrivex6 | Project_DeuteronFusorDrive | Fusion_Thermal | 6 | 0 | 115200 | 1250 | 0 | 0.98 | 72.000 | 73.469 | ReactionProducts |
| Protium Fusor Drive x1 | ProtiumFusorDrivex1 | Project_ProtiumFusorDrive | Fusion_Thermal | 1 | 0 | 55173 | 1818 | 0 | 0.99 | 50.152 | 50.659 | ReactionProducts |
| Protium Fusor Drive x2 | ProtiumFusorDrivex2 | Project_ProtiumFusorDrive | Fusion_Thermal | 2 | 0 | 110346 | 1818 | 0 | 0.99 | 100.305 | 101.318 | ReactionProducts |
| Protium Fusor Drive x3 | ProtiumFusorDrivex3 | Project_ProtiumFusorDrive | Fusion_Thermal | 3 | 0 | 165519 | 1818 | 0 | 0.99 | 150.457 | 151.977 | ReactionProducts |
| Protium Fusor Drive x4 | ProtiumFusorDrivex4 | Project_ProtiumFusorDrive | Fusion_Thermal | 4 | 0 | 220692 | 1818 | 0 | 0.99 | 200.609 | 202.635 | ReactionProducts |
| Protium Fusor Drive x5 | ProtiumFusorDrivex5 | Project_ProtiumFusorDrive | Fusion_Thermal | 5 | 0 | 275865 | 1818 | 0 | 0.99 | 250.761 | 253.294 | ReactionProducts |
| Protium Fusor Drive x6 | ProtiumFusorDrivex6 | Project_ProtiumFusorDrive | Fusion_Thermal | 6 | 0 | 331038 | 1818 | 0 | 0.99 | 300.914 | 303.953 | ReactionProducts |
| Triton Reflex Drive x1 | TritonReflexDrivex1 | Project_TritonReflexDrive | Fusion_Thermal | 1 | 0 | 75600 | 317 | 0 | 0.65 | 11.983 | 18.435 | Hydrogen |
| Triton Reflex Drive x2 | TritonReflexDrivex2 | Project_TritonReflexDrive | Fusion_Thermal | 2 | 0 | 151200 | 317 | 0 | 0.65 | 23.965 | 36.870 | Hydrogen |
| Triton Reflex Drive x3 | TritonReflexDrivex3 | Project_TritonReflexDrive | Fusion_Thermal | 3 | 0 | 226800 | 317 | 0 | 0.65 | 35.948 | 55.304 | Hydrogen |
| Triton Reflex Drive x4 | TritonReflexDrivex4 | Project_TritonReflexDrive | Fusion_Thermal | 4 | 0 | 302400 | 317 | 0 | 0.65 | 47.930 | 73.739 | Hydrogen |
| Triton Reflex Drive x5 | TritonReflexDrivex5 | Project_TritonReflexDrive | Fusion_Thermal | 5 | 0 | 378000 | 317 | 0 | 0.65 | 59.913 | 92.174 | Hydrogen |
| Triton Reflex Drive x6 | TritonReflexDrivex6 | Project_TritonReflexDrive | Fusion_Thermal | 6 | 0 | 453600 | 317 | 0 | 0.65 | 71.896 | 110.609 | Hydrogen |
| Deuteron Reflex Drive x1 | DeuteronReflexDrivex1 | Project_DeuteronReflexDrive | Fusion_Thermal | 1 | 0 | 60000 | 833 | 0 | 0.7 | 24.990 | 35.700 | Hydrogen |
| Deuteron Reflex Drive x2 | DeuteronReflexDrivex2 | Project_DeuteronReflexDrive | Fusion_Thermal | 2 | 0 | 120000 | 833 | 0 | 0.7 | 49.980 | 71.400 | Hydrogen |
| Deuteron Reflex Drive x3 | DeuteronReflexDrivex3 | Project_DeuteronReflexDrive | Fusion_Thermal | 3 | 0 | 180000 | 833 | 0 | 0.7 | 74.970 | 107.100 | Hydrogen |
| Deuteron Reflex Drive x4 | DeuteronReflexDrivex4 | Project_DeuteronReflexDrive | Fusion_Thermal | 4 | 0 | 240000 | 833 | 0 | 0.7 | 99.960 | 142.800 | Hydrogen |
| Deuteron Reflex Drive x5 | DeuteronReflexDrivex5 | Project_DeuteronReflexDrive | Fusion_Thermal | 5 | 0 | 300000 | 833 | 0 | 0.7 | 124.950 | 178.500 | Hydrogen |
| Deuteron Reflex Drive x6 | DeuteronReflexDrivex6 | Project_DeuteronReflexDrive | Fusion_Thermal | 6 | 0 | 360000 | 833 | 0 | 0.7 | 149.940 | 214.200 | Hydrogen |
| Helion Reflex Drive x1 | HelionReflexDrivex1 | Project_HelionReflexDrive | Fusion_Thermal | 1 | 0 | 97524 | 741 | 0 | 0.85 | 36.133 | 42.509 | Hydrogen |
| Helion Reflex Drive x2 | HelionReflexDrivex2 | Project_HelionReflexDrive | Fusion_Thermal | 2 | 0 | 195048 | 741 | 0 | 0.85 | 72.265 | 85.018 | Hydrogen |
| Helion Reflex Drive x3 | HelionReflexDrivex3 | Project_HelionReflexDrive | Fusion_Thermal | 3 | 0 | 292572 | 741 | 0 | 0.85 | 108.398 | 127.527 | Hydrogen |
| Helion Reflex Drive x4 | HelionReflexDrivex4 | Project_HelionReflexDrive | Fusion_Thermal | 4 | 0 | 390096 | 741 | 0 | 0.85 | 144.531 | 170.036 | Hydrogen |
| Helion Reflex Drive x5 | HelionReflexDrivex5 | Project_HelionReflexDrive | Fusion_Thermal | 5 | 0 | 487620 | 741 | 0 | 0.85 | 180.663 | 212.545 | Hydrogen |
| Helion Reflex Drive x6 | HelionReflexDrivex6 | Project_HelionReflexDrive | Fusion_Thermal | 6 | 0 | 585144 | 741 | 0 | 0.85 | 216.796 | 255.054 | Hydrogen |
| Triton Torus Drive x1 | TritonTorusDrivex1 | Project_TritonTorusDrive | Fusion_Thermal | 1 | 0 | 117000 | 308 | 0 | 0.85 | 18.018 | 21.198 | Hydrogen |
| Triton Torus Drive x2 | TritonTorusDrivex2 | Project_TritonTorusDrive | Fusion_Thermal | 2 | 0 | 234000 | 308 | 0 | 0.85 | 36.036 | 42.395 | Hydrogen |
| Triton Torus Drive x3 | TritonTorusDrivex3 | Project_TritonTorusDrive | Fusion_Thermal | 3 | 0 | 351000 | 308 | 0 | 0.85 | 54.054 | 63.593 | Hydrogen |
| Triton Torus Drive x4 | TritonTorusDrivex4 | Project_TritonTorusDrive | Fusion_Thermal | 4 | 0 | 468000 | 308 | 0 | 0.85 | 72.072 | 84.791 | Hydrogen |
| Triton Torus Drive x5 | TritonTorusDrivex5 | Project_TritonTorusDrive | Fusion_Thermal | 5 | 0 | 585000 | 308 | 0 | 0.85 | 90.090 | 105.988 | Hydrogen |
| Triton Torus Drive x6 | TritonTorusDrivex6 | Project_TritonTorusDrive | Fusion_Thermal | 6 | 0 | 702000 | 308 | 0 | 0.85 | 108.108 | 127.186 | Hydrogen |
| Deuteron Torus Drive x1 | DeuteronTorusDrivex1 | Project_DeuteronTorusDrive | Fusion_Thermal | 1 | 0 | 156000 | 769 | 0 | 0.9 | 59.982 | 66.647 | Hydrogen |
| Deuteron Torus Drive x2 | DeuteronTorusDrivex2 | Project_DeuteronTorusDrive | Fusion_Thermal | 2 | 0 | 312000 | 769 | 0 | 0.9 | 119.964 | 133.293 | Hydrogen |
| Deuteron Torus Drive x3 | DeuteronTorusDrivex3 | Project_DeuteronTorusDrive | Fusion_Thermal | 3 | 0 | 468000 | 769 | 0 | 0.9 | 179.946 | 199.940 | Hydrogen |
| Deuteron Torus Drive x4 | DeuteronTorusDrivex4 | Project_DeuteronTorusDrive | Fusion_Thermal | 4 | 0 | 624000 | 769 | 0 | 0.9 | 239.928 | 266.587 | Hydrogen |
| Deuteron Torus Drive x5 | DeuteronTorusDrivex5 | Project_DeuteronTorusDrive | Fusion_Thermal | 5 | 0 | 780000 | 769 | 0 | 0.9 | 299.910 | 333.233 | Hydrogen |
| Deuteron Torus Drive x6 | DeuteronTorusDrivex6 | Project_DeuteronTorusDrive | Fusion_Thermal | 6 | 0 | 936000 | 769 | 0 | 0.9 | 359.892 | 399.880 | Hydrogen |
| Helion Torus Lantern x1 | HelionTorusLanternx1 | Project_HelionTorusLantern | Fusion_Thermal | 1 | 0 | 556800 | 690 | 0 | 0.925 | 192.096 | 207.671 | Hydrogen |
| Helion Torus Lantern x2 | HelionTorusLanternx2 | Project_HelionTorusLantern | Fusion_Thermal | 2 | 0 | 1113600 | 690 | 0 | 0.925 | 384.192 | 415.343 | Hydrogen |
| Helion Torus Lantern x3 | HelionTorusLanternx3 | Project_HelionTorusLantern | Fusion_Thermal | 3 | 0 | 1670400 | 690 | 0 | 0.925 | 576.288 | 623.014 | Hydrogen |
| Helion Torus Lantern x4 | HelionTorusLanternx4 | Project_HelionTorusLantern | Fusion_Thermal | 4 | 0 | 2227200 | 690 | 0 | 0.925 | 768.384 | 830.685 | Hydrogen |
| Helion Torus Lantern x5 | HelionTorusLanternx5 | Project_HelionTorusLantern | Fusion_Thermal | 5 | 0 | 2784000 | 690 | 0 | 0.925 | 960.480 | 1,038.357 | Hydrogen |
| Helion Torus Lantern x6 | HelionTorusLanternx6 | Project_HelionTorusLantern | Fusion_Thermal | 6 | 0 | 3340800 | 690 | 0 | 0.925 | 1,152.576 | 1,246.028 | Hydrogen |
| Protium Torus Lantern x1 | ProtiumTorusLanternx1 | Project_ProtiumTorusLantern | Fusion_Thermal | 1 | 0 | 1680000 | 952 | 0 | 0.95 | 799.680 | 841.768 | Hydrogen |
| Protium Torus Lantern x2 | ProtiumTorusLanternx2 | Project_ProtiumTorusLantern | Fusion_Thermal | 2 | 0 | 3360000 | 952 | 0 | 0.95 | 1,599.360 | 1,683.537 | Hydrogen |
| Protium Torus Lantern x3 | ProtiumTorusLanternx3 | Project_ProtiumTorusLantern | Fusion_Thermal | 3 | 0 | 5040000 | 952 | 0 | 0.95 | 2,399.040 | 2,525.305 | Hydrogen |
| Protium Torus Lantern x4 | ProtiumTorusLanternx4 | Project_ProtiumTorusLantern | Fusion_Thermal | 4 | 0 | 6720000 | 952 | 0 | 0.95 | 3,198.720 | 3,367.074 | Hydrogen |
| Protium Torus Lantern x5 | ProtiumTorusLanternx5 | Project_ProtiumTorusLantern | Fusion_Thermal | 5 | 0 | 8400000 | 952 | 0 | 0.95 | 3,998.400 | 4,208.842 | Hydrogen |
| Protium Torus Lantern x6 | ProtiumTorusLanternx6 | Project_ProtiumTorusLantern | Fusion_Thermal | 6 | 0 | 10080000 | 952 | 0 | 0.95 | 4,798.080 | 5,050.611 | Hydrogen |
| Triton Polywell Drive x1 | TritonPolywellDrivex1 | Project_TritonPolywellDrive | Fusion_Thermal | 1 | 0 | 174000 | 276 | 0 | 0.85 | 24.012 | 28.249 | Hydrogen |
| Triton Polywell Drive x2 | TritonPolywellDrivex2 | Project_TritonPolywellDrive | Fusion_Thermal | 2 | 0 | 348000 | 276 | 0 | 0.85 | 48.024 | 56.499 | Hydrogen |
| Triton Polywell Drive x3 | TritonPolywellDrivex3 | Project_TritonPolywellDrive | Fusion_Thermal | 3 | 0 | 522000 | 276 | 0 | 0.85 | 72.036 | 84.748 | Hydrogen |
| Triton Polywell Drive x4 | TritonPolywellDrivex4 | Project_TritonPolywellDrive | Fusion_Thermal | 4 | 0 | 696000 | 276 | 0 | 0.85 | 96.048 | 112.998 | Hydrogen |
| Triton Polywell Drive x5 | TritonPolywellDrivex5 | Project_TritonPolywellDrive | Fusion_Thermal | 5 | 0 | 870000 | 276 | 0 | 0.85 | 120.060 | 141.247 | Hydrogen |
| Triton Polywell Drive x6 | TritonPolywellDrivex6 | Project_TritonPolywellDrive | Fusion_Thermal | 6 | 0 | 1044000 | 276 | 0 | 0.85 | 144.072 | 169.496 | Hydrogen |
| Deuteron Polywell Drive x1 | DeuteronPolywellDrivex1 | Project_DeuteronPolywellDrive | Fusion_Thermal | 1 | 0 | 251250 | 597 | 0 | 0.9 | 74.998 | 83.331 | Hydrogen |
| Deuteron Polywell Drive x2 | DeuteronPolywellDrivex2 | Project_DeuteronPolywellDrive | Fusion_Thermal | 2 | 0 | 502500 | 597 | 0 | 0.9 | 149.996 | 166.663 | Hydrogen |
| Deuteron Polywell Drive x3 | DeuteronPolywellDrivex3 | Project_DeuteronPolywellDrive | Fusion_Thermal | 3 | 0 | 753750 | 597 | 0 | 0.9 | 224.994 | 249.994 | Hydrogen |
| Deuteron Polywell Drive x4 | DeuteronPolywellDrivex4 | Project_DeuteronPolywellDrive | Fusion_Thermal | 4 | 0 | 1005000 | 597 | 0 | 0.9 | 299.993 | 333.325 | Hydrogen |
| Deuteron Polywell Drive x5 | DeuteronPolywellDrivex5 | Project_DeuteronPolywellDrive | Fusion_Thermal | 5 | 0 | 1256250 | 597 | 0 | 0.9 | 374.991 | 416.656 | Hydrogen |
| Deuteron Polywell Drive x6 | DeuteronPolywellDrivex6 | Project_DeuteronPolywellDrive | Fusion_Thermal | 6 | 0 | 1507500 | 597 | 0 | 0.9 | 449.989 | 499.988 | Hydrogen |
| Helion Plasmajet Lantern x1 | HelionPlasmajetLanternx1 | Project_HelionPlasmajetLantern | Fusion_Thermal | 1 | 0 | 1095000 | 548 | 0 | 0.95 | 300.030 | 315.821 | Hydrogen |
| Helion Plasmajet Lantern x2 | HelionPlasmajetLanternx2 | Project_HelionPlasmajetLantern | Fusion_Thermal | 2 | 0 | 2190000 | 548 | 0 | 0.95 | 600.060 | 631.642 | Hydrogen |
| Helion Plasmajet Lantern x3 | HelionPlasmajetLanternx3 | Project_HelionPlasmajetLantern | Fusion_Thermal | 3 | 0 | 3285000 | 548 | 0 | 0.95 | 900.090 | 947.463 | Hydrogen |
| Helion Plasmajet Lantern x4 | HelionPlasmajetLanternx4 | Project_HelionPlasmajetLantern | Fusion_Thermal | 4 | 0 | 4380000 | 548 | 0 | 0.95 | 1,200.120 | 1,263.284 | Hydrogen |
| Helion Plasmajet Lantern x5 | HelionPlasmajetLanternx5 | Project_HelionPlasmajetLantern | Fusion_Thermal | 5 | 0 | 5475000 | 548 | 0 | 0.95 | 1,500.150 | 1,579.105 | Hydrogen |
| Helion Plasmajet Lantern x6 | HelionPlasmajetLanternx6 | Project_HelionPlasmajetLantern | Fusion_Thermal | 6 | 0 | 6570000 | 548 | 0 | 0.95 | 1,800.180 | 1,894.926 | Hydrogen |
| Borane Plasmajet Torch x1 | BoranePlasmajetTorchx1 | Project_BoranePlasmajetTorch | Fusion_Thermal | 1 | 0 | 5040000 | 714 | 0 | 0.95 | 1,799.280 | 1,893.979 | Hydrogen |
| Borane Plasmajet Torch x2 | BoranePlasmajetTorchx2 | Project_BoranePlasmajetTorch | Fusion_Thermal | 2 | 0 | 10080000 | 714 | 0 | 0.95 | 3,598.560 | 3,787.958 | Hydrogen |
| Borane Plasmajet Torch x3 | BoranePlasmajetTorchx3 | Project_BoranePlasmajetTorch | Fusion_Thermal | 3 | 0 | 15120000 | 714 | 0 | 0.95 | 5,397.840 | 5,681.937 | Hydrogen |
| Borane Plasmajet Torch x4 | BoranePlasmajetTorchx4 | Project_BoranePlasmajetTorch | Fusion_Thermal | 4 | 0 | 20160000 | 714 | 0 | 0.95 | 7,197.120 | 7,575.916 | Hydrogen |
| Borane Plasmajet Torch x5 | BoranePlasmajetTorchx5 | Project_BoranePlasmajetTorch | Fusion_Thermal | 5 | 0 | 25200000 | 714 | 0 | 0.95 | 8,996.400 | 9,469.895 | Hydrogen |
| Borane Plasmajet Torch x6 | BoranePlasmajetTorchx6 | Project_BoranePlasmajetTorch | Fusion_Thermal | 6 | 0 | 30240000 | 714 | 0 | 0.95 | 10,795.680 | 11,363.874 | Hydrogen |
| Zeta Triton Drive x1 | ZetaTritonDrivex1 | Project_ZetaTritonDrive | Fusion_Thermal | 1 | 0 | 183600 | 392 | 0 | 0.85 | 35.986 | 42.336 | ReactionProducts |
| Zeta Triton Drive x2 | ZetaTritonDrivex2 | Project_ZetaTritonDrive | Fusion_Thermal | 2 | 0 | 367200 | 392 | 0 | 0.85 | 71.971 | 84.672 | ReactionProducts |
| Zeta Triton Drive x3 | ZetaTritonDrivex3 | Project_ZetaTritonDrive | Fusion_Thermal | 3 | 0 | 550800 | 392 | 0 | 0.85 | 107.957 | 127.008 | ReactionProducts |
| Zeta Triton Drive x4 | ZetaTritonDrivex4 | Project_ZetaTritonDrive | Fusion_Thermal | 4 | 0 | 734400 | 392 | 0 | 0.85 | 143.942 | 169.344 | ReactionProducts |
| Zeta Triton Drive x5 | ZetaTritonDrivex5 | Project_ZetaTritonDrive | Fusion_Thermal | 5 | 0 | 918000 | 392 | 0 | 0.85 | 179.928 | 211.680 | ReactionProducts |
| Zeta Triton Drive x6 | ZetaTritonDrivex6 | Project_ZetaTritonDrive | Fusion_Thermal | 6 | 0 | 1101600 | 392 | 0 | 0.85 | 215.914 | 254.016 | ReactionProducts |
| Zeta Deuteron Drive x1 | ZetaDeuteronDrivex1 | Project_ZetaDeuteronDrive | Fusion_Thermal | 1 | 0 | 108000 | 1667 | 0 | 0.9 | 90.018 | 100.020 | ReactionProducts |
| Zeta Deuteron Drive x2 | ZetaDeuteronDrivex2 | Project_ZetaDeuteronDrive | Fusion_Thermal | 2 | 0 | 216000 | 1667 | 0 | 0.9 | 180.036 | 200.040 | ReactionProducts |
| Zeta Deuteron Drive x3 | ZetaDeuteronDrivex3 | Project_ZetaDeuteronDrive | Fusion_Thermal | 3 | 0 | 324000 | 1667 | 0 | 0.9 | 270.054 | 300.060 | ReactionProducts |
| Zeta Deuteron Drive x4 | ZetaDeuteronDrivex4 | Project_ZetaDeuteronDrive | Fusion_Thermal | 4 | 0 | 432000 | 1667 | 0 | 0.9 | 360.072 | 400.080 | ReactionProducts |
| Zeta Deuteron Drive x5 | ZetaDeuteronDrivex5 | Project_ZetaDeuteronDrive | Fusion_Thermal | 5 | 0 | 540000 | 1667 | 0 | 0.9 | 450.090 | 500.100 | ReactionProducts |
| Zeta Deuteron Drive x6 | ZetaDeuteronDrivex6 | Project_ZetaDeuteronDrive | Fusion_Thermal | 6 | 0 | 648000 | 1667 | 0 | 0.9 | 540.108 | 600.120 | ReactionProducts |
| Zeta Deuteron Torch x1 | ZetaDeuteronTorchx1 | Project_ZetaDeuteronTorch | Fusion_Thermal | 1 | 0 | 720000 | 3334 | 0 | 0.95 | 1,200.240 | 1,263.411 | ReactionProducts |
| Zeta Deuteron Torch x2 | ZetaDeuteronTorchx2 | Project_ZetaDeuteronTorch | Fusion_Thermal | 2 | 0 | 1440000 | 3334 | 0 | 0.95 | 2,400.480 | 2,526.821 | ReactionProducts |
| Zeta Deuteron Torch x3 | ZetaDeuteronTorchx3 | Project_ZetaDeuteronTorch | Fusion_Thermal | 3 | 0 | 2160000 | 3334 | 0 | 0.95 | 3,600.720 | 3,790.232 | ReactionProducts |
| Zeta Deuteron Torch x4 | ZetaDeuteronTorchx4 | Project_ZetaDeuteronTorch | Fusion_Thermal | 4 | 0 | 2880000 | 3334 | 0 | 0.95 | 4,800.960 | 5,053.642 | ReactionProducts |
| Zeta Deuteron Torch x5 | ZetaDeuteronTorchx5 | Project_ZetaDeuteronTorch | Fusion_Thermal | 5 | 0 | 3600000 | 3334 | 0 | 0.95 | 6,001.200 | 6,317.053 | ReactionProducts |
| Zeta Deuteron Torch x6 | ZetaDeuteronTorchx6 | Project_ZetaDeuteronTorch | Fusion_Thermal | 6 | 0 | 4320000 | 3334 | 0 | 0.95 | 7,201.440 | 7,580.463 | ReactionProducts |
| Zeta Helion Lantern x1 | ZetaHelionLanternx1 | Project_ZetaHelionLantern | Fusion_Thermal | 1 | 0 | 600000 | 1335 | 0 | 0.96 | 400.500 | 417.188 | ReactionProducts |
| Zeta Helion Lantern x2 | ZetaHelionLanternx2 | Project_ZetaHelionLantern | Fusion_Thermal | 2 | 0 | 1200000 | 1335 | 0 | 0.96 | 801.000 | 834.375 | ReactionProducts |
| Zeta Helion Lantern x3 | ZetaHelionLanternx3 | Project_ZetaHelionLantern | Fusion_Thermal | 3 | 0 | 1800000 | 1335 | 0 | 0.96 | 1,201.500 | 1,251.563 | ReactionProducts |
| Zeta Helion Lantern x4 | ZetaHelionLanternx4 | Project_ZetaHelionLantern | Fusion_Thermal | 4 | 0 | 2400000 | 1335 | 0 | 0.96 | 1,602.000 | 1,668.750 | ReactionProducts |
| Zeta Helion Lantern x5 | ZetaHelionLanternx5 | Project_ZetaHelionLantern | Fusion_Thermal | 5 | 0 | 3000000 | 1335 | 0 | 0.96 | 2,002.500 | 2,085.938 | ReactionProducts |
| Zeta Helion Lantern x6 | ZetaHelionLanternx6 | Project_ZetaHelionLantern | Fusion_Thermal | 6 | 0 | 3600000 | 1335 | 0 | 0.96 | 2,403.000 | 2,503.125 | ReactionProducts |
| Zeta Borane Lantern x1 | ZetaBoraneLanternx1 | Project_ZetaBoraneLantern | Fusion_Thermal | 1 | 0 | 416000 | 3077 | 0 | 0.97 | 640.016 | 659.810 | ReactionProducts |
| Zeta Borane Lantern x2 | ZetaBoraneLanternx2 | Project_ZetaBoraneLantern | Fusion_Thermal | 2 | 0 | 832000 | 3077 | 0 | 0.97 | 1,280.032 | 1,319.621 | ReactionProducts |
| Zeta Borane Lantern x3 | ZetaBoraneLanternx3 | Project_ZetaBoraneLantern | Fusion_Thermal | 3 | 0 | 1248000 | 3077 | 0 | 0.97 | 1,920.048 | 1,979.431 | ReactionProducts |
| Zeta Borane Lantern x4 | ZetaBoraneLanternx4 | Project_ZetaBoraneLantern | Fusion_Thermal | 4 | 0 | 1664000 | 3077 | 0 | 0.97 | 2,560.064 | 2,639.241 | ReactionProducts |
| Zeta Borane Lantern x5 | ZetaBoraneLanternx5 | Project_ZetaBoraneLantern | Fusion_Thermal | 5 | 0 | 2080000 | 3077 | 0 | 0.97 | 3,200.080 | 3,299.052 | ReactionProducts |
| Zeta Borane Lantern x6 | ZetaBoraneLanternx6 | Project_ZetaBoraneLantern | Fusion_Thermal | 6 | 0 | 2496000 | 3077 | 0 | 0.97 | 3,840.096 | 3,958.862 | ReactionProducts |
| Triton Nova Drive x1 | TritonNovaDrivex1 | Project_TritonNovaDrive | Fusion_Thermal | 1 | 0 | 355200 | 270 | 0 | 0.8 | 47.952 | 59.940 | Hydrogen |
| Triton Nova Drive x2 | TritonNovaDrivex2 | Project_TritonNovaDrive | Fusion_Thermal | 2 | 0 | 710400 | 270 | 0 | 0.8 | 95.904 | 119.880 | Hydrogen |
| Triton Nova Drive x3 | TritonNovaDrivex3 | Project_TritonNovaDrive | Fusion_Thermal | 3 | 0 | 1065600 | 270 | 0 | 0.8 | 143.856 | 179.820 | Hydrogen |
| Triton Nova Drive x4 | TritonNovaDrivex4 | Project_TritonNovaDrive | Fusion_Thermal | 4 | 0 | 1420800 | 270 | 0 | 0.8 | 191.808 | 239.760 | Hydrogen |
| Triton Nova Drive x5 | TritonNovaDrivex5 | Project_TritonNovaDrive | Fusion_Thermal | 5 | 0 | 1776000 | 270 | 0 | 0.8 | 239.760 | 299.700 | Hydrogen |
| Triton Nova Drive x6 | TritonNovaDrivex6 | Project_TritonNovaDrive | Fusion_Thermal | 6 | 0 | 2131200 | 270 | 0 | 0.8 | 287.712 | 359.640 | Hydrogen |
| Deuteron Nova Lantern x1 | DeuteronNovaLanternx1 | Project_DeuteronNovaLantern | Fusion_Thermal | 1 | 0 | 420000 | 572 | 0 | 0.85 | 120.120 | 141.318 | Hydrogen |
| Deuteron Nova Lantern x2 | DeuteronNovaLanternx2 | Project_DeuteronNovaLantern | Fusion_Thermal | 2 | 0 | 840000 | 572 | 0 | 0.85 | 240.240 | 282.635 | Hydrogen |
| Deuteron Nova Lantern x3 | DeuteronNovaLanternx3 | Project_DeuteronNovaLantern | Fusion_Thermal | 3 | 0 | 1260000 | 572 | 0 | 0.85 | 360.360 | 423.953 | Hydrogen |
| Deuteron Nova Lantern x4 | DeuteronNovaLanternx4 | Project_DeuteronNovaLantern | Fusion_Thermal | 4 | 0 | 1680000 | 572 | 0 | 0.85 | 480.480 | 565.271 | Hydrogen |
| Deuteron Nova Lantern x5 | DeuteronNovaLanternx5 | Project_DeuteronNovaLantern | Fusion_Thermal | 5 | 0 | 2100000 | 572 | 0 | 0.85 | 600.600 | 706.588 | Hydrogen |
| Deuteron Nova Lantern x6 | DeuteronNovaLanternx6 | Project_DeuteronNovaLantern | Fusion_Thermal | 6 | 0 | 2520000 | 572 | 0 | 0.85 | 720.720 | 847.906 | Hydrogen |
| Helion Nova Lantern x1 | HelionNovaLanternx1 | Project_HelionNovaLantern | Fusion_Thermal | 1 | 0 | 1900000 | 527 | 0 | 0.95 | 500.650 | 527.000 | Hydrogen |
| Helion Nova Lantern x2 | HelionNovaLanternx2 | Project_HelionNovaLantern | Fusion_Thermal | 2 | 0 | 3800000 | 527 | 0 | 0.95 | 1,001.300 | 1,054.000 | Hydrogen |
| Helion Nova Lantern x3 | HelionNovaLanternx3 | Project_HelionNovaLantern | Fusion_Thermal | 3 | 0 | 5700000 | 527 | 0 | 0.95 | 1,501.950 | 1,581.000 | Hydrogen |
| Helion Nova Lantern x4 | HelionNovaLanternx4 | Project_HelionNovaLantern | Fusion_Thermal | 4 | 0 | 7600000 | 527 | 0 | 0.95 | 2,002.600 | 2,108.000 | Hydrogen |
| Helion Nova Lantern x5 | HelionNovaLanternx5 | Project_HelionNovaLantern | Fusion_Thermal | 5 | 0 | 9500000 | 527 | 0 | 0.95 | 2,503.250 | 2,635.000 | Hydrogen |
| Helion Nova Lantern x6 | HelionNovaLanternx6 | Project_HelionNovaLantern | Fusion_Thermal | 6 | 0 | 11400000 | 527 | 0 | 0.95 | 3,003.900 | 3,162.000 | Hydrogen |
| Helion Nova Torch x1 | HelionNovaTorchx1 | Project_HelionNovaTorch | Fusion_Thermal | 1 | 0 | 663000 | 9210 | 0 | 0.96 | 3,053.115 | 3,180.328 | Hydrogen |
| Helion Nova Torch x2 | HelionNovaTorchx2 | Project_HelionNovaTorch | Fusion_Thermal | 2 | 0 | 1326000 | 9210 | 0 | 0.96 | 6,106.230 | 6,360.656 | Hydrogen |
| Helion Nova Torch x3 | HelionNovaTorchx3 | Project_HelionNovaTorch | Fusion_Thermal | 3 | 0 | 1989000 | 9210 | 0 | 0.96 | 9,159.345 | 9,540.984 | Hydrogen |
| Helion Nova Torch x4 | HelionNovaTorchx4 | Project_HelionNovaTorch | Fusion_Thermal | 4 | 0 | 2652000 | 9210 | 0 | 0.96 | 12,212.460 | 12,721.313 | Hydrogen |
| Helion Nova Torch x5 | HelionNovaTorchx5 | Project_HelionNovaTorch | Fusion_Thermal | 5 | 0 | 3315000 | 9210 | 0 | 0.96 | 15,265.575 | 15,901.641 | Hydrogen |
| Helion Nova Torch x6 | HelionNovaTorchx6 | Project_HelionNovaTorch | Fusion_Thermal | 6 | 0 | 3978000 | 9210 | 0 | 0.96 | 18,318.690 | 19,081.969 | Hydrogen |
| Borane Nova Lantern x1 | BoraneNovaLanternx1 | Project_BoraneNovaLantern | Fusion_Thermal | 1 | 0 | 2669750 | 678 | 0 | 0.99 | 905.045 | 914.187 | Hydrogen |
| Borane Nova Lantern x2 | BoraneNovaLanternx2 | Project_BoraneNovaLantern | Fusion_Thermal | 2 | 0 | 5339500 | 678 | 0 | 0.99 | 1,810.091 | 1,828.374 | Hydrogen |
| Borane Nova Lantern x3 | BoraneNovaLanternx3 | Project_BoraneNovaLantern | Fusion_Thermal | 3 | 0 | 8009250 | 678 | 0 | 0.99 | 2,715.136 | 2,742.561 | Hydrogen |
| Borane Nova Lantern x4 | BoraneNovaLanternx4 | Project_BoraneNovaLantern | Fusion_Thermal | 4 | 0 | 10679000 | 678 | 0 | 0.99 | 3,620.181 | 3,656.748 | Hydrogen |
| Borane Nova Lantern x5 | BoraneNovaLanternx5 | Project_BoraneNovaLantern | Fusion_Thermal | 5 | 0 | 13348750 | 678 | 0 | 0.99 | 4,525.226 | 4,570.936 | Hydrogen |
| Borane Nova Lantern x6 | BoraneNovaLanternx6 | Project_BoraneNovaLantern | Fusion_Thermal | 6 | 0 | 16018500 | 678 | 0 | 0.99 | 5,430.272 | 5,485.123 | Hydrogen |
| Protium Nova Torch x1 | ProtiumNovaTorchx1 | Project_ProtiumNovaTorch | Fusion_Thermal | 1 | 0 | 6600000 | 1000 | 0 | 0.97 | 3,300.000 | 3,402.062 | Hydrogen |
| Protium Nova Torch x2 | ProtiumNovaTorchx2 | Project_ProtiumNovaTorch | Fusion_Thermal | 2 | 0 | 13200000 | 1000 | 0 | 0.97 | 6,600.000 | 6,804.124 | Hydrogen |
| Protium Nova Torch x3 | ProtiumNovaTorchx3 | Project_ProtiumNovaTorch | Fusion_Thermal | 3 | 0 | 19800000 | 1000 | 0 | 0.97 | 9,900.000 | 10,206.186 | Hydrogen |
| Protium Nova Torch x4 | ProtiumNovaTorchx4 | Project_ProtiumNovaTorch | Fusion_Thermal | 4 | 0 | 26400000 | 1000 | 0 | 0.97 | 13,200.000 | 13,608.247 | Hydrogen |
| Protium Nova Torch x5 | ProtiumNovaTorchx5 | Project_ProtiumNovaTorch | Fusion_Thermal | 5 | 0 | 33000000 | 1000 | 0 | 0.97 | 16,500.000 | 17,010.309 | Hydrogen |
| Protium Nova Torch x6 | ProtiumNovaTorchx6 | Project_ProtiumNovaTorch | Fusion_Thermal | 6 | 0 | 39600000 | 1000 | 0 | 0.97 | 19,800.000 | 20,412.371 | Hydrogen |
| Protium Converter Torch x1 | ProtiumConverterTorchx1 | Project_ProtiumConverterTorch | Fusion_Thermal | 1 | 0 | 9760000 | 10256 | 0 | 0.98 | 50,049.280 | 51,070.694 | ReactionProducts |
| Protium Converter Torch x2 | ProtiumConverterTorchx2 | Project_ProtiumConverterTorch | Fusion_Thermal | 2 | 0 | 19520000 | 10256 | 0 | 0.98 | 100,098.560 | 102,141.388 | ReactionProducts |
| Protium Converter Torch x3 | ProtiumConverterTorchx3 | Project_ProtiumConverterTorch | Fusion_Thermal | 3 | 0 | 29280000 | 10256 | 0 | 0.98 | 150,147.840 | 153,212.082 | ReactionProducts |
| Protium Converter Torch x4 | ProtiumConverterTorchx4 | Project_ProtiumConverterTorch | Fusion_Thermal | 4 | 0 | 39040000 | 10256 | 0 | 0.98 | 200,197.120 | 204,282.776 | ReactionProducts |
| Protium Converter Torch x5 | ProtiumConverterTorchx5 | Project_ProtiumConverterTorch | Fusion_Thermal | 5 | 0 | 48800000 | 10256 | 0 | 0.98 | 250,246.400 | 255,353.469 | ReactionProducts |
| Protium Converter Torch x6 | ProtiumConverterTorchx6 | Project_ProtiumConverterTorch | Fusion_Thermal | 6 | 0 | 58560000 | 10256 | 0 | 0.98 | 300,295.680 | 306,424.163 | ReactionProducts |
| Alien Fusion Lantern x1 | AlienFusionLanternx1 | Project_AlienMasterProject | Fusion_Thermal | 1 | 0 | 500000 | 633 | 0 | 0.95 | 158.250 | 166.579 | Hydrogen |
| Alien Fusion Lantern x2 | AlienFusionLanternx2 | Project_AlienMasterProject | Fusion_Thermal | 2 | 0 | 1000000 | 633 | 0 | 0.95 | 316.500 | 333.158 | Hydrogen |
| Alien Fusion Lantern x3 | AlienFusionLanternx3 | Project_AlienMasterProject | Fusion_Thermal | 3 | 0 | 1500000 | 633 | 0 | 0.95 | 474.750 | 499.737 | Hydrogen |
| Alien Fusion Lantern x4 | AlienFusionLanternx4 | Project_AlienMasterProject | Fusion_Thermal | 4 | 0 | 2000000 | 633 | 0 | 0.95 | 633.000 | 666.316 | Hydrogen |
| Alien Fusion Lantern x5 | AlienFusionLanternx5 | Project_AlienMasterProject | Fusion_Thermal | 5 | 0 | 2500000 | 633 | 0 | 0.95 | 791.250 | 832.895 | Hydrogen |
| Alien Fusion Lantern x6 | AlienFusionLanternx6 | Project_AlienMasterProject | Fusion_Thermal | 6 | 0 | 3000000 | 633 | 0 | 0.95 | 949.500 | 999.474 | Hydrogen |
| Alien Fusion Torch x1 | AlienFusionTorchx1 | Project_AlienMasterProject | Fusion_Thermal | 1 | 10 | 1590000 | 1300 | 0 | 0.97 | 1,033.500 | 1,065.464 | Hydrogen |
| Alien Fusion Torch x2 | AlienFusionTorchx2 | Project_AlienMasterProject | Fusion_Thermal | 2 | 20 | 3180000 | 1300 | 0 | 0.97 | 2,067.000 | 2,130.928 | Hydrogen |
| Alien Fusion Torch x3 | AlienFusionTorchx3 | Project_AlienMasterProject | Fusion_Thermal | 3 | 30 | 4770000 | 1300 | 0 | 0.97 | 3,100.500 | 3,196.392 | Hydrogen |
| Alien Fusion Torch x4 | AlienFusionTorchx4 | Project_AlienMasterProject | Fusion_Thermal | 4 | 40 | 6360000 | 1300 | 0 | 0.97 | 4,134.000 | 4,261.856 | Hydrogen |
| Alien Fusion Torch x5 | AlienFusionTorchx5 | Project_AlienMasterProject | Fusion_Thermal | 5 | 50 | 7950000 | 1300 | 0 | 0.97 | 5,167.500 | 5,327.320 | Hydrogen |
| Alien Fusion Torch x6 | AlienFusionTorchx6 | Project_AlienMasterProject | Fusion_Thermal | 6 | 60 | 9540000 | 1300 | 0 | 0.97 | 6,201.000 | 6,392.784 | Hydrogen |
| Advanced Alien Fusion Torch x1 | AdvancedAlienFusionTorchx1 | Project_AlienAdvancedMasterProject | Fusion_Thermal | 1 | 10 | 4390000 | 1600 | 0 | 0.98 | 3,512.000 | 3,583.673 | Hydrogen |
| Advanced Alien Fusion Torch x2 | AdvancedAlienFusionTorchx2 | Project_AlienAdvancedMasterProject | Fusion_Thermal | 2 | 20 | 8780000 | 1600 | 0 | 0.98 | 7,024.000 | 7,167.347 | Hydrogen |
| Advanced Alien Fusion Torch x3 | AdvancedAlienFusionTorchx3 | Project_AlienAdvancedMasterProject | Fusion_Thermal | 3 | 30 | 13170000 | 1600 | 0 | 0.98 | 10,536.000 | 10,751.020 | Hydrogen |
| Advanced Alien Fusion Torch x4 | AdvancedAlienFusionTorchx4 | Project_AlienAdvancedMasterProject | Fusion_Thermal | 4 | 40 | 17560000 | 1600 | 0 | 0.98 | 14,048.000 | 14,334.694 | Hydrogen |
| Advanced Alien Fusion Torch x5 | AdvancedAlienFusionTorchx5 | Project_AlienAdvancedMasterProject | Fusion_Thermal | 5 | 50 | 21950000 | 1600 | 0 | 0.98 | 17,560.000 | 17,918.367 | Hydrogen |
| Advanced Alien Fusion Torch x6 | AdvancedAlienFusionTorchx6 | Project_AlienAdvancedMasterProject | Fusion_Thermal | 6 | 60 | 26340000 | 1600 | 0 | 0.98 | 21,072.000 | 21,502.041 | Hydrogen |
| Antimatter Pulsed Plasma Core Lantern x1 | AntimatterPulsedPlasmaCoreLanternx1 | Project_AntimatterPulsedPlasmaCoreLantern | Antimatter | 1 | 0 | 1600000 | 240 | 0 | 0.998 | 192.000 | 192.385 | Hydrogen |
| Antimatter Pulsed Plasma Core Lantern x2 | AntimatterPulsedPlasmaCoreLanternx2 | Project_AntimatterPulsedPlasmaCoreLantern | Antimatter | 2 | 0 | 3200000 | 240 | 0 | 0.998 | 384.000 | 384.770 | Hydrogen |
| Antimatter Pulsed Plasma Core Lantern x3 | AntimatterPulsedPlasmaCoreLanternx3 | Project_AntimatterPulsedPlasmaCoreLantern | Antimatter | 3 | 0 | 4800000 | 240 | 0 | 0.998 | 576.000 | 577.154 | Hydrogen |
| Antimatter Pulsed Plasma Core Lantern x4 | AntimatterPulsedPlasmaCoreLanternx4 | Project_AntimatterPulsedPlasmaCoreLantern | Antimatter | 4 | 0 | 6400000 | 240 | 0 | 0.998 | 768.000 | 769.539 | Hydrogen |
| Antimatter Pulsed Plasma Core Lantern x5 | AntimatterPulsedPlasmaCoreLanternx5 | Project_AntimatterPulsedPlasmaCoreLantern | Antimatter | 5 | 0 | 8000000 | 240 | 0 | 0.998 | 960.000 | 961.924 | Hydrogen |
| Antimatter Pulsed Plasma Core Lantern x6 | AntimatterPulsedPlasmaCoreLanternx6 | Project_AntimatterPulsedPlasmaCoreLantern | Antimatter | 6 | 0 | 9600000 | 240 | 0 | 0.998 | 1,152.000 | 1,154.309 | Hydrogen |
| Antimatter Plasma Core Torch x1 | AntimatterPlasmaCoreTorchx1 | Project_AntimatterPlasmaCoreTorch | Antimatter | 1 | 0 | 3500000 | 595 | 0 | 0.998 | 1,041.250 | 1,043.337 | Hydrogen |
| Antimatter Plasma Core Torch x2 | AntimatterPlasmaCoreTorchx2 | Project_AntimatterPlasmaCoreTorch | Antimatter | 2 | 0 | 7000000 | 595 | 0 | 0.998 | 2,082.500 | 2,086.673 | Hydrogen |
| Antimatter Plasma Core Torch x3 | AntimatterPlasmaCoreTorchx3 | Project_AntimatterPlasmaCoreTorch | Antimatter | 3 | 0 | 10500000 | 595 | 0 | 0.998 | 3,123.750 | 3,130.010 | Hydrogen |
| Antimatter Plasma Core Torch x4 | AntimatterPlasmaCoreTorchx4 | Project_AntimatterPlasmaCoreTorch | Antimatter | 4 | 0 | 14000000 | 595 | 0 | 0.998 | 4,165.000 | 4,173.347 | Hydrogen |
| Antimatter Plasma Core Torch x5 | AntimatterPlasmaCoreTorchx5 | Project_AntimatterPlasmaCoreTorch | Antimatter | 5 | 0 | 17500000 | 595 | 0 | 0.998 | 5,206.250 | 5,216.683 | Hydrogen |
| Antimatter Plasma Core Torch x6 | AntimatterPlasmaCoreTorchx6 | Project_AntimatterPlasmaCoreTorch | Antimatter | 6 | 0 | 21000000 | 595 | 0 | 0.998 | 6,247.500 | 6,260.020 | Hydrogen |
| Advanced Antimatter Plasma Core Torch x1 | AdvancedAntimatterPlasmaCoreTorchx1 | Project_AdvancedAntimatterPlasmaCoreTorch | Antimatter | 1 | 0 | 4900000 | 2800 | 0 | 0.998 | 6,860.000 | 6,873.747 | Hydrogen |
| Advanced Antimatter Plasma Core Torch x2 | AdvancedAntimatterPlasmaCoreTorchx2 | Project_AdvancedAntimatterPlasmaCoreTorch | Antimatter | 2 | 0 | 9800000 | 2800 | 0 | 0.998 | 13,720.000 | 13,747.495 | Hydrogen |
| Advanced Antimatter Plasma Core Torch x3 | AdvancedAntimatterPlasmaCoreTorchx3 | Project_AdvancedAntimatterPlasmaCoreTorch | Antimatter | 3 | 0 | 14700000 | 2800 | 0 | 0.998 | 20,580.000 | 20,621.242 | Hydrogen |
| Advanced Antimatter Plasma Core Torch x4 | AdvancedAntimatterPlasmaCoreTorchx4 | Project_AdvancedAntimatterPlasmaCoreTorch | Antimatter | 4 | 0 | 19600000 | 2800 | 0 | 0.998 | 27,440.000 | 27,494.990 | Hydrogen |
| Advanced Antimatter Plasma Core Torch x5 | AdvancedAntimatterPlasmaCoreTorchx5 | Project_AdvancedAntimatterPlasmaCoreTorch | Antimatter | 5 | 0 | 24500000 | 2800 | 0 | 0.998 | 34,300.000 | 34,368.737 | Hydrogen |
| Advanced Antimatter Plasma Core Torch x6 | AdvancedAntimatterPlasmaCoreTorchx6 | Project_AdvancedAntimatterPlasmaCoreTorch | Antimatter | 6 | 0 | 29400000 | 2800 | 0 | 0.998 | 41,160.000 | 41,242.485 | Hydrogen |
| Pion Torch x1 | PionTorchx1 | Project_AntimatterBeamCoreTorch | Antimatter | 1 | 0 | 10000000 | 14720 | 0 | 0.998 | 73,600.000 | 73,747.495 | ReactionProducts |
| Pion Torch x2 | PionTorchx2 | Project_AntimatterBeamCoreTorch | Antimatter | 2 | 0 | 20000000 | 14720 | 0 | 0.998 | 147,200.000 | 147,494.990 | ReactionProducts |
| Pion Torch x3 | PionTorchx3 | Project_AntimatterBeamCoreTorch | Antimatter | 3 | 0 | 30000000 | 14720 | 0 | 0.998 | 220,800.000 | 221,242.485 | ReactionProducts |
| Pion Torch x4 | PionTorchx4 | Project_AntimatterBeamCoreTorch | Antimatter | 4 | 0 | 40000000 | 14720 | 0 | 0.998 | 294,400.000 | 294,989.980 | ReactionProducts |
| Pion Torch x5 | PionTorchx5 | Project_AntimatterBeamCoreTorch | Antimatter | 5 | 0 | 50000000 | 14720 | 0 | 0.998 | 368,000.000 | 368,737.475 | ReactionProducts |
| Pion Torch x6 | PionTorchx6 | Project_AntimatterBeamCoreTorch | Antimatter | 6 | 0 | 60000000 | 14720 | 0 | 0.998 | 441,600.000 | 442,484.970 | ReactionProducts |
| Resistojet x1 | Resistojetx1 | Project_Resistojet | Electrothermal | 1 | 0 | 1000 | 2.9 | 0 | 0.8 | 0.001 | 0.002 | Hydrogen |
| Resistojet x2 | Resistojetx2 | Project_Resistojet | Electrothermal | 2 | 0 | 2000 | 2.9 | 0 | 0.8 | 0.003 | 0.004 | Hydrogen |
| Resistojet x3 | Resistojetx3 | Project_Resistojet | Electrothermal | 3 | 0 | 3000 | 2.9 | 0 | 0.8 | 0.004 | 0.005 | Hydrogen |
| Resistojet x4 | Resistojetx4 | Project_Resistojet | Electrothermal | 4 | 0 | 4000 | 2.9 | 0 | 0.8 | 0.006 | 0.007 | Hydrogen |
| Resistojet x5 | Resistojetx5 | Project_Resistojet | Electrothermal | 5 | 0 | 5000 | 2.9 | 0 | 0.8 | 0.007 | 0.009 | Hydrogen |
| Resistojet x6 | Resistojetx6 | Project_Resistojet | Electrothermal | 6 | 0 | 6000 | 2.9 | 0 | 0.8 | 0.009 | 0.011 | Hydrogen |
| Arcjet Drive x1 | ArcjetDrivex1 | Project_ArcjetDrive | Electrothermal | 1 | 0 | 1000 | 19.6 | 0 | 0.52 | 0.010 | 0.019 | Hydrogen |
| Arcjet Drive x2 | ArcjetDrivex2 | Project_ArcjetDrive | Electrothermal | 2 | 0 | 2000 | 19.6 | 0 | 0.52 | 0.020 | 0.038 | Hydrogen |
| Arcjet Drive x3 | ArcjetDrivex3 | Project_ArcjetDrive | Electrothermal | 3 | 0 | 3000 | 19.6 | 0 | 0.52 | 0.029 | 0.057 | Hydrogen |
| Arcjet Drive x4 | ArcjetDrivex4 | Project_ArcjetDrive | Electrothermal | 4 | 0 | 4000 | 19.6 | 0 | 0.52 | 0.039 | 0.075 | Hydrogen |
| Arcjet Drive x5 | ArcjetDrivex5 | Project_ArcjetDrive | Electrothermal | 5 | 0 | 5000 | 19.6 | 0 | 0.52 | 0.049 | 0.094 | Hydrogen |
| Arcjet Drive x6 | ArcjetDrivex6 | Project_ArcjetDrive | Electrothermal | 6 | 0 | 6000 | 19.6 | 0 | 0.52 | 0.059 | 0.113 | Hydrogen |
| Hall Drive x1 | HallDrivex1 | Project_HallDrive | Electrostatic | 1 | 0 | 3300 | 19.62 | 0 | 0.53 | 0.032 | 0.061 | Metals |
| Hall Drive x2 | HallDrivex2 | Project_HallDrive | Electrostatic | 2 | 0 | 6600 | 19.62 | 0 | 0.53 | 0.065 | 0.122 | Metals |
| Hall Drive x3 | HallDrivex3 | Project_HallDrive | Electrostatic | 3 | 0 | 9900 | 19.62 | 0 | 0.53 | 0.097 | 0.183 | Metals |
| Hall Drive x4 | HallDrivex4 | Project_HallDrive | Electrostatic | 4 | 0 | 13200 | 19.62 | 0 | 0.53 | 0.129 | 0.244 | Metals |
| Hall Drive x5 | HallDrivex5 | Project_HallDrive | Electrostatic | 5 | 0 | 16500 | 19.62 | 0 | 0.53 | 0.162 | 0.305 | Metals |
| Hall Drive x6 | HallDrivex6 | Project_HallDrive | Electrostatic | 6 | 0 | 19800 | 19.62 | 0 | 0.53 | 0.194 | 0.366 | Metals |

## Kinetic Guns

| Component | Template ID | Required Project | Mount | Crew | Weapon Mass (t) | Cooldown (s) | Salvo Shots | Magazine | Ammo Mass (kg) | Muzzle Vel. (km/s) | Warhead (kg) | Bombard | Range (km) | Pivot (deg) | PD Target? | Damage (MJ) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30mm Autocannon | 30mmAutocannon | Project_Warships | OneHull | 1 | 3 | 4 | 10 | 3000 | 5.5 | 1.35 | 3.5 | 0 | 200 | 180 | False | 3.189375 |
| 35mm Autocannon | 35mmAutocannon |  | HalfNose | 0 | 1 | 4 | 4 | 200 | 10 | 2 | 5.5 | 0 | 200 | 15 | False | 11 |
| 40mm Autocannon | 40mmAutocannon | Project_40mmAutocannon | OneHull | 1 | 25 | 4 | 6 | 2000 | 10 | 2.6 | 6 | 0 | 350 | 180 | False | 20.28 |
| 6-inch Cannon | 6-inchCannon | Project_Warships | OneHull | 3 | 25 | 12 | 4 | 600 | 45 | 1.4 | 22.5 | 0 | 250 | 180 | True | 22.05 |
| 8-inch Cannon | 8-inchCannon | Project_PatrolVessels | TwoHullHoriz | 4 | 50 | 15 | 4 | 400 | 100 | 1.4 | 50 | 0 | 250 | 180 | True | 49 |
| 10-inch Cannon | 10-inchCannon | Project_Warships | OneNose | 4 | 125 | 16 | 3 | 300 | 180 | 1.4 | 90 | 0 | 250 | 30 | True | 88.2 |
| 12-inch Cannon | 12-inchCannon | Project_PatrolVessels | TwoNoseVert | 5 | 225 | 20 | 2 | 250 | 320 | 1.4 | 160 | 0 | 250 | 30 | True | 156.8 |

## Heat Sinks

| Component | Template ID | Display Name | Required Project | Mass (t) | Crew | Heat Cap. (GJ) |
|---|---|---|---|---|---|---|
| Water Heat Sink | WaterHeatSink | Project_Warships | 250 | 1 | 100 |
| Potassium Heat Sink | PotassiumHeatSink | Project_PotassiumHeatSink | 205 | 1 | 110 |
| Sodium Heat Sink | SodiumHeatSink | Project_SodiumHeatSink | 230 | 1 | 370 |
| Lithium Heat Sink | LithiumHeatSink | Project_LithiumHeatSink | 128 | 1 | 525 |
| Molten Salt Heat Sink | MoltenSaltHeatSink | Project_MoltenSaltHeatSink | 485 | 1 | 900 |
| Exotic Heat Sink | ExoticHeatSink | Project_ExoticHeatSink | 250 | 1 | 1800 |
| Heavy Water Heat Sink | HeavyWaterHeatSink | Project_Warships | 500 | 1 | 200 |
| Heavy Potassium Heat Sink | HeavyPotassiumHeatSink | Project_PotassiumHeatSink | 410 | 1 | 220 |
| Heavy Sodium Heat Sink | HeavySodiumHeatSink | Project_SodiumHeatSink | 460 | 1 | 740 |
| Heavy Lithium Heat Sink | HeavyLithiumHeatSink | Project_LithiumHeatSink | 256 | 1 | 1050 |
| Heavy Molten Salt Heat Sink | HeavyMoltenSaltHeatSink | Project_MoltenSaltHeatSink | 970 | 1 | 1800 |
| Heavy Exotic Heat Sink | HeavyExoticHeatSink | Project_ExoticHeatSink | 500 | 1 | 3600 |
| Alien Lithium Heat Sink | AlienLithiumHeatSink | Project_AlienMasterProject | 256 | 0 | 1050 |
| Alien Exotic Heat Sink | AlienExoticHeatSink | Project_AlienMasterProject | 500 | 0 | 3600 |

## Laser Weapons

| Component | Template ID | Required Project | Mount | Crew | Weapon Mass (t) | Cooldown (s) | Eff. | Shot Power (MJ) | λ (nm) | Mirror (cm) | Bombard | Range (km) | Pivot (deg) | PD Target? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Point Defense Laser Turret | PointDefenseLaserTurret | Project_PointDefenseLaserTurret | OneHull | 2 | 20 | 5 | 0.25 | 50 | 1080 | 30 | 0 | 250 | 180 | False |
| 60 cm IR Laser Battery | 60cmIRLaserBattery | Project_60cmIRLaserBattery | OneHull | 2 | 150 | 30 | 0.25 | 100 | 810 | 60 | 0.2 | 600 | 180 | False |
| 120 cm IR Laser Battery | 120cmIRLaserBattery | Project_60cmIRLaserBattery | TwoHullHoriz | 3 | 200 | 30 | 0.25 | 150 | 810 | 120 | 0.4 | 700 | 180 | False |
| 360 cm IR Laser Battery | 360cmIRLaserBattery | Project_60cmIRLaserBattery | FourHull | 4 | 400 | 30 | 0.25 | 250 | 810 | 360 | 0.8 | 850 | 180 | False |
| 240 cm IR Laser Cannon | 240cmIRLaserCannon | Project_240cmIRLaserCannon | OneNose | 4 | 300 | 30 | 0.25 | 200 | 810 | 240 | 0.6 | 800 | 45 | False |
| 480 cm IR Laser Cannon | 480cmIRLaserCannon | Project_240cmIRLaserCannon | TwoNoseVert | 5 | 500 | 30 | 0.25 | 300 | 810 | 480 | 1 | 900 | 45 | False |
| 720 cm IR Laser Cannon | 720cmIRLaserCannon | Project_240cmIRLaserCannon | ThreeNoseAngle | 6 | 700 | 30 | 0.25 | 350 | 810 | 720 | 1.4 | 950 | 45 | False |
| 960 cm IR Laser Cannon | 960cmIRLaserCannon | Project_240cmIRLaserCannon | FourNose | 8 | 900 | 30 | 0.25 | 400 | 810 | 960 | 2 | 1000 | 45 | False |
| Point Defense Arc Laser Turret | PointDefenseArcLaserTurret | Project_PointDefenseArcLaserTurret | OneHull | 2 | 20 | 4 | 0.35 | 50 | 1080 | 30 | 0 | 300 | 180 | False |
| 60 cm IR Arc Laser Battery | 60cmIRArcLaserBattery | Project_60cmIRArcLaserBattery | OneHull | 2 | 115 | 20 | 0.35 | 100 | 810 | 60 | 0.2 | 600 | 180 | False |
| 120 cm IR Arc Laser Battery | 120cmIRArcLaserBattery | Project_60cmIRArcLaserBattery | TwoHullHoriz | 3 | 155 | 20 | 0.35 | 150 | 810 | 120 | 0.4 | 700 | 180 | False |
| 360 cm IR Arc Laser Battery | 360cmIRArcLaserBattery | Project_60cmIRArcLaserBattery | FourHull | 4 | 315 | 20 | 0.35 | 250 | 810 | 360 | 0.8 | 850 | 180 | False |
| 240 cm IR Arc Laser Cannon | 240cmIRArcLaserCannon | Project_240cmIRArcLaserCannon | OneNose | 4 | 235 | 20 | 0.35 | 200 | 810 | 240 | 0.6 | 800 | 45 | False |
| 480 cm IR Arc Laser Cannon | 480cmIRArcLaserCannon | Project_240cmIRArcLaserCannon | TwoNoseVert | 5 | 395 | 20 | 0.35 | 300 | 810 | 480 | 1 | 900 | 45 | False |
| 720 cm IR Arc Laser Cannon | 720cmIRArcLaserCannon | Project_240cmIRArcLaserCannon | ThreeNoseAngle | 6 | 555 | 20 | 0.35 | 350 | 810 | 720 | 1.4 | 950 | 45 | False |
| 960 cm IR Arc Laser Cannon | 960cmIRArcLaserCannon | Project_240cmIRArcLaserCannon | FourNose | 8 | 715 | 20 | 0.35 | 400 | 810 | 960 | 2 | 1000 | 45 | False |
| Point Defense Phaser Turret | PointDefensePhaserTurret | Project_PointDefensePhaserTurret | OneHull | 2 | 20 | 3 | 0.45 | 50 | 1080 | 30 | 0 | 350 | 180 | False |
| 60 cm IR Phaser Battery | 60cmIRPhaserBattery | Project_60cmIRPhaserBattery | OneHull | 2 | 75 | 10 | 0.45 | 100 | 810 | 60 | 0.2 | 600 | 180 | False |
| 120 cm IR Phaser Battery | 120cmIRPhaserBattery | Project_60cmIRPhaserBattery | TwoHullHoriz | 3 | 100 | 10 | 0.45 | 150 | 810 | 120 | 0.4 | 700 | 180 | False |
| 360 cm IR Phaser Battery | 360cmIRPhaserBattery | Project_60cmIRPhaserBattery | FourHull | 4 | 200 | 10 | 0.45 | 250 | 810 | 360 | 0.8 | 850 | 180 | False |
| 240 cm IR Phaser Cannon | 240cmIRPhaserCannon | Project_240cmIRPhaserCannon | OneNose | 4 | 150 | 10 | 0.45 | 200 | 810 | 240 | 0.6 | 800 | 45 | False |
| 480 cm IR Phaser Cannon | 480cmIRPhaserCannon | Project_240cmIRPhaserCannon | TwoNoseVert | 5 | 250 | 10 | 0.45 | 300 | 810 | 480 | 1 | 900 | 45 | False |
| 720 cm IR Phaser Cannon | 720cmIRPhaserCannon | Project_240cmIRPhaserCannon | ThreeNoseAngle | 6 | 350 | 10 | 0.45 | 350 | 810 | 720 | 1.4 | 950 | 45 | False |
| 960 cm IR Phaser Cannon | 960cmIRPhaserCannon | Project_240cmIRPhaserCannon | FourNose | 8 | 450 | 10 | 0.45 | 400 | 810 | 960 | 2 | 1000 | 45 | False |
| 60 cm Green Laser Battery | 60cmGreenLaserBattery | Project_60cmGreenLaserBattery | OneHull | 2 | 150 | 30 | 0.2 | 100 | 540 | 60 | 0.2 | 600 | 180 | False |
| 120 cm Green Laser Battery | 120cmGreenLaserBattery | Project_60cmGreenLaserBattery | TwoHullHoriz | 3 | 200 | 30 | 0.2 | 150 | 540 | 120 | 0.4 | 700 | 180 | False |
| 360 cm Green Laser Battery | 360cmGreenLaserBattery | Project_60cmGreenLaserBattery | FourHull | 4 | 400 | 30 | 0.2 | 250 | 540 | 360 | 0.8 | 850 | 180 | False |
| 240 cm Green Laser Cannon | 240cmGreenLaserCannon | Project_240cmGreenLaserCannon | OneNose | 4 | 300 | 30 | 0.2 | 200 | 540 | 240 | 0.6 | 800 | 45 | False |
| 480 cm Green Laser Cannon | 480cmGreenLaserCannon | Project_240cmGreenLaserCannon | TwoNoseVert | 5 | 500 | 30 | 0.2 | 300 | 540 | 480 | 1 | 900 | 45 | False |
| 720 cm Green Laser Cannon | 720cmGreenLaserCannon | Project_240cmGreenLaserCannon | ThreeNoseAngle | 6 | 700 | 30 | 0.2 | 350 | 540 | 720 | 1.4 | 950 | 45 | False |
| 960 cm Green Laser Cannon | 960cmGreenLaserCannon | Project_240cmGreenLaserCannon | FourNose | 8 | 900 | 30 | 0.2 | 400 | 540 | 960 | 2 | 1000 | 45 | False |
| 60 cm Green Arc Laser Battery | 60cmGreenArcLaserBattery | Project_60cmGreenArcLaserBattery | OneHull | 2 | 115 | 20 | 0.3 | 100 | 540 | 60 | 0.4 | 600 | 180 | False |
| 120 cm Green Arc Laser Battery | 120cmGreenArcLaserBattery | Project_60cmGreenArcLaserBattery | TwoHullHoriz | 3 | 155 | 20 | 0.3 | 150 | 540 | 120 | 0.8 | 700 | 180 | False |
| 360 cm Green Arc Laser Battery | 360cmGreenArcLaserBattery | Project_60cmGreenArcLaserBattery | FourHull | 4 | 315 | 20 | 0.3 | 250 | 540 | 360 | 1.6 | 850 | 180 | False |
| 240 cm Green Arc Laser Cannon | 240cmGreenArcLaserCannon | Project_240cmGreenArcLaserCannon | OneNose | 4 | 235 | 20 | 0.3 | 200 | 540 | 240 | 1.2 | 800 | 45 | False |
| 480 cm Green Arc Laser Cannon | 480cmGreenArcLaserCannon | Project_240cmGreenArcLaserCannon | TwoNoseVert | 5 | 395 | 20 | 0.3 | 300 | 540 | 480 | 2 | 900 | 45 | False |
| 720 cm Green Arc Laser Cannon | 720cmGreenArcLaserCannon | Project_240cmGreenArcLaserCannon | ThreeNoseAngle | 6 | 555 | 20 | 0.3 | 350 | 540 | 720 | 2.8 | 950 | 45 | False |
| 960 cm Green Arc Laser Cannon | 960cmGreenArcLaserCannon | Project_240cmGreenArcLaserCannon | FourNose | 8 | 715 | 20 | 0.3 | 400 | 540 | 960 | 4 | 1000 | 45 | False |
| 60 cm Green Phaser Battery | 60cmGreenPhaserBattery | Project_60cmGreenPhaserBattery | OneHull | 2 | 115 | 10 | 0.4 | 100 | 540 | 60 | 0.8 | 600 | 180 | False |
| 120 cm Green Phaser Battery | 120cmGreenPhaserBattery | Project_60cmGreenPhaserBattery | TwoHullHoriz | 3 | 155 | 10 | 0.4 | 150 | 540 | 120 | 1.6 | 700 | 180 | False |
| 360 cm Green Phaser Battery | 360cmGreenPhaserBattery | Project_60cmGreenPhaserBattery | FourHull | 4 | 315 | 10 | 0.4 | 250 | 540 | 360 | 3.2 | 850 | 180 | False |
| 240 cm Green Phaser Cannon | 240cmGreenPhaserCannon | Project_240cmGreenPhaserCannon | OneNose | 4 | 235 | 10 | 0.4 | 200 | 540 | 240 | 2.4 | 800 | 45 | False |
| 480 cm Green Phaser Cannon | 480cmGreenPhaserCannon | Project_240cmGreenPhaserCannon | TwoNoseVert | 5 | 395 | 10 | 0.4 | 300 | 540 | 480 | 4 | 900 | 45 | False |
| 720 cm Green Phaser Cannon | 720cmGreenPhaserCannon | Project_240cmGreenPhaserCannon | ThreeNoseAngle | 6 | 555 | 10 | 0.4 | 350 | 540 | 720 | 5.6 | 950 | 45 | False |
| 960 cm Green Phaser Cannon | 960cmGreenPhaserCannon | Project_240cmGreenPhaserCannon | FourNose | 8 | 715 | 10 | 0.4 | 400 | 540 | 960 | 8 | 1000 | 45 | False |
| 60 cm UV Laser Battery | 60cmUVLaserBattery | Project_60cmUVLaserBattery | OneHull | 2 | 150 | 30 | 0.1 | 100 | 270 | 60 | 0.2 | 600 | 180 | False |
| 120 cm UV Laser Battery | 120cmUVLaserBattery | Project_60cmUVLaserBattery | TwoHullHoriz | 3 | 200 | 30 | 0.1 | 150 | 270 | 120 | 0.4 | 700 | 180 | False |
| 360 cm UV Laser Battery | 360cmUVLaserBattery | Project_60cmUVLaserBattery | FourHull | 4 | 400 | 30 | 0.1 | 250 | 270 | 360 | 0.8 | 850 | 180 | False |
| 240 cm UV Laser Cannon | 240cmUVLaserCannon | Project_240cmUVLaserCannon | OneNose | 4 | 300 | 30 | 0.1 | 200 | 270 | 240 | 0.6 | 800 | 45 | False |
| 480 cm UV Laser Cannon | 480cmUVLaserCannon | Project_240cmUVLaserCannon | TwoNoseVert | 5 | 500 | 30 | 0.1 | 300 | 270 | 480 | 1 | 900 | 45 | False |
| 720 cm UV Laser Cannon | 720cmUVLaserCannon | Project_240cmUVLaserCannon | ThreeNoseAngle | 6 | 700 | 30 | 0.1 | 350 | 270 | 720 | 1.4 | 950 | 45 | False |
| 960 cm UV Laser Cannon | 960cmUVLaserCannon | Project_240cmUVLaserCannon | FourNose | 8 | 900 | 30 | 0.1 | 400 | 270 | 960 | 2 | 1000 | 45 | False |
| 60 cm UV Arc Laser Battery | 60cmUVArcLaserBattery | Project_60cmUVArcLaserBattery | OneHull | 2 | 115 | 20 | 0.2 | 100 | 270 | 60 | 0.4 | 600 | 180 | False |
| 120 cm UV Arc Laser Battery | 120cmUVArcLaserBattery | Project_60cmUVArcLaserBattery | TwoHullHoriz | 3 | 155 | 20 | 0.2 | 150 | 270 | 120 | 0.8 | 700 | 180 | False |
| 360 cm UV Arc Laser Battery | 360cmUVArcLaserBattery | Project_60cmUVArcLaserBattery | FourHull | 4 | 315 | 20 | 0.2 | 250 | 270 | 360 | 1.6 | 850 | 180 | False |
| 240 cm UV Arc Laser Cannon | 240cmUVArcLaserCannon | Project_240cmUVArcLaserCannon | OneNose | 4 | 235 | 20 | 0.2 | 200 | 270 | 240 | 1.2 | 800 | 45 | False |
| 480 cm UV Arc Laser Cannon | 480cmUVArcLaserCannon | Project_240cmUVArcLaserCannon | TwoNoseVert | 5 | 395 | 20 | 0.2 | 300 | 270 | 480 | 2 | 900 | 45 | False |
| 720 cm UV Arc Laser Cannon | 720cmUVArcLaserCannon | Project_240cmUVArcLaserCannon | ThreeNoseAngle | 6 | 555 | 20 | 0.2 | 350 | 270 | 720 | 2.8 | 950 | 45 | False |
| 960 cm UV Arc Laser Cannon | 960cmUVArcLaserCannon | Project_240cmUVArcLaserCannon | FourNose | 8 | 715 | 20 | 0.2 | 400 | 270 | 960 | 4 | 1000 | 45 | False |
| 60 cm UV Phaser Battery | 60cmUVPhaserBattery | Project_60cmUVPhaserBattery | OneHull | 2 | 115 | 10 | 0.3 | 100 | 270 | 60 | 0.8 | 600 | 180 | False |
| 120 cm UV Phaser Battery | 120cmUVPhaserBattery | Project_60cmUVPhaserBattery | TwoHullHoriz | 3 | 155 | 10 | 0.3 | 150 | 270 | 120 | 1.6 | 700 | 180 | False |
| 360 cm UV Phaser Battery | 360cmUVPhaserBattery | Project_60cmUVPhaserBattery | FourHull | 4 | 315 | 10 | 0.3 | 250 | 270 | 360 | 3.2 | 850 | 180 | False |
| 240 cm UV Phaser Cannon | 240cmUVPhaserCannon | Project_240cmUVPhaserCannon | OneNose | 4 | 235 | 10 | 0.3 | 200 | 270 | 240 | 2.4 | 800 | 45 | False |
| 480 cm UV Phaser Cannon | 480cmUVPhaserCannon | Project_240cmUVPhaserCannon | TwoNoseVert | 5 | 395 | 10 | 0.3 | 300 | 270 | 480 | 4 | 900 | 45 | False |
| 720 cm UV Phaser Cannon | 720cmUVPhaserCannon | Project_240cmUVPhaserCannon | ThreeNoseAngle | 6 | 555 | 10 | 0.3 | 350 | 270 | 720 | 5.6 | 950 | 45 | False |
| 960 cm UV Phaser Cannon | 960cmUVPhaserCannon | Project_240cmUVPhaserCannon | FourNose | 8 | 715 | 10 | 0.3 | 400 | 270 | 960 | 8 | 1000 | 45 | False |
| Alien Point Defense Laser Turret | AlienPointDefenseLaserTurret | Project_AlienMasterProject | OneHull |  | 21 | 2.4 | 0.35 | 64 | 810 | 32 | 0 | 350 | 180 | False |
| Alien 64 cm Orange Laser Battery | Alien64cmOrangeLaserBattery | Project_AlienMasterProject | OneHull |  | 118 | 16 | 0.35 | 128 | 630 | 64 | 0.8 | 700 | 180 | False |
| Alien 128 cm Orange Laser Battery | Alien128cmOrangeLaserBattery | Project_AlienMasterProject | TwoHullHoriz |  | 160 | 16 | 0.35 | 192 | 630 | 128 | 1.6 | 800 | 180 | False |
| Alien 384 cm Orange Laser Battery | Alien384cmOrangeLaserBattery | Project_AlienMasterProject | FourHull |  | 331 | 16 | 0.35 | 240 | 630 | 384 | 3.2 | 900 | 180 | False |
| Alien 256 cm Orange Laser Cannon | Alien256cmOrangeLaserCannon | Project_AlienMasterProject | OneNose |  | 246 | 24 | 0.35 | 192 | 630 | 256 | 2.4 | 800 | 45 | False |
| Alien 512 cm Orange Laser Cannon | Alien512cmOrangeLaserCannon | Project_AlienMasterProject | TwoNoseVert |  | 416 | 24 | 0.35 | 256 | 630 | 512 | 4 | 900 | 45 | False |
| Alien 768 cm Orange Laser Cannon | Alien768cmOrangeLaserCannon | Project_AlienMasterProject | ThreeNoseAngle |  | 587 | 24 | 0.35 | 384 | 630 | 768 | 5.6 | 1000 | 45 | False |
| Alien 1024 cm Orange Laser Cannon | Alien1024cmOrangeLaserCannon | Project_AlienMasterProject | FourNose |  | 758 | 24 | 0.35 | 448 | 630 | 1024 | 8 | 1000 | 45 | False |
| Alien 64 cm Violet Laser Battery | Alien64cmVioletLaserBattery | Project_AlienMasterProject | OneHull |  | 118 | 12 | 0.5 | 128 | 450 | 64 | 0.8 | 800 | 180 | False |
| Alien 128 cm Violet Laser Battery | Alien128cmVioletLaserBattery | Project_AlienMasterProject | TwoHullHoriz |  | 160 | 12 | 0.5 | 192 | 450 | 128 | 1.6 | 900 | 180 | False |
| Alien 384 cm Violet Laser Battery | Alien384cmVioletLaserBattery | Project_AlienMasterProject | FourHull |  | 331 | 12 | 0.5 | 240 | 450 | 384 | 3.2 | 1000 | 180 | False |
| Alien 256 cm Violet Laser Cannon | Alien256cmVioletLaserCannon | Project_AlienMasterProject | OneNose |  | 246 | 18 | 0.5 | 192 | 450 | 256 | 2.4 | 800 | 45 | False |
| Alien 512 cm Violet Laser Cannon | Alien512cmVioletLaserCannon | Project_AlienMasterProject | TwoNoseVert |  | 416 | 18 | 0.5 | 256 | 450 | 512 | 4 | 900 | 45 | False |
| Alien 768 cm Violet Laser Cannon | Alien768cmVioletLaserCannon | Project_AlienMasterProject | ThreeNoseAngle |  | 587 | 18 | 0.5 | 384 | 450 | 768 | 5.6 | 1000 | 45 | False |
| Alien 1024 cm Violet Laser Cannon | Alien1024cmVioletLaserCannon | Project_AlienMasterProject | FourNose |  | 758 | 18 | 0.5 | 448 | 450 | 1024 | 8 | 1000 | 45 | False |
| Alien 384 cm Xaser Battery | Alien384cmXaserBattery | Project_AlienAdvancedMasterProject | FourHull |  | 440 | 24 | 0.4 | 240 | 10 | 384 | 4.5 | 900 | 180 | False |
| Alien 256 cm Xaser Cannon | Alien256cmXaserCannon | Project_AlienAdvancedMasterProject | OneNose |  | 333 | 24 | 0.4 | 192 | 10 | 256 | 4 | 900 | 45 | False |
| Alien 512 cm Xaser Cannon | Alien512cmXaserCannon | Project_AlienAdvancedMasterProject | TwoNoseVert |  | 547 | 24 | 0.4 | 256 | 10 | 512 | 5 | 1000 | 45 | False |
| Alien 768 cm Xaser Cannon | Alien768cmXaserCannon | Project_AlienAdvancedMasterProject | ThreeNoseAngle |  | 760 | 24 | 0.4 | 384 | 10 | 768 | 6 | 1000 | 45 | False |
| Alien 1024 cm Xaser Cannon | Alien1024cmXaserCannon | Project_AlienAdvancedMasterProject | FourNose |  | 973 | 24 | 0.4 | 448 | 10 | 1024 | 8 | 1000 | 45 | False |
| Alien 768 cm Graser Cannon | Alien768cmGraserCannon | Project_AlienAdvancedMasterProject | ThreeNoseAngle |  | 1400 | 36 | 0.3 | 384 | 0.1 | 768 | 8 | 1000 | 45 | False |
| Alien 1024 cm Graser Cannon | Alien1024cmGraserCannon | Project_AlienAdvancedMasterProject | FourNose |  | 1827 | 36 | 0.3 | 448 | 0.1 | 1024 | 12 | 1000 | 45 | False |
| Region Defense IR Laser | RegionDefenseIRLaser |  | RegionDefense |  |  | 30 |  | 1000 | 810 | 3600 | 1.1 | 2000 | 180 | False |
| Region Defense Green Laser | RegionDefenseGreenLaser |  | RegionDefense |  |  | 30 |  | 1000 | 540 | 3600 | 1.2 | 2000 | 180 | False |
| Region Defense IR Arc Laser | RegionDefenseIRArcLaser |  | RegionDefense |  |  | 30 |  | 1000 | 810 | 3600 | 2.1 | 2000 | 180 | False |
| Region Defense Green Arc Laser | RegionDefenseGreenArcLaser |  | RegionDefense |  |  | 30 |  | 1000 | 540 | 3600 | 2.2 | 2000 | 180 | False |
| Region Defense IR Phaser | RegionDefenseIRPhaser |  | RegionDefense |  |  | 30 |  | 1000 | 810 | 3600 | 3.1 | 2000 | 180 | False |
| Region Defense Green Phaser | RegionDefenseGreenPhaser |  | RegionDefense |  |  | 30 |  | 1000 | 540 | 3600 | 3.2 | 2000 | 180 | False |
| T1 Base IR Laser | T1BaseIRLaser |  | T1BaseDefense |  |  | 900 |  | 500 | 810 | 960 | 1.1 | 2000 | 180 | False |
| T1 Base Green Laser | T1BaseGreenLaser |  | T1BaseDefense |  |  | 900 |  | 500 | 540 | 960 | 1.2 | 2000 | 180 | False |
| T1 Base UV Laser | T1BaseUVLaser |  | T1BaseDefense |  |  | 900 |  | 500 | 270 | 960 | 1.3 | 2000 | 180 | False |
| T1 Base IR Arc Laser | T1BaseIRArcLaser |  | T1BaseDefense |  |  | 900 |  | 500 | 810 | 960 | 2.1 | 2000 | 180 | False |
| T1 Base Green Arc Laser | T1BaseGreenArcLaser |  | T1BaseDefense |  |  | 900 |  | 500 | 540 | 960 | 2.2 | 2000 | 180 | False |
| T1 Base UV Arc Laser | T1BaseUVArcLaser |  | T1BaseDefense |  |  | 900 |  | 500 | 270 | 960 | 2.3 | 2000 | 180 | False |
| T1 Base IR Phaser | T1BaseIRPhaser |  | T1BaseDefense |  |  | 900 |  | 500 | 810 | 960 | 3.1 | 2000 | 180 | False |
| T1 Base Green Phaser | T1BaseGreenPhaser |  | T1BaseDefense |  |  | 900 |  | 500 | 540 | 960 | 3.2 | 2000 | 180 | False |
| T1 Base UV Phaser | T1BaseUVPhaser |  | T1BaseDefense |  |  | 900 |  | 500 | 270 | 960 | 3.3 | 2000 | 180 | False |
| T2 Base IR Laser | T2BaseIRLaser |  | T2BaseDefense |  |  | 900 |  | 650 | 810 | 1440 | 1.1 | 2000 | 180 | False |
| T2 Base Green Laser | T2BaseGreenLaser |  | T2BaseDefense |  |  | 900 |  | 650 | 540 | 1440 | 1.2 | 2000 | 180 | False |
| T2 Base UV Laser | T2BaseUVLaser |  | T2BaseDefense |  |  | 900 |  | 650 | 270 | 1440 | 1.3 | 2000 | 180 | False |
| T2 Base IR Arc Laser | T2BaseIRArcLaser |  | T2BaseDefense |  |  | 900 |  | 650 | 810 | 1440 | 2.1 | 2000 | 180 | False |
| T2 Base Green Arc Laser | T2BaseGreenArcLaser |  | T2BaseDefense |  |  | 900 |  | 650 | 540 | 1440 | 2.2 | 2000 | 180 | False |
| T2 Base UV Arc Laser | T2BaseUVArcLaser |  | T2BaseDefense |  |  | 900 |  | 650 | 270 | 1440 | 2.3 | 2000 | 180 | False |
| T2 Base IR Phaser | T2BaseIRPhaser |  | T2BaseDefense |  |  | 900 |  | 650 | 810 | 1440 | 3.1 | 2000 | 180 | False |
| T2 Base Green Phaser | T2BaseGreenPhaser |  | T2BaseDefense |  |  | 900 |  | 650 | 540 | 1440 | 3.2 | 2000 | 180 | False |
| T2 Base UV Phaser | T2BaseUVPhaser |  | T2BaseDefense |  |  | 900 |  | 650 | 270 | 1440 | 3.3 | 2000 | 180 | False |
| T3 Base IR Laser | T3BaseIRLaser |  | T3BaseDefense |  |  | 900 |  | 800 | 810 | 1920 | 1.1 | 2000 | 180 | False |
| T3 Base Green Laser | T3BaseGreenLaser |  | T3BaseDefense |  |  | 900 |  | 800 | 540 | 1920 | 1.2 | 2000 | 180 | False |
| T3 Base UV Laser | T3BaseUVLaser |  | T3BaseDefense |  |  | 900 |  | 800 | 270 | 1920 | 1.3 | 2000 | 180 | False |
| T3 Base IR Arc Laser | T3BaseIRArcLaser |  | T3BaseDefense |  |  | 900 |  | 800 | 810 | 1920 | 2.1 | 2000 | 180 | False |
| T3 Base Green Arc Laser | T3BaseGreenArcLaser |  | T3BaseDefense |  |  | 900 |  | 800 | 540 | 1920 | 2.2 | 2000 | 180 | False |
| T3 Base UV Arc Laser | T3BaseUVArcLaser |  | T3BaseDefense |  |  | 900 |  | 800 | 270 | 1920 | 2.3 | 2000 | 180 | False |
| T3 Base IR Phaser | T3BaseIRPhaser |  | T3BaseDefense |  |  | 900 |  | 800 | 810 | 1920 | 3.1 | 2000 | 180 | False |
| T3 Base Green Phaser | T3BaseGreenPhaser |  | T3BaseDefense |  |  | 900 |  | 800 | 540 | 1920 | 3.2 | 2000 | 180 | False |
| T3 Base UV Phaser | T3BaseUVPhaser |  | T3BaseDefense |  |  | 900 |  | 800 | 270 | 1920 | 3.3 | 2000 | 180 | False |
| Alien Region Defense Laser | AlienRegionDefenseLaser | Project_AlienMasterProject | RegionDefense |  |  | 900 | 0.5 | 1024 | 450 | 4096 | 9.9 | 2000 | 180 | False |
| Alien T1 Base Defense Laser | AlienT1BaseDefenseLaser | Project_AlienMasterProject | T1BaseDefense |  |  | 900 | 0.5 | 512 | 450 | 1024 | 9.9 | 2000 | 180 | False |
| Alien T2 Base Defense Laser | AlienT2BaseDefenseLaser | Project_AlienMasterProject | T2BaseDefense |  |  | 900 | 0.5 | 684 | 450 | 2048 | 9.9 | 2000 | 180 | False |
| Alien T3 Base Defense Laser | AlienT3BaseDefenseLaser | Project_AlienMasterProject | T3BaseDefense |  |  | 900 | 0.5 | 768 | 450 | 3072 | 9.9 | 2000 | 180 | False |

## Magnetic Guns

| Component | Template ID | Required Project | Mount | Crew | Weapon Mass (t) | Cooldown (s) | Eff. | Magazine | Ammo Mass (kg) | Muzzle Vel. (km/s) | Projectile (kg) | Bombard | Range (km) | Pivot (deg) | PD Target? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Light Railgun Battery Mk1 | LightRailgunBatteryMk1 | Project_RailgunBatteryMk1 | OneHull | 3 | 50 | 30 | 0.25 | 1000 | 12 | 3 | 9 | 1 | 500 | 180 | True |
| Light Railgun Battery Mk2 | LightRailgunBatteryMk2 | Project_RailgunBatteryMk2 | OneHull | 3 | 45 | 20 | 0.3 | 1000 | 12 | 3.3 | 9.6 | 2 | 550 | 180 | True |
| Light Railgun Battery Mk3 | LightRailgunBatteryMk3 | Project_RailgunBatteryMk3 | OneHull | 3 | 40 | 10 | 0.35 | 1000 | 12 | 3.6 | 10.5 | 3 | 600 | 180 | True |
| Railgun Battery Mk1 | RailgunBatteryMk1 | Project_RailgunBatteryMk1 | TwoHullHoriz | 4 | 100 | 30 | 0.25 | 1200 | 24 | 3.3 | 18 | 2 | 650 | 180 | True |
| Railgun Battery Mk2 | RailgunBatteryMk2 | Project_RailgunBatteryMk2 | TwoHullHoriz | 4 | 90 | 20 | 0.3 | 1200 | 24 | 3.6 | 19.2 | 3 | 700 | 180 | True |
| Railgun Battery Mk3 | RailgunBatteryMk3 | Project_RailgunBatteryMk3 | TwoHullHoriz | 4 | 80 | 10 | 0.35 | 1200 | 24 | 4.32 | 21 | 4 | 750 | 180 | True |
| Heavy Railgun Battery Mk1 | HeavyRailgunBatteryMk1 | Project_RailgunBatteryMk1 | FourHull | 5 | 200 | 30 | 0.25 | 1440 | 48 | 3.6 | 36 | 3 | 800 | 180 | True |
| Heavy Railgun Battery Mk2 | HeavyRailgunBatteryMk2 | Project_RailgunBatteryMk2 | FourHull | 5 | 180 | 20 | 0.3 | 1440 | 48 | 4.32 | 38.4 | 4 | 850 | 180 | True |
| Heavy Railgun Battery Mk3 | HeavyRailgunBatteryMk3 | Project_RailgunBatteryMk3 | FourHull | 5 | 160 | 10 | 0.35 | 1440 | 48 | 5.18 | 42 | 5 | 900 | 180 | True |
| Light Rail Cannon Mk1 | LightRailCannonMk1 | Project_RailCannonMk1 | OneNose | 4 | 60 | 45 | 0.25 | 200 | 30 | 3.6 | 22.5 | 2 | 550 | 30 | True |
| Light Rail Cannon Mk2 | LightRailCannonMk2 | Project_RailCannonMk2 | OneNose | 4 | 55 | 30 | 0.3 | 200 | 30 | 4.32 | 24 | 3 | 600 | 30 | True |
| Light Rail Cannon Mk3 | LightRailCannonMk3 | Project_RailCannonMk3 | OneNose | 4 | 50 | 15 | 0.35 | 200 | 30 | 5.18 | 26.25 | 4 | 650 | 30 | True |
| Rail Cannon Mk1 | RailCannonMk1 | Project_RailCannonMk1 | TwoNoseVert | 5 | 120 | 45 | 0.25 | 240 | 60 | 4.32 | 45 | 3 | 700 | 30 | True |
| Rail Cannon Mk2 | RailCannonMk2 | Project_RailCannonMk2 | TwoNoseVert | 5 | 110 | 30 | 0.3 | 240 | 60 | 5.18 | 48 | 4 | 750 | 30 | True |
| Rail Cannon Mk3 | RailCannonMk3 | Project_RailCannonMk3 | TwoNoseVert | 5 | 100 | 15 | 0.35 | 240 | 60 | 6.48 | 52.5 | 5 | 800 | 30 | True |
| Heavy Rail Cannon Mk1 | HeavyRailCannonMk1 | Project_RailCannonMk1 | ThreeNoseAngle | 6 | 180 | 45 | 0.25 | 240 | 90 | 4.75 | 67.5 | 3 | 800 | 30 | True |
| Heavy Rail Cannon Mk2 | HeavyRailCannonMk2 | Project_RailCannonMk2 | ThreeNoseAngle | 6 | 165 | 30 | 0.3 | 240 | 90 | 5.83 | 72 | 4 | 850 | 30 | True |
| Heavy Rail Cannon Mk3 | HeavyRailCannonMk3 | Project_RailCannonMk3 | ThreeNoseAngle | 6 | 150 | 15 | 0.35 | 240 | 90 | 7.125 | 78.75 | 5 | 900 | 30 | True |
| Spinal Railgun Mk1 | SpinalRailgunMk1 | Project_RailCannonMk1 | FourNose | 6 | 240 | 45 | 0.25 | 300 | 120 | 5.18 | 90 | 4 | 900 | 30 | True |
| Spinal Railgun Mk2 | SpinalRailgunMk2 | Project_RailCannonMk2 | FourNose | 6 | 220 | 30 | 0.3 | 300 | 120 | 6.48 | 96 | 5 | 950 | 30 | True |
| Spinal Railgun Mk3 | SpinalRailgunMk3 | Project_RailCannonMk3 | FourNose | 6 | 200 | 15 | 0.35 | 300 | 120 | 7.77 | 105 | 6 | 1000 | 30 | True |
| Light Coilgun Battery Mk1 | LightCoilgunBatteryMk1 | Project_CoilgunBatteryMk1 | OneHull | 3 | 50 | 40 | 0.5 | 1500 | 10 | 4.5 | 7.5 | 2 | 500 | 180 | True |
| Light Coilgun Battery Mk2 | LightCoilgunBatteryMk2 | Project_CoilgunBatteryMk2 | OneHull | 3 | 45 | 30 | 0.6 | 1500 | 10 | 5.4 | 8 | 3 | 550 | 180 | True |
| Light Coilgun Battery Mk3 | LightCoilgunBatteryMk3 | Project_CoilgunBatteryMk3 | OneHull | 3 | 40 | 20 | 0.7 | 1500 | 10 | 6.3 | 8.75 | 4 | 600 | 180 | True |
| Coilgun Battery Mk1 | CoilgunBatteryMk1 | Project_CoilgunBatteryMk1 | TwoHullHoriz | 4 | 100 | 40 | 0.5 | 1800 | 20 | 5.4 | 15 | 3 | 650 | 180 | True |
| Coilgun Battery Mk2 | CoilgunBatteryMk2 | Project_CoilgunBatteryMk2 | TwoHullHoriz | 4 | 90 | 30 | 0.6 | 1800 | 20 | 6.3 | 16 | 4 | 700 | 180 | True |
| Coilgun Battery Mk3 | CoilgunBatteryMk3 | Project_CoilgunBatteryMk3 | TwoHullHoriz | 4 | 80 | 20 | 0.7 | 1800 | 20 | 7.2 | 17.5 | 5 | 750 | 180 | True |
| Heavy Coilgun Battery Mk1 | HeavyCoilgunBatteryMk1 | Project_CoilgunBatteryMk1 | FourHull | 5 | 200 | 40 | 0.5 | 2160 | 40 | 6.3 | 30 | 4 | 800 | 180 | True |
| Heavy Coilgun Battery Mk2 | HeavyCoilgunBatteryMk2 | Project_CoilgunBatteryMk2 | FourHull | 5 | 180 | 30 | 0.6 | 2160 | 40 | 7.2 | 32 | 5 | 850 | 180 | True |
| Heavy Coilgun Battery Mk3 | HeavyCoilgunBatteryMk3 | Project_CoilgunBatteryMk3 | FourHull | 5 | 160 | 20 | 0.7 | 2160 | 40 | 8.1 | 35 | 6 | 900 | 180 | True |
| Light Coil Cannon Mk1 | LightCoilCannonMk1 | Project_CoilCannonMk1 | OneNose | 4 | 60 | 48 | 0.5 | 300 | 25 | 5.4 | 18.75 | 3 | 550 | 30 | True |
| Light Coil Cannon Mk2 | LightCoilCannonMk2 | Project_CoilCannonMk2 | OneNose | 4 | 55 | 36 | 0.6 | 300 | 25 | 6.3 | 20 | 4 | 600 | 30 | True |
| Light Coil Cannon Mk3 | LightCoilCannonMk3 | Project_CoilCannonMk3 | OneNose | 4 | 50 | 24 | 0.7 | 300 | 25 | 8.1 | 21.875 | 5 | 650 | 30 | True |
| Coil Cannon Mk1 | CoilCannonMk1 | Project_CoilCannonMk1 | TwoNoseVert | 5 | 120 | 48 | 0.5 | 360 | 50 | 6.3 | 37.5 | 4 | 700 | 30 | True |
| Coil Cannon Mk2 | CoilCannonMk2 | Project_CoilCannonMk2 | TwoNoseVert | 5 | 110 | 36 | 0.6 | 360 | 50 | 7.2 | 40 | 5 | 750 | 30 | True |
| Coil Cannon Mk3 | CoilCannonMk3 | Project_CoilCannonMk3 | TwoNoseVert | 5 | 100 | 24 | 0.7 | 360 | 50 | 9 | 43.75 | 6 | 800 | 30 | True |
| Heavy Coil Cannon Mk1 | HeavyCoilCannonMk1 | Project_CoilCannonMk1 | ThreeNoseAngle | 6 | 180 | 48 | 0.5 | 360 | 75 | 6.8 | 56.25 | 5 | 800 | 30 | True |
| Heavy Coil Cannon Mk2 | HeavyCoilCannonMk2 | Project_CoilCannonMk2 | ThreeNoseAngle | 6 | 165 | 36 | 0.6 | 360 | 75 | 7.7 | 60 | 5 | 850 | 30 | True |
| Heavy Coil Cannon Mk3 | HeavyCoilCannonMk3 | Project_CoilCannonMk3 | ThreeNoseAngle | 6 | 150 | 24 | 0.7 | 360 | 75 | 9.5 | 65.625 | 6 | 900 | 30 | True |
| Spinal Coiler Mk1 | SpinalCoilerMk1 | Project_CoilCannonMk1 | FourNose | 6 | 240 | 48 | 0.5 | 450 | 100 | 7.2 | 75 | 5 | 900 | 30 | True |
| Spinal Coiler Mk2 | SpinalCoilerMk2 | Project_CoilCannonMk2 | FourNose | 6 | 220 | 36 | 0.6 | 450 | 100 | 8.1 | 80 | 6 | 950 | 30 | True |
| Spinal Coiler Mk3 | SpinalCoilerMk3 | Project_CoilCannonMk3 | FourNose | 6 | 200 | 24 | 0.7 | 450 | 100 | 9.9 | 87.5 | 7 | 1000 | 30 | True |
| Heavy Siege Coiler Mk1 | HeavySiegeCoilerMk1 | Project_CoilCannonMk1 | ThreeNoseAngle | 6 | 1000 | 48 | 0.5 | 100 | 750 | 3.4 | 562.5 | 6 | 800 | 20 | True |
| Heavy Siege Coiler Mk2 | HeavySiegeCoilerMk2 | Project_CoilCannonMk2 | ThreeNoseAngle | 6 | 1000 | 36 | 0.6 | 100 | 750 | 3.8 | 600 | 7 | 850 | 20 | True |
| Heavy Siege Coiler Mk3 | HeavySiegeCoilerMk3 | Project_CoilCannonMk3 | ThreeNoseAngle | 6 | 1000 | 24 | 0.7 | 100 | 750 | 4.7 | 656.25 | 8 | 900 | 20 | True |
| Spinal Siege Coiler Mk1 | SpinalSiegeCoilerMk1 | Project_CoilCannonMk1 | FourNose | 6 | 1500 | 48 | 0.5 | 120 | 1000 | 3.6 | 750 | 7 | 900 | 20 | True |
| Spinal Siege Coiler Mk2 | SpinalSiegeCoilerMk2 | Project_CoilCannonMk2 | FourNose | 6 | 1500 | 36 | 0.6 | 120 | 1000 | 4.1 | 800 | 8 | 950 | 20 | True |
| Spinal Siege Coiler Mk3 | SpinalSiegeCoilerMk3 | Project_CoilCannonMk3 | FourNose | 6 | 1500 | 24 | 0.7 | 120 | 1000 | 5 | 875 | 9 | 1000 | 20 | True |
| Alien Light Mag Battery | AlienLightMagBattery | Project_AlienMasterProject | OneHull | 1 | 40 | 15 | 0.6 | 1500 | 15 | 3.2 | 12.75 | 2 | 550 | 180 | True |
| Alien Mag Battery | AlienMagBattery | Project_AlienMasterProject | TwoHullHoriz | 2 | 80 | 18 | 0.6 | 1800 | 30 | 4 | 25.5 | 3 | 700 | 180 | True |
| Alien Heavy Mag Battery | AlienHeavyMagBattery | Project_AlienMasterProject | FourHull | 3 | 160 | 21.6 | 0.6 | 2160 | 60 | 4.8 | 51 | 4 | 850 | 180 | True |
| Alien Mini Light Mag Cannon | AlienMiniLightMagCannon | Project_AlienMasterProject | HalfNose | 0 | 10 | 25 | 0.6 | 100 | 40 | 4.2 | 34 | 3 | 600 | 20 | True |
| Alien Light Mag Cannon | AlienLightMagCannon | Project_AlienMasterProject | OneNose | 1 | 50 | 25 | 0.6 | 300 | 40 | 4.2 | 34 | 3 | 600 | 30 | True |
| Alien Mag Cannon | AlienMagCannon | Project_AlienMasterProject | TwoNoseVert | 2 | 100 | 30 | 0.6 | 360 | 80 | 5.12 | 68 | 4 | 750 | 30 | True |
| Alien Heavy Mag Cannon | AlienHeavyMagCannon | Project_AlienMasterProject | ThreeNoseAngle | 2 | 150 | 45 | 0.6 | 400 | 120 | 6.4 | 102 | 4 | 850 | 30 | True |
| Alien Spinal Mag Cannon | AlienSpinalMagCannon | Project_AlienMasterProject | FourNose | 3 | 200 | 60 | 0.6 | 450 | 160 | 7.68 | 136 | 5 | 950 | 30 | True |
| Advanced Alien Light Mag Battery | AdvancedAlienLightMagBattery | Project_AlienMasterProject | OneHull | 1 | 40 | 10 | 0.7 | 1500 | 15 | 4.8 | 13.5 | 3 | 600 | 180 | True |
| Advanced Alien Mag Battery | AdvancedAlienMagBattery | Project_AlienMasterProject | TwoHullHoriz | 2 | 80 | 12 | 0.7 | 1800 | 30 | 6 | 27 | 4 | 750 | 180 | True |
| Advanced Alien Heavy Mag Battery | AdvancedAlienHeavyMagBattery | Project_AlienMasterProject | FourHull | 3 | 160 | 14.4 | 0.7 | 2160 | 60 | 7.2 | 54 | 5 | 900 | 180 | True |
| Advanced Alien Light Mag Cannon | AdvancedAlienLightMagCannon | Project_AlienMasterProject | OneNose | 1 | 50 | 20 | 0.7 | 300 | 40 | 6.3 | 36 | 4 | 650 | 30 | True |
| Advanced Alien Mag Cannon | AdvancedAlienMagCannon | Project_AlienMasterProject | TwoNoseVert | 2 | 100 | 24 | 0.7 | 360 | 80 | 7.68 | 72 | 5 | 800 | 30 | True |
| Advanced Alien Heavy Mag Cannon | AdvancedAlienHeavyMagCannon | Project_AlienMasterProject | ThreeNoseAngle | 2 | 150 | 36 | 0.7 | 400 | 120 | 9.6 | 108 | 5 | 900 | 30 | True |
| Advanced Alien Spinal Mag Cannon | AdvancedAlienSpinalMagCannon | Project_AlienMasterProject | FourNose | 3 | 200 | 48 | 0.7 | 450 | 160 | 11.52 | 144 | 6 | 1000 | 30 | True |
| Gen3 Alien Light Mag Battery | Gen3AlienLightMagBattery | Project_AlienAdvancedMasterProject | OneHull | 1 | 40 | 10 | 0.8 | 1500 | 27.6 | 6.3 | 24 | 4 | 650 | 180 | True |
| Gen3 Alien Mag Battery | Gen3AlienMagBattery | Project_AlienAdvancedMasterProject | TwoHullHoriz | 2 | 80 | 12 | 0.8 | 1800 | 55 | 7.9 | 48 | 5 | 750 | 180 | True |
| Gen3 Alien Heavy Mag Battery | Gen3AlienHeavyMagBattery | Project_AlienAdvancedMasterProject | FourHull | 3 | 160 | 14.4 | 0.8 | 2160 | 110 | 9.5 | 96 | 6 | 900 | 180 | True |
| Gen3 Alien Light Mag Cannon | Gen3AlienLightMagCannon | Project_AlienAdvancedMasterProject | OneNose | 1 | 50 | 12 | 0.8 | 300 | 74 | 8.3 | 64 | 5 | 800 | 30 | True |
| Gen3 Alien Mag Cannon | Gen3AlienMagCannon | Project_AlienAdvancedMasterProject | TwoNoseVert | 2 | 100 | 16 | 0.8 | 360 | 147 | 10.1 | 128 | 6 | 900 | 30 | True |
| Gen3 Alien Heavy Mag Cannon | Gen3AlienHeavyMagCannon | Project_AlienAdvancedMasterProject | ThreeNoseAngle | 2 | 150 | 24 | 0.8 | 400 | 294 | 12.7 | 256 | 7 | 1000 | 30 | True |
| Gen3 Alien Spinal Mag Cannon | Gen3AlienSpinalMagCannon | Project_AlienAdvancedMasterProject | FourNose | 3 | 200 | 36 | 0.8 | 450 | 589 | 15.2 | 512 | 8 | 1000 | 30 | True |

## Missile Bays

| Component | Template ID | Required Project | Mount | Crew | Warhead | Weapon Mass (t) | Salvo | Magazine | Rocket Thrust | Exhaust Vel. (km/s) | Accel (g) | Δv (km/s) | Missile Mass (kg) | Fuel (kg) | System (kg) | Warhead (kg) | Damage (MJ) | Range (km) | Pivot (deg) | PD Target? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Krait Missile Bay | KraitMissileBay | Project_Warships | OneHull | 3 | Explosive | 15 | 6 | 12 | 69954 | 2.86 | 4.46 | 3.33 | 1600 | 1100 | 300 | 200 | 240 | 800 | 180 | True |
| Anaconda Missile Bay | AnacondaMissileBay | Project_AnacondaMissileBay | OneHull | 3 | Explosive | 10 | 8 | 16 | 234560 | 3.23 | 14.94 | 3.76 | 1600 | 1100 | 300 | 200 | 360 | 800 | 180 | True |
| Cobra Missile Bay | CobraMissileBay | Project_AnacondaMissileBay | OneHull | 3 | Explosive | 10 | 8 | 16 | 234560 | 3.23 | 14.94 | 3.45 | 1600 | 1050 | 300 | 250 | 450 | 800 | 180 | True |
| Racer Missile Bay | RacerMissileBay | Project_RattlerMissileBay | OneHull | 2 | Fragmentation | 10 | 6 | 36 | 117280 | 3.23 | 29.89 | 2.67 | 400 | 225 | 150 | 25 |  | 500 | 180 | True |
| Rattler Missile Bay | RattlerMissileBay | Project_RattlerMissileBay | OneHull | 2 | Fragmentation | 5 | 8 | 16 | 234560 | 3.23 | 14.94 | 4.48 | 1600 | 1200 | 350 | 50 |  | 800 | 180 | True |
| Riverjack Missile Bay | RiverjackMissileBay | Project_RattlerMissileBay | OneHull | 2 | Fragmentation | 5 | 8 | 16 | 234560 | 3.23 | 14.94 | 4.1 | 1600 | 1150 | 350 | 100 |  | 800 | 180 | True |
| Harlequin Missile Bay | HarlequinMissileBay | Project_HarlequinMissileBay | OneHull | 2 | Penetrator | 5 | 8 | 16 | 234560 | 3.23 | 14.94 | 4.48 | 1600 | 1200 | 350 | 50 |  | 800 | 180 | True |
| Keelback Missile Bay | KeelbackMissileBay | Project_HarlequinMissileBay | OneHull | 2 | Penetrator | 5 | 8 | 16 | 234560 | 3.23 | 14.94 | 4.1 | 1600 | 1150 | 350 | 100 |  | 800 | 180 | True |
| Copperhead Missile Bay | CopperheadMissileBay | Project_CopperheadMissileBay | OneHull | 3 | Explosive | 15 | 8 | 16 | 286810 | 4.45 | 18.27 | 3.68 | 1600 | 900 | 400 | 300 | 720 | 800 | 180 | True |
| Viper Missile Bay | ViperMissileBay | Project_ViperMissileBay | OneHull | 2 | Fragmentation | 10 | 8 | 16 | 286810 | 4.45 | 18.27 | 5.64 | 1600 | 1150 | 400 | 50 |  | 800 | 180 | True |
| Lancehead Missile Bay | LanceheadMissileBay | Project_LanceheadMissileBay | OneHull | 2 | Penetrator | 10 | 8 | 16 | 286810 | 4.45 | 18.27 | 4.36 | 1600 | 1000 | 400 | 200 |  | 800 | 180 | True |
| Python Nuclear Missile Bay | PythonNuclearMissileBay | Project_HadesNuclearTorpedoBay | OneHull | 6 | Nuclear | 15 | 4 | 8 | 286810 | 4.45 | 18.27 | 4.01 | 1600 | 950 | 400 | 250 | 188325000 | 800 | 180 | True |
| Sidewinder Nuclear Missile Bay | SidewinderNuclearMissileBay | Project_AcheronNuclearTorpedoBay | OneHull | 6 | ShapedNuclear | 15 | 4 | 8 | 286810 | 4.45 | 18.27 | 3.37 | 1600 | 850 | 450 | 300 | 418500000 | 800 | 180 | True |
| Hera Torpedo Bay | HeraTorpedoBay | Project_AnacondaMissileBay | OneHull | 3 | Explosive | 10 |  | 6 | 351840 | 3.23 | 7.47 | 6.22 | 4800 | 4100 | 400 | 300 | 540 | 1000 | 180 | True |
| Hermes Torpedo Bay | HermesTorpedoBay | Project_HarlequinMissileBay | OneHull | 2 | Penetrator | 5 |  | 6 | 351840 | 3.23 | 7.47 | 4.62 | 4800 | 3650 | 400 | 750 |  | 1000 | 180 | True |
| Artemis Torpedo Bay | ArtemisTorpedoBay | Project_CopperheadMissileBay | OneHull | 3 | Explosive | 15 |  | 6 | 430215 | 4.45 | 9.14 | 7.97 | 4800 | 4000 | 400 | 400 | 960 | 1000 | 180 | True |
| Vulcan Torpedo Bay | VulcanTorpedoBay | Project_LanceheadMissileBay | OneHull | 2 | Penetrator | 10 |  | 6 | 430215 | 4.45 | 9.14 | 5.99 | 4800 | 3550 | 400 | 850 |  | 1000 | 180 | True |
| Athena Torpedo Bay | AthenaTorpedoBay | Project_AthenaTorpedoBay | OneHull | 3 | Explosive | 15 |  | 6 | 230300 | 8.18 | 4.89 | 12.83 | 4800 | 3800 | 400 | 600 | 1800 | 1000 | 180 | True |
| Ares Torpedo Bay | AresTorpedoBay | Project_AresTorpedoBay | OneHull | 2 | Penetrator | 10 |  | 6 | 230300 | 8.18 | 4.89 | 8.99 | 4800 | 3200 | 400 | 1200 |  | 1000 | 180 | True |
| Poseidon Torpedo Bay | PoseidonTorpedoBay | Project_AresTorpedoBay | OneHull | 2 | Penetrator | 10 |  | 6 | 230300 | 8.18 | 4.89 | 18.5 | 4800 | 4300 | 400 | 100 |  | 1000 | 180 | True |
| Cerebrus Nuclear Torpedo Bay | CerebrusNuclearTorpedoBay | Project_CerebrusNuclearTorpedoBay | OneHull | 6 | Nuclear | 25 |  | 4 | 351840 | 3.23 | 7.47 | 6.41 | 4800 | 4140 | 400 | 260 | 1129950000 | 1000 | 180 | True |
| Hades Nuclear Torpedo Bay | HadesNuclearTorpedoBay | Project_HadesNuclearTorpedoBay | OneHull | 6 | Nuclear | 20 |  | 4 | 430215 | 4.45 | 9.14 | 7.7 | 4800 | 3950 | 400 | 450 | 2448225000 | 1000 | 180 | True |
| Nemesis Nuclear Torpedo Bay | NemesisNuclearTorpedoBay | Project_NemesisNuclearTorpedoBay | OneHull | 6 | Nuclear | 20 |  | 4 | 230300 | 8.18 | 4.89 | 10.69 | 4800 | 3500 | 400 | 900 | 4519800000 | 1000 | 180 | True |
| Olympus Nuclear Torpedo Bay | OlympusNuclearTorpedoBay | Project_OlympusNuclearTorpedoBay | OneHull | 6 | ShapedNuclear | 20 |  | 4 | 230300 | 8.18 | 4.89 | 10.69 | 4800 | 3500 | 500 | 800 | 4185000000 | 1000 | 180 | True |
| Acheron Nuclear Torpedo Bay | AcheronNuclearTorpedoBay | Project_AcheronNuclearTorpedoBay | OneHull | 6 | ShapedNuclear | 20 |  | 4 | 230300 | 8.18 | 4.89 | 10.08 | 4800 | 3400 | 600 | 800 | 4185000000 | 1000 | 180 | True |
| Tartarus Nuclear Torpedo Bay | TartarusNuclearTorpedoBay | Project_TartarusNuclearTorpedoBay | OneHull | 6 | ShapedNuclear | 20 |  | 4 | 230300 | 8.18 | 4.89 | 9.51 | 4800 | 3300 | 700 | 800 | 4185000000 | 1000 | 180 | True |
| Styx Nuclear Torpedo Bay | StyxNuclearTorpedoBay | Project_StyxNuclearTorpedoBay | OneHull | 6 | ShapedNuclear | 20 |  | 4 | 230300 | 8.18 | 4.89 | 8.99 | 4800 | 3200 | 800 | 800 | 4185000000 | 1000 | 180 | True |
| Antimatter Torpedo Launcher | AntimatterTorpedoLauncher | Project_AntimatterTorpedoLauncher | OneHull | 6 | Antimatter | 50 |  | 4 | 230300 | 8.18 | 4.89 | 14.64 | 4800 | 3998 | 800 | 2 | 22470010000 | 1000 | 180 | True |
| Krait Missile Pod | KraitMissilePod |  | HalfHull | 0 | Explosive | 7 |  | 4 | 69954 | 2.86 | 4.46 | 3.33 | 1600 | 1100 | 300 | 200 | 240 | 800 | 45 | True |
| Anaconda Missile Pod | AnacondaMissilePod | Project_AnacondaMissileBay | HalfHull | 0 | Explosive | 5 |  | 4 | 234560 | 3.23 | 14.94 | 3.76 | 1600 | 1100 | 300 | 200 | 360 | 800 | 45 | True |
| Cobra Missile Pod | CobraMissilePod | Project_AnacondaMissileBay | HalfHull | 0 | Explosive | 5 |  | 4 | 234560 | 3.23 | 14.94 | 3.45 | 1600 | 1050 | 300 | 250 | 450 | 800 | 45 | True |
| Racer Missile Pod | RacerMissilePod | Project_RattlerMissileBay | HalfHull | 0 | Fragmentation | 5 | 6 | 12 | 117280 | 3.23 | 29.89 | 2.67 | 400 | 225 | 150 | 25 |  | 500 | 45 | True |
| Rattler Missile Pod | RattlerMissilePod | Project_RattlerMissileBay | HalfHull | 0 | Fragmentation | 2 |  | 4 | 234560 | 3.23 | 14.94 | 4.48 | 1600 | 1200 | 350 | 50 |  | 800 | 45 | True |
| Riverjack Missile Pod | RiverjackMissilePod | Project_RattlerMissileBay | HalfHull | 0 | Fragmentation | 2 |  | 4 | 234560 | 3.23 | 14.94 | 4.1 | 1600 | 1150 | 350 | 100 |  | 800 | 45 | True |
| Harlequin Missile Pod | HarlequinMissilePod | Project_HarlequinMissileBay | HalfHull | 0 | Penetrator | 2 |  | 4 | 234560 | 3.23 | 14.94 | 4.48 | 1600 | 1200 | 350 | 50 |  | 800 | 45 | True |
| Keelback Missile Pod | KeelbackMissilePod | Project_HarlequinMissileBay | HalfHull | 0 | Penetrator | 2 |  | 4 | 234560 | 3.23 | 14.94 | 4.1 | 1600 | 1150 | 350 | 100 |  | 800 | 45 | True |
| Copperhead Missile Pod | CopperheadMissilePod | Project_CopperheadMissileBay | HalfHull | 0 | Explosive | 7 |  | 4 | 286810 | 4.45 | 18.27 | 3.68 | 1600 | 900 | 400 | 300 | 720 | 800 | 45 | True |
| Viper Missile Pod | ViperMissilePod | Project_ViperMissileBay | HalfHull | 0 | Fragmentation | 5 |  | 4 | 286810 | 4.45 | 18.27 | 5.64 | 1600 | 1150 | 400 | 50 |  | 800 | 45 | True |
| Lancehead Missile Pod | LanceheadMissilePod | Project_LanceheadMissileBay | HalfHull | 0 | Penetrator | 5 |  | 4 | 286810 | 4.45 | 18.27 | 4.36 | 1600 | 1000 | 400 | 200 |  | 800 | 45 | True |
| Python Nuclear Missile Pod | PythonNuclearMissilePod | Project_HadesNuclearTorpedoBay | HalfHull | 0 | Nuclear | 7 |  | 4 | 286810 | 4.45 | 18.27 | 4.01 | 1600 | 950 | 400 | 250 | 188325000 | 800 | 45 | True |
| Hera Torpedo Pod | HeraTorpedoPod | Project_AnacondaMissileBay | HalfHull | 0 | Explosive | 5 |  | 2 | 351840 | 3.23 | 7.47 | 6.22 | 4800 | 4100 | 400 | 300 | 540 | 800 | 45 | True |
| Hermes Torpedo Pod | HermesTorpedoPod | Project_HarlequinMissileBay | HalfHull | 0 | Penetrator | 2 |  | 2 | 351840 | 3.23 | 7.47 | 4.62 | 4800 | 3650 | 400 | 750 |  | 800 | 45 | True |
| Artemis Torpedo Pod | ArtemisTorpedoPod | Project_CopperheadMissileBay | HalfHull | 0 | Explosive | 7 |  | 2 | 430215 | 4.45 | 9.14 | 7.97 | 4800 | 4000 | 400 | 400 | 960 | 800 | 45 | True |
| Vulcan Torpedo Pod | VulcanTorpedoPod | Project_LanceheadMissileBay | HalfHull | 0 | Penetrator | 5 |  | 2 | 430215 | 4.45 | 9.14 | 5.99 | 4800 | 3550 | 400 | 850 |  | 800 | 45 | True |
| Cerebrus Nuclear Torpedo Pod | CerebrusNuclearTorpedoPod | Project_CerebrusNuclearTorpedoBay | HalfHull | 0 | Nuclear | 12 |  | 2 | 351840 | 3.23 | 7.47 | 6.41 | 4800 | 4140 | 400 | 260 | 1129950000 | 800 | 45 | True |
| Hades Nuclear Torpedo Pod | HadesNuclearTorpedoPod | Project_HadesNuclearTorpedoBay | HalfHull | 0 | Nuclear | 10 |  | 2 | 430215 | 4.45 | 9.14 | 7.7 | 4800 | 3950 | 400 | 450 | 2448225000 | 800 | 45 | True |
| Glittering Jewel Missile Bay | GlitteringJewelMissileBay | Project_AlienMasterProject | OneHull | 1 | Penetrator | 3 | 4 | 16 | 300000 | 4.45 | 23.89 | 7.16 | 1280 | 1024 | 128 | 128 |  | 1000 | 180 | True |
| Glittering Jewel Missile Pod | GlitteringJewelMissilePod | Project_AlienMasterProject | HalfHull | 0 | Penetrator | 3 |  | 4 | 300000 | 4.45 | 23.89 | 7.16 | 1280 | 1024 | 128 | 128 |  | 1000 | 180 | True |
| Iridescent Star Torpedo Bay | IridescentStarTorpedoBay | Project_AlienMasterProject | OneHull | 1 | Penetrator | 10 |  | 8 | 290000 | 8.83 | 11.55 | 14.21 | 2560 | 2048 | 256 | 256 |  | 1000 | 180 | True |
| Luminous Swarm Missile Bay | LuminousSwarmMissileBay | Project_AlienMasterProject | OneHull | 1 | Penetrator | 10 | 8 | 36 | 145000 | 4.45 | 41.99 | 5.78 | 352 | 256 | 64 | 32 |  | 600 | 180 | True |
| Brilliant Sky Missile Bay | BrilliantSkyMissileBay | Project_AlienAdvancedMasterProject | OneHull | 1 | Penetrator | 10 | 8 | 16 | 420000 | 16 | 58.17 | 19.03 | 736 | 512 | 128 | 96 |  | 1200 | 180 | True |
| Predatory Star Torpedo Bay | PredatoryStarTorpedoBay | Project_AlienAdvancedMasterProject | OneHull | 1 | Penetrator | 20 |  | 8 | 420000 | 16 | 24.95 | 19.35 | 1716 | 1204 | 256 | 256 |  | 1200 | 180 | True |

## Power Plants

| Component | Template ID | Required Project | Class | Output (GW) | t/GW | Eff. | Crew |
|---|---|---|---|---|---|---|---|
| Fuel Cell I | FuelCellI |  | Fuel_Cell | 0.2 | 2800 | 0.7 | 0 |
| Fuel Cell II | FuelCellII | Project_FuelCellII | Fuel_Cell | 0.8 | 450 | 0.7 | 0 |
| Fuel Cell III | FuelCellIII | Project_FuelCellIII | Fuel_Cell | 1.5 | 120 | 0.72 | 0 |
| Solid Core Fission Reactor I | SolidCoreFissionReactorI | Project_SolidCoreFissionReactorI | Solid_Core_Fission | 2 | 40 | 0.75 | 6 |
| Solid Core Fission Reactor II | SolidCoreFissionReactorII | Project_SolidCoreFissionReactorII | Solid_Core_Fission | 6 | 34 | 0.775 | 6 |
| Solid Core Fission Reactor III | SolidCoreFissionReactorIII | Project_SolidCoreFissionReactorIII | Solid_Core_Fission | 20 | 28 | 0.8 | 6 |
| Solid Core Fission Reactor IV | SolidCoreFissionReactorIV | Project_SolidCoreFissionReactorIV | Solid_Core_Fission | 60 | 12 | 0.825 | 6 |
| Solid Core Fission Reactor V | SolidCoreFissionReactorV | Project_SolidCoreFissionReactorV | Solid_Core_Fission | 125 | 8 | 0.85 | 6 |
| Compact Solid Core Fission Reactor I | SolidCoreFissionReactorVI | Project_SolidCoreFissionReactorVI | Solid_Core_Fission | 1.5 | 6 | 0.775 | 3 |
| Compact Solid Core Fission Reactor II | SolidCoreFissionReactorVII | Project_SolidCoreFissionReactorVII | Solid_Core_Fission | 5 | 5 | 0.8 | 3 |
| Compact Solid Core Fission Reactor III | SolidCoreFissionReactorVIII | Project_SolidCoreFissionReactorVIII | Solid_Core_Fission | 12 | 4 | 0.825 | 3 |
| Compact Solid Core Fission Reactor IV | SolidCoreFissionReactorIX | Project_SolidCoreFissionReactorIX | Solid_Core_Fission | 20 | 3 | 0.85 | 3 |
| Compact Solid Core Fission Reactor V | SolidCoreFissionReactorX | Project_SolidCoreFissionReactorX | Solid_Core_Fission | 20 | 2 | 0.875 | 3 |
| Molten Salt Fission Reactor I | MoltenSaltFissionReactorI | Project_MoltenSaltFissionReactorI | Molten_Salt_Core_Fission | 40 | 2 | 0.92 | 8 |
| Molten Salt Fission Reactor II | MoltenSaltFissionReactorII | Project_MoltenSaltFissionReactorII | Molten_Salt_Core_Fission | 420 | 1.8 | 0.93 | 8 |
| Molten Core Fission Reactor I | MoltenCoreFissionReactorI | Project_MoltenCoreFissionReactorI | Liquid_Core_Fission | 8 | 4 | 0.85 | 6 |
| Molten Core Fission Reactor II | MoltenCoreFissionReactorII | Project_MoltenCoreFissionReactorII | Liquid_Core_Fission | 35 | 3.5 | 0.88 | 6 |
| Molten Core Fission Reactor III | MoltenCoreFissionReactorIII | Project_MoltenCoreFissionReactorIII | Liquid_Core_Fission | 420 | 3 | 0.9 | 6 |
| Vapor Core Fission Reactor I | VaporCoreFissionReactorI | Project_VaporCoreFissionReactorI | Gas_Core_Fission | 6.5 | 4 | 0.9 | 8 |
| Vapor Core Fission Reactor II | VaporCoreFissionReactorII | Project_VaporCoreFissionReactorII | Gas_Core_Fission | 20 | 3 | 0.92 | 6 |
| Vapor Core Fission Reactor III | VaporCoreFissionReactorIII | Project_VaporCoreFissionReactorIII | Gas_Core_Fission | 60 | 3 | 0.92 | 5 |
| Gas Core Fission Reactor I | GasCoreFissionReactorI | Project_GasCoreFissionReactorI | Gas_Core_Fission | 8 | 10 | 0.9 | 6 |
| Gas Core Fission Reactor II | GasCoreFissionReactorII | Project_GasCoreFissionReactorII | Gas_Core_Fission | 33 | 7 | 0.91 | 6 |
| Gas Core Fission Reactor III | GasCoreFissionReactorIII | Project_GasCoreFissionReactorIII | Gas_Core_Fission | 150 | 3 | 0.95 | 6 |
| Gas Core Fission Reactor IV | GasCoreFissionReactorIV | Project_GasCoreFissionReactorIV | Gas_Core_Fission | 1650 | 10 | 0.93 | 6 |
| Gas Core Fission Reactor V | GasCoreFissionReactorV | Project_GasCoreFissionReactorV | Gas_Core_Fission | 1650 | 3.5 | 0.95 | 6 |
| Gas Core Fission Reactor VI | GasCoreFissionReactorVI | Project_GasCoreFissionReactorVI | Gas_Core_Fission | 1650 | 1 | 0.96 | 6 |
| Electrostatic Confinement Fusion Reactor I | ElectrostaticConfinementFusionReactorI | Project_ElectrostaticConfinementFusionReactorI | Electrostatic_Confinement_Fusion | 46 | 1 | 0.95 | 12 |
| Electrostatic Confinement Fusion Reactor II | ElectrostaticConfinementFusionReactorII | Project_ElectrostaticConfinementFusionReactorII | Electrostatic_Confinement_Fusion | 74 | 0.5 | 0.95 | 12 |
| Electrostatic Confinement Fusion Reactor III | ElectrostaticConfinementFusionReactorIII | Project_ElectrostaticConfinementFusionReactorIII | Electrostatic_Confinement_Fusion | 310 | 0.005 | 0.95 | 12 |
| Mirror Cell Fusion Reactor I | MirrorCellFusionReactorI | Project_MirrorCellFusionReactorI | Mirrored_Magnetic_Confinement_Fusion | 120 | 13.4 | 0.93 | 12 |
| Mirror Cell Fusion Reactor II | MirrorCellFusionReactorII | Project_MirrorCellFusionReactorII | Mirrored_Magnetic_Confinement_Fusion | 215 | 6.5 | 0.95 | 10 |
| Mirror Cell Fusion Reactor III | MirrorCellFusionReactorIII | Project_MirrorCellFusionReactorIII | Mirrored_Magnetic_Confinement_Fusion | 256 | 1.2 | 0.97 | 8 |
| Fusion Tokamak I | FusionTokamakI | Project_FusionTokamakI | Toroid_Magnetic_Confinement_Fusion | 128 | 12 | 0.92 | 16 |
| Fusion Tokamak II | FusionTokamakII | Project_FusionTokamakII | Toroid_Magnetic_Confinement_Fusion | 401 | 5 | 0.95 | 12 |
| Fusion Tokamak III | FusionTokamakIII | Project_FusionTokamakIII | Toroid_Magnetic_Confinement_Fusion | 624 | 2.5 | 0.96 | 10 |
| Fusion Tokamak IV | FusionTokamakIV | Project_FusionTokamakIV | Toroid_Magnetic_Confinement_Fusion | 1260 | 1.1 | 0.985 | 10 |
| Fusion Tokamak V | FusionTokamakV | Project_FusionTokamakV | Toroid_Magnetic_Confinement_Fusion | 5060 | 0.75 | 0.99 | 10 |
| Hybrid Confinement Fusion Reactor I | HybridConfinementFusionReactorI | Project_HybridConfinementFusionReactorI | Hybrid_Confinement_Fusion | 180 | 2 | 0.97 | 12 |
| Hybrid Confinement Fusion Reactor II | HybridConfinementFusionReactorII | Project_HybridConfinementFusionReactorII | Hybrid_Confinement_Fusion | 510 | 1 | 0.98 | 12 |
| Hybrid Confinement Fusion Reactor III | HybridConfinementFusionReactorIII | Project_HybridConfinementFusionReactorIII | Hybrid_Confinement_Fusion | 1900 | 0.5 | 0.99 | 12 |
| Hybrid Confinement Fusion Reactor IV | HybridConfinementFusionReactorIV | Project_HybridConfinementFusionReactorIV | Hybrid_Confinement_Fusion | 11370 | 0.05 | 0.99 | 12 |
| Z-Pinch Fusion Reactor I | ZPinchFusionReactorI | Project_ZPinchFusionReactorI | Z_Pinch_Fusion | 260 | 3 | 0.95 | 12 |
| Z-Pinch Fusion Reactor II | ZPinchFusionReactorII | Project_ZPinchFusionReactorII | Z_Pinch_Fusion | 610 | 2 | 0.95 | 12 |
| Z-Pinch Fusion Reactor III | ZPinchFusionReactorIII | Project_ZPinchFusionReactorIII | Z_Pinch_Fusion | 2510 | 1.4 | 0.96 | 12 |
| Z-Pinch Fusion Reactor IV | ZPinchFusionReactorIV | Project_ZPinchFusionReactorIV | Z_Pinch_Fusion | 3970 | 0.4 | 0.98 | 23 |
| Flow Stabilized Z-Pinch Fusion Reactor | FlowStabilizedZPinchFusionReactor | Project_FlowStabilizedZPinchFusionReactor | Z_Pinch_Fusion | 7590 | 0.0068 | 0.995 | 12 |
| Inertial Confinement Fusion Reactor I | InertialConfinementFusionReactorI | Project_InertialConfinementFusionReactorI | Inertial_Confinement_Fusion | 370 | 5 | 0.85 | 16 |
| Inertial Confinement Fusion Reactor II | InertialConfinementFusionReactorII | Project_InertialConfinementFusionReactorII | Inertial_Confinement_Fusion | 860 | 3 | 0.89 | 12 |
| Inertial Confinement Fusion Reactor III | InertialConfinementFusionReactorIII | Project_InertialConfinementFusionReactorIII | Inertial_Confinement_Fusion | 3170 | 2 | 0.92 | 12 |
| Inertial Confinement Fusion Reactor IV | InertialConfinementFusionReactorIV | Project_InertialConfinementFusionReactorIV | Inertial_Confinement_Fusion | 5500 | 1 | 0.95 | 12 |
| Inertial Confinement Fusion Reactor V | InertialConfinementFusionReactorV | Project_InertialConfinementFusionReactorV | Inertial_Confinement_Fusion | 19090 | 0.5 | 0.975 | 10 |
| Inertial Confinement Fusion Reactor VI | InertialConfinementFusionReactorVI | Project_InertialConfinementFusionReactorVI | Inertial_Confinement_Fusion | 20420 | 0.068 | 0.99 | 10 |
| Inertial Confinement Fusion Reactor VII | InertialConfinementFusionReactorVII | Project_InertialConfinementFusionReactorVII | Inertial_Confinement_Fusion | 306430 | 0.002 | 0.999 | 10 |
| Alien Hybrid Confinement Fusion Reactor | AlienHybridConfinementFusionReactor | Project_AlienMasterProject | Hybrid_Confinement_Fusion | 1000 | 1 | 0.99 | 4 |
| Alien Advanced Hybrid Confinement Fusion Reactor | AlienAdvancedHybridConfinementFusionReactor | Project_AlienMasterProject | Hybrid_Confinement_Fusion | 6400 | 0.35 | 0.995 | 4 |
| Alien Super Advanced Hybrid Confinement Fusion Reactor | AlienSuperAdvancedHybridConfinementFusionReactor | Project_AlienAdvancedMasterProject | Hybrid_Confinement_Fusion | 21510 | 0.05 | 0.998 | 4 |
| Antimatter Plasma Core Reactor I | AntimatterPlasmaCoreReactorI | Project_AntimatterPlasmaCoreReactorI | Antimatter_Plasma_Core | 1200 | 0.45 | 0.9975 | 12 |
| Antimatter Plasma Core Reactor II | AntimatterPlasmaCoreReactorII | Project_AntimatterPlasmaCoreReactorII | Antimatter_Plasma_Core | 7250 | 0.05 | 0.9975 | 12 |
| Antimatter Plasma Core Reactor III | AntimatterPlasmaCoreReactorIII | Project_AntimatterPlasmaCoreReactorIII | Antimatter_Plasma_Core | 42000 | 0.005 | 0.9975 | 12 |
| Antimatter Beam Core Reactor | AntimatterBeamCoreReactor | Project_AntimatterBeamCoreReactor | Antimatter_Beam_Core | 3000000 | 0.00002 | 0.9975 | 12 |

## Radiators

| Component | Template ID | Required Project | Mass (t/GW) | Crew | Emissivity | kW/kg | Temp (K) | Type | Collector |
|---|---|---|---|---|---|---|---|---|---|
| Aluminum Fin | AluminumFin |  | 400 | 1 | 0.85 | 2.5 | 800 | Fin | False |
| Titanium Array | TitaniumArray | Project_Warships | 181.82 | 1 | 0.83 | 5.5 | 1200 | Fin | False |
| Molybdenum Pipe | MolybdenumPipe | Project_MolybdenumPipeRadiator | 222.22 | 1 | 0.8 | 4.5 | 1650 | Fin | False |
| Nanotube Filament | NanotubeFilament | Project_NanotubeFilamentRadiator | 153.85 | 1 | 0.9 | 6.5 | 1300 | Spike | False |
| Ionic Dust | IonicDust | Project_IonicDustRadiator | 333.33 | 3 | 0.85 | 3 | 1200 | Droplet | True |
| Cobalt Dust | CobaltDust | Project_CobaltDustRadiator | 200 | 3 | 0.9 | 5 | 1200 | Droplet | True |
| Tin Droplet | TinDroplet | Project_TinDropletRadiator | 125 | 3 | 0.96 | 8 | 1030 | Droplet | True |
| Gallium Mist | GalliumMist | Project_GalliumMistRadiator | 100 | 3 | 0.96 | 10 | 1200 | Droplet | True |
| Lithium Spray | LithiumSpray | Project_LithiumSprayRadiator | 76.92 | 3 | 0.96 | 13 | 1500 | Droplet | True |
| Dusty Plasma | DustyPlasma | Project_DustyPlasmaRadiator | 55.56 | 2 | 0.96 | 18 | 2000 | Spike | True |
| Exotic Spike | ExoticSpike | Project_ExoticSpikeRadiator | 41.67 | 2 | 0.9 | 24 | 1900 | Spike | False |
| Diamondoid Spike | DiamondoidSpike | Project_AlienMasterProject | 66.67 | 1 | 0.93 | 15 | 1650 | AlienSpike | False |
| Exotic Tendril | ExoticTendril | Project_AlienMasterProject | 40 | 1 | 0.98 | 25 | 2500 | AlienSpike | False |

## Armor Materials

| Component | Template ID | X-Ray 1/2 (cm) | Baryonic 1/2 (cm) | Density (kg/m³) | Heat of Vap. (MJ/kg) |
|---|---|---|---|---|---|
| Steel Armor | SteelArmor | 2 | 7.5 | 7850 | 6.8 |
| Titanium Armor | TitaniumArmor | 4.2 | 10.5 | 4820 | 8.77 |
| Silicon Carbide Armor | SiliconCarbideArmor | 9.1 | 58 | 3210 | 9.9 |
| Boron Carbide Armor | BoronCarbideArmor | 22.2 | 13.8 | 2520 | 7.14 |
| Composite Armor | CompositeArmor | 15.3 | 72 | 1930 | 15 |
| Foamed Metal Armor | FoamedMetalArmor | 29.4 | 134.9 | 920 | 24 |
| Nanotube Armor | NanotubeArmor | 19.9 | 155.4 | 1720 | 29.6 |
| Adamantane Armor | AdamantaneArmor | 18 | 115.8 | 1800 | 59.534 |
| Exotic Armor | ExoticArmor | 5.2 | 12 | 2200 | 70 |
| Hybrid Armor | HybridArmor | 4.5 | 11 | 2000 | 80 |
| Alien Adamantane Armor | AlienAdamantaneArmor | 18 | 115.8 | 1800 | 59.534 |
| Alien Exotic Armor | AlienExoticArmor | 5.2 | 12 | 2200 | 70 |

## Hulls

| Component | Template ID | Required Project | Tier | Max Officers | Crew | Mass (t) | Length (m) | Width (m) | Nose HP | Hull HP | Modules | MC | Build Time (days) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Gunship | Gunship | Project_Warships | 1 | 1 | 3 | 178 | 50 | 10 | 1 | 0 | 1 | 1 | 60 |
| Escort | Escort | Project_Warships | 1 | 1 | 4 | 350 | 50 | 10 | 0 | 2 | 2 | 1 | 90 |
| Corvette | Corvette | Project_Warships | 1 | 2 | 8 | 400 | 65 | 15 | 1 | 1 | 2 | 1 | 90 |
| Frigate | Frigate | Project_PatrolVessels | 1 | 3 | 20 | 600 | 100 | 20 | 1 | 2 | 4 | 2 | 120 |
| Monitor | Monitor | Project_PatrolVessels | 2 | 3 | 35 | 800 | 125 | 20 | 0 | 4 | 3 | 2 | 120 |
| Destroyer | Destroyer | Project_PatrolVessels | 2 | 3 | 40 | 825 | 125 | 20 | 2 | 2 | 3 | 2 | 135 |
| Cruiser | Cruiser | Project_FleetCombatants | 2 | 4 | 60 | 1000 | 175 | 20 | 2 | 3 | 6 | 3 | 180 |
| Battlecruiser | Battlecruiser | Project_FleetCombatants | 2 | 4 | 70 | 1200 | 175 | 20 | 3 | 2 | 4 | 3 | 180 |
| Battleship | Battleship | Project_FleetCombatants | 3 | 5 | 80 | 1600 | 200 | 25 | 2 | 6 | 5 | 3 | 200 |
| Lancer | Lancer | Project_ShipsoftheLine | 3 | 5 | 100 | 2000 | 250 | 32 | 4 | 3 | 6 | 4 | 240 |
| Dreadnought | Dreadnought | Project_ShipsoftheLine | 3 | 5 | 120 | 2400 | 275 | 35 | 3 | 8 | 6 | 4 | 240 |
| Titan | Titan | Project_Titans | 3 | 6 | 120 | 3200 | 300 | 35 | 4 | 6 | 8 | 5 | 270 |
| STO Fighter | STOFighter |  | 1 | 0 | 2 | 30 | 25 | 8 | 1 | 1 | 0 | 0 | 60 |
| Alien Gunship | AlienGunship | Project_AlienMasterProject | 1 | 0 | 1 | 192 | 50 | 10 | 1 | 0 | 2 | 1 | 64 |
| Alien Escort | AlienEscort | Project_AlienMasterProject | 1 | 0 | 2 | 288 | 75 | 10 | 0 | 2 | 3 | 1 | 96 |
| Alien Corvette | AlienCorvette | Project_AlienMasterProject | 1 | 0 | 3 | 288 | 75 | 10 | 1 | 1 | 3 | 1 | 96 |
| Alien Frigate | AlienFrigate | Project_AlienMasterProject | 1 | 0 | 10 | 576 | 125 | 15 | 1 | 3 | 4 | 1 | 128 |
| Alien Monitor | AlienMonitor | Project_AlienMasterProject | 2 | 0 | 16 | 672 | 150 | 15 | 1 | 4 | 4 | 1 | 256 |
| Alien Destroyer | AlienDestroyer | Project_AlienMasterProject | 2 | 0 | 20 | 672 | 150 | 15 | 2 | 2 | 4 | 1 | 256 |
| Alien Cruiser | AlienCruiser | Project_AlienMasterProject | 2 | 0 | 25 | 1056 | 200 | 20 | 2 | 4 | 6 | 1 | 320 |
| Alien Battlecruiser | AlienBattlecruiser | Project_AlienMasterProject | 2 | 0 | 35 | 1440 | 245 | 25 | 3 | 3 | 5 | 1 | 360 |
| Alien Battleship | AlienBattleship | Project_AlienMasterProject | 2 | 0 | 40 | 1536 | 250 | 25 | 2 | 6 | 6 | 1 | 360 |
| Alien Lancer | AlienLancer | Project_AlienMasterProject | 2 | 0 | 40 | 1536 | 275 | 25 | 6 | 4 | 6 | 1 | 360 |
| Alien Dreadnought | AlienDreadnought | Project_AlienMasterProject | 2 | 0 | 50 | 2016 | 300 | 30 | 4 | 8 | 8 | 1 | 480 |
| Alien Titan | AlienTitan | Project_AlienMasterProject | 3 | 0 | 60 | 2304 | 400 | 30 | 6 | 8 | 6 | 1 | 480 |
| Alien Assault Carrier | AlienAssaultCarrier | Project_AlienMasterProject | 3 | 0 | 80 | 2688 | 300 | 30 | 0 | 6 | 5 | 1 | 480 |
| Alien Mothership | AlienMothership | Project_AlienMasterProject | 3 | 0 | 100 | 7680 | 600 | 60 | 4 | 16 | 6 | 1 | 512 |
| Salamander Gunship | SalamanderGunship | Project_AlienMasterProject | 1 | 0 | 1 | 20 | 35 | 8 | 1 | 1 | 0 | 0 | 60 |

## Utility Modules

| Component | Template ID | Required Project | Mass (t) | Crew | Group | Min Tier | Power Req. (MW) |
|---|---|---|---|---|---|---|---|
| ISRU Module | ISRUModule | Project_ISRUModule | 100 | 5 | 0 | 0 | 0 |
| Remass Scoop | RemassScoop | Project_RemassScoop | 40 | 1 | 1 | 0 | 0 |
| Muon Spiker | MuonSpiker | Project_MuonSpiker | 30 | 3 | 3 | 0 | 0 |
| Neutronium Spiker | NeutroniumSpiker | Project_NeutroniumSpiker | 30 | 3 | 3 | 0 | 0 |
| Antimatter Spiker | AntimatterSpiker | Project_AntimatterSpiker | 30 | 3 | 3 | 0 | 0 |
| Mobile Space Science Lab | MobileSpaceScienceLab | Project_MobileSpaceScienceLab | 200 | 12 | -1 | 0 | 1 |
| Repair Bay | RepairBay | Project_RepairBay | 700 | 10 | -1 | 0 | 0 |
| Salvage Bay | SalvageBay | Project_SalvageBay | 1000 | 20 | 11 | 2 | 5 |
| Marine Assault Unit | MarineAssaultUnit | Project_MarineAssaultUnit | 200 | 30 | -1 | 0 | 0 |
| Advanced Marine Assault Unit | AdvancedMarineAssaultUnit | Project_AdvancedMarineAssaultUnit | 200 | 30 | -1 | 0 | 0 |
| Elite Marine Assault Unit | EliteMarineAssaultUnit | Project_EliteMarineAssaultUnit | 200 | 30 | -1 | 0 | 0 |
| Spartans | Spartans | Project_Spartans | 200 | 30 | -1 | 0 | 0 |
| Rangers | Rangers | Project_Rangers | 200 | 30 | -1 | 0 | 0 |
| Immortals | Immortals | Project_Immortals | 200 | 30 | -1 | 0 | 0 |
| Laser Engine | LaserEngine | Project_LaserEngine | 25 | 3 | -1 | 0 | 5 |
| Advanced Laser Engine | AdvancedLaserEngine | Project_AdvancedLaserEngine | 50 | 3 | -1 | 0 | 10 |
| Liquid Hydrogen Containment | LiquidHydrogenContainment | Project_LiquidHydrogenContainment | 5 | 3 | 4 | 0 | 0 |
| Slush Hydrogen Tankage | SlushHydrogenTankage | Project_SlushHydrogenTankage | 10 | 3 | 4 | 0 | 0 |
| Hydron Trap | HydronTrap | Project_HydronTrap | 20 | 3 | 4 | 0 | 0 |
| Magazine | Magazine | Project_Magazine | 100 | 3 | -1 | 0 | 0 |
| Component Armor | ComponentArmor | Project_ComponentArmor | 500 | 0 | 2 | 0 | 0 |
| Solar Platform Kit | SolarPlatformKit | Project_SolarPlatformKit | 200 | 3 | -1 | 0 | 0 |
| Solar Outpost Kit | SolarOutpostKit | Project_SolarOutpostKit | 250 | 3 | -1 | 0 | 0 |
| Fission Platform Kit | FissionPlatformKit | Project_FissionPlatformKit | 250 | 3 | -1 | 0 | 0 |
| Fission Outpost Kit | FissionOutpostKit | Project_FissionOutpostKit | 300 | 3 | -1 | 0 | 0 |
| Fusion Platform Kit | FusionPlatformKit | Project_FusionPlatformKit | 250 | 3 | -1 | 0 | 0 |
| Fusion Outpost Kit | FusionOutpostKit | Project_FusionOutpostKit | 300 | 3 | -1 | 0 | 0 |
| Automated Solar Platform Kit | AutomatedSolarPlatformKit | Project_AutomatedSolarPlatformKit | 250 | 12 | -1 | 0 | 0 |
| Automated Solar Outpost Kit | AutomatedSolarOutpostKit | Project_AutomatedSolarOutpostKit | 1200 | 12 | -1 | 0 | 0 |
| Automated Fission Platform Kit | AutomatedFissionPlatformKit | Project_AutomatedFissionPlatformKit | 300 | 12 | -1 | 0 | 0 |
| Automated Fission Outpost Kit | AutomatedFissionOutpostKit | Project_AutomatedFissionOutpostKit | 1800 | 12 | -1 | 0 | 0 |
| Electronic Countermeasures 1 | ElectronicCountermeasures1 | Project_ECM1 | 10 | 2 | 9 | 0 | 2 |
| Electronic Countermeasures 2 | ElectronicCountermeasures2 | Project_ECM2 | 10 | 2 | 9 | 0 | 3 |
| Electronic Countermeasures 3 | ElectronicCountermeasures3 | Project_ECM3 | 10 | 2 | 9 | 0 | 4 |
| Flag Bridge | FlagBridge | Project_FlagBridge | 90 | 18 | 14 | 2 | 1 |
| Targeting Computer 1 | TargetingComputer1 | Project_TargetingComputer1 | 10 | 1 | 10 | 0 | 1 |
| Targeting Computer 2 | TargetingComputer2 | Project_TargetingComputer2 | 10 | 1 | 10 | 0 | 1 |
| Targeting Computer 3 | TargetingComputer3 | Project_TargetingComputer3 | 10 | 1 | 10 | 0 | 1 |
| Armor Struts | ArmorStruts | Project_ArmorStruts | 100 | 0 | 12 | 0 | 0 |
| Cyclotron | Cyclotron | Project_Cyclotron | 50 | 3 | -1 | 0 | 5 |
| VectorThrusters | VectorThrusters | Project_PatrolVessels | 20 | 0 | 13 | 0 | 0 |
| Hydra Infiltration Pod | HydraInfiltrationPod | Project_AlienMasterProject | 10 | 1 | 5 | 0 | 0 |
| Salamander Terror Unit Pod | SalamanderTerrorUnitPod | Project_AlienMasterProject | 10 | 30 | 6 | 0 | 0 |
| Alien Army Pod | AlienArmyPod | Project_AlienMasterProject | 10000 | 3000 | 7 | 3 | 0 |
| Alien Fusion Outpost Kit | AlienFusionOutpostKit | Project_AlienMasterProject | 500 | 0 | -1 | 0 | 0 |
| Alien Fusion Platform Kit | AlienFusionPlatformKit | Project_AlienMasterProject | 500 | 0 | -1 | 0 | 0 |
| Alien Muon Spiker | AlienMuonSpiker | Project_AlienMasterProject | 10 | 0 | 3 | 0 | 0 |
| Alien Slush Hydrogen Tankage | AlienSlushHydrogenTankage | Project_AlienMasterProject | 10 | 0 | 4 | 0 | 0 |
| Alien Hydron Trap | AlienHydronTrap | Project_AlienMasterProject | 10 | 0 | 4 | 0 | 0 |
| Alien Surveillance Module | AlienSurveillanceModule | Project_AlienMasterProject | 20 | 3 | 8 | 0 | 0 |
| Alien ECM | AlienECM | Project_AlienMasterProject | 10 | 1 | 9 | 0 | 2 |
| Alien Targeting Computer | AlienTargetingComputer | Project_AlienMasterProject | 10 | 1 | 10 | 0 | 1 |
| Alien Repair Bay | AlienRepairBay | Project_AlienMasterProject | 500 | 4 | -1 | 0 | 0 |
| Alien Magazine | AlienMagazine | Project_AlienMasterProject | 100 | 1 | -1 | 0 | 0 |
| Alien Surveillance Platform | AlienSurveillancePlatform | Project_AlienMasterProject |  | 8 | 15 | 1 | 0 |
| Alien Surveillance Orbital | AlienSurveillanceOrbital | Project_AlienMasterProject |  | 32 | 15 | 2 | 0 |
| Alien Surveillance Ring | AlienSurveillanceRing | Project_AlienMasterProject |  | 128 | 15 | 3 | 0 |
| Empty | Empty |  | 0 | 0 | -1 | 0 |  |

## Particle Weapons

| Component | Template ID | Required Project | Mount | Crew | Weapon Mass (t) | Cooldown (s) | Eff. | Shot Power (MJ) | Range (km) | Pivot (deg) | PD Target? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Point Defense E-Beamer | PointDefenseE-Beamer | Project_EBeamBatteries | OneHull | 1 | 5 | 4 | 0.2 | 5 | 200 | 180 | False |
| Light E-Beam Battery | LightE-BeamBattery | Project_EBeamBatteries | OneHull | 1 | 10 | 20 | 0.15 | 20 | 300 | 180 | False |
| E-Beam Battery | E-BeamBattery | Project_EBeamBatteries | TwoHullHoriz | 2 | 20 | 20 | 0.15 | 40 | 400 | 180 | False |
| Heavy E-Beam Battery | HeavyE-BeamBattery | Project_EBeamBatteries | FourHull | 2 | 40 | 20 | 0.15 | 80 | 500 | 180 | False |
| Electron Lance | ElectronLance | Project_ElectronLance | TwoNoseVert | 2 | 30 | 20 | 0.15 | 60 | 500 | 30 | False |
| Heavy Electron Lance | HeavyElectronLance | Project_ElectronLance | ThreeNoseAngle | 2 | 60 | 20 | 0.15 | 120 | 600 | 30 | False |
| Spinal Electron Lance | SpinalElectronLance | Project_ElectronLance | FourNose | 2 | 120 | 20 | 0.15 | 240 | 800 | 30 | False |
| Point Defense Ion Battery | PointDefenseIonBattery | Project_IonBatteries | OneHull | 1 | 5 | 3 | 0.2 | 5 | 200 | 180 | False |
| Light Ion Battery | LightIonBattery | Project_IonBatteries | OneHull | 1 | 10 | 30 | 0.15 | 20 | 500 | 180 | False |
| Ion Battery | IonBattery | Project_IonBatteries | TwoHullHoriz | 2 | 20 | 30 | 0.15 | 40 | 600 | 180 | False |
| Heavy Ion Battery | HeavyIonBattery | Project_IonBatteries | FourHull | 2 | 40 | 30 | 0.15 | 80 | 700 | 180 | False |
| Light Ion Cannon | LightIonCannon | Project_IonCannon | OneNose | 2 | 15 | 30 | 0.15 | 30 | 500 | 30 | False |
| Ion Cannon | IonCannon | Project_IonCannon | TwoNoseVert | 2 | 30 | 30 | 0.15 | 60 | 600 | 30 | False |
| Heavy Ion Cannon | HeavyIonCannon | Project_IonCannon | ThreeNoseAngle | 2 | 60 | 30 | 0.15 | 120 | 700 | 30 | False |
| Spinal Ion Cannon | SpinalIonCannon | Project_IonCannon | FourNose | 2 | 120 | 30 | 0.15 | 240 | 850 | 30 | False |
| Particle Beam Battery | ParticleBeamBattery | Project_ParticleBeamBatteries | TwoHullHoriz | 2 | 25 | 30 | 0.15 | 40 | 600 | 180 | False |
| Heavy Particle Beam Battery | HeavyParticleBeamBattery | Project_ParticleBeamBatteries | FourHull | 2 | 50 | 30 | 0.15 | 80 | 700 | 180 | False |
| Light Particle Lance | LightParticleLance | Project_ParticleLance | OneNose | 3 | 20 | 30 | 0.15 | 30 | 700 | 30 | False |
| Particle Lance | ParticleLance | Project_ParticleLance | TwoNoseVert | 3 | 40 | 30 | 0.15 | 60 | 800 | 30 | False |
| Heavy Particle Lance | HeavyParticleLance | Project_ParticleLance | ThreeNoseAngle | 3 | 80 | 30 | 0.15 | 120 | 900 | 30 | False |
| Spinal Particle Lance | SpinalParticleLance | Project_ParticleLance | FourNose | 3 | 160 | 30 | 0.15 | 240 | 1000 | 30 | False |
| Antimatter Particle Cannon | AntimatterParticleCannon | Project_AntimatterParticleCannon | TwoNoseVert | 4 | 40 | 40 | 0.15 | 80 | 800 | 30 | False |
| Heavy Antimatter Particle Cannon | HeavyAntimatterParticleCannon | Project_AntimatterParticleCannon | ThreeNoseAngle | 4 | 120 | 40 | 0.15 | 160 | 900 | 30 | False |
| Spinal Antimatter Particle Cannon | SpinalAntimatterParticleCannon | Project_AntimatterParticleCannon | FourNose | 4 | 240 | 40 | 0.15 | 320 | 1000 | 30 | False |
| Spinal Neutron Lance | SpinalNeutronLance | Project_SpinalNeutronLance | FourNose | 8 | 360 | 60 | 0.15 | 560 | 1000 | 30 | False |
| Alien Point Defense Particle Beam | AlienPointDefenseParticleBeam | Project_AlienMasterProject | OneHull | 0 | 1 | 2 | 0.2 | 32 | 300 | 180 | False |
| Alien Light Particle Cannon | AlienLightParticleCannon | Project_AlienMasterProject | OneNose | 1 | 150 | 16 | 0.2 | 96 | 400 | 30 | False |
| Alien Particle Cannon | AlienParticleCannon | Project_AlienMasterProject | TwoNoseVert | 1 | 80 | 16 | 0.2 | 144 | 450 | 30 | False |
| Alien Heavy Particle Cannon | AlienHeavyParticleCannon | Project_AlienMasterProject | ThreeNoseAngle | 2 | 400 | 16 | 0.2 | 216 | 525 | 30 | False |
| Alien Spinal Particle Cannon | AlienSpinalParticleCannon | Project_AlienMasterProject | FourNose | 2 | 800 | 16 | 0.2 | 324 | 600 | 30 | False |
| Alien Relativistic Particle Cannon | AlienRelativisticParticleCannon | Project_AlienMasterProject | FourNose | 2 | 1200 | 240 | 0.1 | 1024 | 1200 | 20 | False |

## Plasma Weapons

| Component | Template ID | Required Project | Mount | Crew | Weapon Mass (t) | Cooldown (s) | Eff. | Damage (MJ) | Range (km) | Pivot (deg) | Muzzle Vel. (km/s) | PD Target? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Plasma Battery Mk 1 | PlasmaBatteryMk1 | Project_PlasmaBatteryMk1 | TwoHullHoriz | 4 | 320 | 30 | 0.3 |  | 600 | 180 | 30 | False |
| Plasma Battery Mk 2 | PlasmaBatteryMk2 | Project_PlasmaBatteryMk2 | TwoHullHoriz | 4 | 280 | 25 | 0.4 |  | 700 | 180 | 30 | False |
| Plasma Battery Mk 3 | PlasmaBatteryMk3 | Project_PlasmaBatteryMk3 | TwoHullHoriz | 4 | 240 | 20 | 0.5 |  | 800 | 180 | 30 | False |
| Heavy Plasma Battery Mk 1 | HeavyPlasmaBatteryMk1 | Project_PlasmaBatteryMk1 | FourHull | 5 | 640 | 36 | 0.2 |  | 700 | 180 | 32 | False |
| Heavy Plasma Battery Mk 2 | HeavyPlasmaBatteryMk2 | Project_PlasmaBatteryMk2 | FourHull | 5 | 560 | 30 | 0.3 |  | 800 | 180 | 32 | False |
| Heavy Plasma Battery Mk 3 | HeavyPlasmaBatteryMk3 | Project_PlasmaBatteryMk3 | FourHull | 5 | 480 | 24 | 0.4 |  | 900 | 180 | 32 | False |
| Plasma Cannon Mk 1 | PlasmaCannonMk1 | Project_PlasmaCannonMk1 | ThreeNoseAngle | 5 | 540 | 48 | 0.25 |  | 900 | 30 | 35 | False |
| Plasma Cannon Mk 2 | PlasmaCannonMk2 | Project_PlasmaCannonMk2 | ThreeNoseAngle | 5 | 480 | 40 | 0.35 |  | 950 | 30 | 35 | False |
| Plasma Cannon Mk 3 | PlasmaCannonMk3 | Project_PlasmaCannonMk3 | ThreeNoseAngle | 5 | 420 | 32 | 0.45 |  | 1000 | 30 | 35 | False |
| Heavy Plasma Cannon Mk 1 | HeavyPlasmaCannonMk1 | Project_PlasmaCannonMk1 | FourNose | 6 | 720 | 60 | 0.2 |  | 900 | 30 | 35 | False |
| Heavy Plasma Cannon Mk 2 | HeavyPlasmaCannonMk2 | Project_PlasmaCannonMk2 | FourNose | 6 | 640 | 50 | 0.3 |  | 950 | 30 | 35 | False |
| Heavy Plasma Cannon Mk 3 | HeavyPlasmaCannonMk3 | Project_PlasmaCannonMk3 | FourNose | 6 | 560 | 40 | 0.4 |  | 1000 | 30 | 35 | False |
| Alien Plasma Battery | AlienPlasmaBattery | Project_AlienMasterProject | TwoHullHoriz | 1 | 200 | 20 | 0.5 |  | 900 | 180 | 42 | False |
| Alien Heavy Plasma Battery | AlienHeavyPlasmaBattery | Project_AlienMasterProject | FourHull | 2 | 400 | 24 | 0.4 |  | 1000 | 180 | 42 | False |
| Alien Plasma Cannon | AlienPlasmaCannon | Project_AlienMasterProject | ThreeNoseAngle | 2 | 390 | 32 | 0.45 |  | 1100 | 30 | 42 | False |
| Alien Heavy Plasma Cannon | AlienHeavyPlasmaCannon | Project_AlienMasterProject | FourNose | 2 | 520 | 40 | 0.4 |  | 1200 | 30 | 42 | False |

## Propellant Tanks

Note: Raw JSON template for propellant tanks is not available. The user has confirmed that all tanks are effectively identical in capacity.

| Component | Propellant Capacity | Tank Mass | Notes |
|---|---|---|---|
| Standard Propellant Tank | 100 tons | 0 tons | Universal standard size (structural mass negligible/included in hull) |

