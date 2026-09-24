// Built-object enums shared by the sim and data layers (no imports, so the data
// layer can use them without an import cycle through empire.ts).

// Port of BuiltObjectSubRole.cs (member order exact: values are used as array
// indices, e.g. Empire.LatestDesigns[(int)subRole], and in picture-index maths).
export enum BuiltObjectSubRole {
    Undefined,
    Escort,
    Frigate,
    Destroyer,
    Cruiser,
    CapitalShip,
    TroopTransport,
    Carrier,
    ResupplyShip,
    ExplorationShip,
    SmallFreighter,
    MediumFreighter,
    LargeFreighter,
    ColonyShip,
    PassengerShip,
    ConstructionShip,
    GasMiningShip,
    MiningShip,
    GasMiningStation,
    MiningStation,
    SmallSpacePort,
    MediumSpacePort,
    LargeSpacePort,
    ResortBase,
    GenericBase,
    EnergyResearchStation,
    WeaponsResearchStation,
    HighTechResearchStation,
    MonitoringStation,
    DefensiveBase,
}
