// PROTOTYPE mock data. Synthetic character and items, labelled as such in the UI.
// Values are shaped like what the Addon String parse + SimC item pass would give us.

export type Quality = "poor" | "common" | "uncommon" | "rare" | "epic" | "legendary";
export type Source = "equipped" | "bags" | "vault";
export type SlotId =
  | "head"
  | "neck"
  | "shoulder"
  | "back"
  | "chest"
  | "wrist"
  | "hands"
  | "waist"
  | "legs"
  | "feet"
  | "finger"
  | "trinket"
  | "main_hand";

export interface Slot {
  id: SlotId;
  label: string;
  /** rings and trinkets take two items, chosen as an unordered pair */
  paired?: boolean;
}

export interface Item {
  uid: string;
  itemId: number;
  slot: SlotId;
  name: string;
  icon: string;
  quality: Quality;
  ilvl: number;
  source: Source;
  /** equipped position for paired slots */
  equippedIndex?: 0 | 1;
  primary: number;
  stamina: number;
  secondary: Partial<Record<"crit" | "haste" | "mastery" | "vers", number>>;
  tier?: boolean;
  onUse?: boolean;
  unique?: boolean;
  embellished?: boolean;
  usable: boolean;
  unusableReason?: string;
  /** hidden: DPS contribution vs the equipped item in the slot, in % of baseline */
  value: number;
  oneHand?: boolean;
}

export const SLOTS: Slot[] = [
  { id: "head", label: "Head" },
  { id: "neck", label: "Neck" },
  { id: "shoulder", label: "Shoulders" },
  { id: "back", label: "Back" },
  { id: "chest", label: "Chest" },
  { id: "wrist", label: "Wrists" },
  { id: "hands", label: "Hands" },
  { id: "waist", label: "Waist" },
  { id: "legs", label: "Legs" },
  { id: "feet", label: "Feet" },
  { id: "finger", label: "Rings", paired: true },
  { id: "trinket", label: "Trinkets", paired: true },
  { id: "main_hand", label: "Main Hand" },
];

export const CHARACTER = {
  name: "Aurelith",
  realm: "Silvermoon",
  region: "EU",
  className: "Paladin",
  spec: "Retribution",
  race: "Blood Elf",
  level: 90,
  primaryStat: "Strength",
  equippedIlvl: 258.4,
  professions: ["Blacksmithing 100", "Mining 100"],
  talentLoadouts: [
    {
      id: "raid",
      name: "Raid single target",
      code: "CYEAAAAAAAAAAAAAAAAAAAAAAYMzMjZmZmxYmZMjZMGzYGLzYmZmZ2mBAAAAAAgZbmZmxMzYGjZmZWmZGA",
    },
    {
      id: "mplus",
      name: "M+ cleave",
      code: "CYEAAAAAAAAAAAAAAAAAAAAAAYMzMjZmZmxYmZMjhZMGzYGLzYmZmZ2mBAAAAAAgZbmZmxMzYGjZmhZmZGA",
    },
  ],
  simcVersion: { running: "1210-01 · 4c7c736", latest: "1210-01 · 9e1a2f0", behind: 3 },
};

const I = (p: Omit<Item, "usable" | "uid"> & { usable?: boolean; uid?: string }): Item => ({
  usable: true,
  uid: p.uid ?? `${p.slot}-${p.itemId}-${p.ilvl}-${p.source}`,
  ...p,
});

export const ITEMS: Item[] = [
  // Head
  I({
    itemId: 237610,
    slot: "head",
    name: "Greathelm of the Sundered Dawn",
    icon: "inv_helmet_96",
    quality: "epic",
    ilvl: 259,
    source: "equipped",
    primary: 1240,
    stamina: 3180,
    secondary: { crit: 612, mastery: 441 },
    tier: true,
    value: 0,
  }),
  I({
    itemId: 237610,
    slot: "head",
    name: "Greathelm of the Sundered Dawn",
    icon: "inv_helmet_96",
    quality: "epic",
    ilvl: 265,
    source: "vault",
    primary: 1330,
    stamina: 3420,
    secondary: { crit: 650, mastery: 470 },
    tier: true,
    value: 0.62,
  }),
  I({
    itemId: 241102,
    slot: "head",
    name: "Visor of Echoing Void",
    icon: "inv_helmet_74",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 1285,
    stamina: 3300,
    secondary: { haste: 598, vers: 470 },
    value: 0.41,
  }),
  I({
    itemId: 240877,
    slot: "head",
    name: "Hood of the Quiet Grove",
    icon: "inv_helmet_41",
    quality: "epic",
    ilvl: 268,
    source: "bags",
    primary: 1360,
    stamina: 3500,
    secondary: { haste: 640, crit: 480 },
    usable: false,
    unusableReason: "Leather",
    value: 0,
  }),
  // Neck
  I({
    itemId: 238004,
    slot: "neck",
    name: "Choker of Molten Oaths",
    icon: "inv_jewelry_necklace_07",
    quality: "epic",
    ilvl: 256,
    source: "equipped",
    primary: 0,
    stamina: 1790,
    secondary: { crit: 1310, haste: 902 },
    value: 0,
  }),
  I({
    itemId: 241560,
    slot: "neck",
    name: "Pendant of Shattered Stars",
    icon: "inv_jewelry_necklace_36",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 0,
    stamina: 1900,
    secondary: { haste: 1402, mastery: 950 },
    value: 0.48,
  }),
  I({
    itemId: 239991,
    slot: "neck",
    name: "Wayfarer's Brass Locket",
    icon: "inv_jewelry_amulet_04",
    quality: "rare",
    ilvl: 246,
    source: "bags",
    primary: 0,
    stamina: 1540,
    secondary: { vers: 1180, mastery: 760 },
    value: -0.55,
  }),
  // Shoulders
  I({
    itemId: 237612,
    slot: "shoulder",
    name: "Pauldrons of the Sundered Dawn",
    icon: "inv_shoulder_101",
    quality: "epic",
    ilvl: 262,
    source: "equipped",
    primary: 950,
    stamina: 2410,
    secondary: { crit: 470, haste: 330 },
    tier: true,
    value: 0,
  }),
  I({
    itemId: 241240,
    slot: "shoulder",
    name: "Mantle of the Last Bastion",
    icon: "inv_shoulder_22",
    quality: "epic",
    ilvl: 265,
    source: "bags",
    primary: 990,
    stamina: 2520,
    secondary: { haste: 480, vers: 340 },
    value: 0.08,
  }),
  // Back
  I({
    itemId: 238120,
    slot: "back",
    name: "Drape of Tempered Resolve",
    icon: "inv_misc_cape_11",
    quality: "epic",
    ilvl: 253,
    source: "equipped",
    primary: 700,
    stamina: 1780,
    secondary: { mastery: 390, vers: 250 },
    value: 0,
  }),
  I({
    itemId: 241377,
    slot: "back",
    name: "Cloak of the Hollow Choir",
    icon: "inv_misc_cape_18",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 760,
    stamina: 1920,
    secondary: { crit: 420, haste: 270 },
    embellished: true,
    value: 0.71,
  }),
  I({
    itemId: 239002,
    slot: "back",
    name: "Scout's Weathered Shawl",
    icon: "inv_misc_cape_20",
    quality: "rare",
    ilvl: 250,
    source: "bags",
    primary: 680,
    stamina: 1720,
    secondary: { vers: 400, haste: 230 },
    value: -0.12,
  }),
  // Chest
  I({
    itemId: 237608,
    slot: "chest",
    name: "Breastplate of the Sundered Dawn",
    icon: "inv_chest_plate16",
    quality: "epic",
    ilvl: 259,
    source: "equipped",
    primary: 1240,
    stamina: 3180,
    secondary: { crit: 540, mastery: 510 },
    tier: true,
    value: 0,
  }),
  I({
    itemId: 241119,
    slot: "chest",
    name: "Cuirass of Unbroken Chains",
    icon: "inv_chest_plate04",
    quality: "epic",
    ilvl: 265,
    source: "bags",
    primary: 1330,
    stamina: 3420,
    secondary: { haste: 610, vers: 505 },
    value: 0.35,
  }),
  I({
    itemId: 240651,
    slot: "chest",
    name: "Vestments of Idle Starlight",
    icon: "inv_chest_cloth_17",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 1285,
    stamina: 3300,
    secondary: { crit: 600, haste: 480 },
    usable: false,
    unusableReason: "Cloth",
    value: 0,
  }),
  // Wrists
  I({
    itemId: 238220,
    slot: "wrist",
    name: "Vambraces of Bitter Iron",
    icon: "inv_bracer_07",
    quality: "epic",
    ilvl: 256,
    source: "equipped",
    primary: 680,
    stamina: 1750,
    secondary: { haste: 360, mastery: 250 },
    value: 0,
  }),
  I({
    itemId: 241455,
    slot: "wrist",
    name: "Bindings of the Pale Tide",
    icon: "inv_bracer_14",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 715,
    stamina: 1840,
    secondary: { crit: 380, haste: 260 },
    value: 0.29,
  }),
  I({
    itemId: 241455,
    slot: "wrist",
    name: "Bindings of the Pale Tide",
    icon: "inv_bracer_14",
    quality: "epic",
    ilvl: 268,
    source: "vault",
    primary: 760,
    stamina: 1950,
    secondary: { crit: 400, haste: 280 },
    value: 0.46,
  }),
  // Hands
  I({
    itemId: 237609,
    slot: "hands",
    name: "Gauntlets of the Sundered Dawn",
    icon: "inv_gauntlets_61",
    quality: "epic",
    ilvl: 262,
    source: "equipped",
    primary: 950,
    stamina: 2410,
    secondary: { crit: 440, haste: 360 },
    tier: true,
    value: 0,
  }),
  I({
    itemId: 241500,
    slot: "hands",
    name: "Grips of the Forgebound",
    icon: "inv_gauntlets_29",
    quality: "epic",
    ilvl: 265,
    source: "bags",
    primary: 990,
    stamina: 2520,
    secondary: { haste: 470, mastery: 350 },
    value: 0.14,
  }),
  I({
    itemId: 239120,
    slot: "hands",
    name: "Worn Leather Handwraps",
    icon: "inv_gauntlets_04",
    quality: "rare",
    ilvl: 250,
    source: "bags",
    primary: 870,
    stamina: 2230,
    secondary: { crit: 400, vers: 300 },
    usable: false,
    unusableReason: "Leather",
    value: 0,
  }),
  // Waist
  I({
    itemId: 238301,
    slot: "waist",
    name: "Girdle of Cinder Vows",
    icon: "inv_belt_13",
    quality: "epic",
    ilvl: 253,
    source: "equipped",
    primary: 910,
    stamina: 2330,
    secondary: { vers: 420, mastery: 300 },
    value: 0,
  }),
  I({
    itemId: 241612,
    slot: "waist",
    name: "Warbelt of the Iron Choir",
    icon: "inv_belt_27",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 990,
    stamina: 2520,
    secondary: { crit: 460, haste: 330 },
    value: 0.66,
  }),
  I({
    itemId: 241613,
    slot: "waist",
    name: "Sash of Glimmering Ash",
    icon: "inv_belt_34",
    quality: "epic",
    ilvl: 259,
    source: "bags",
    primary: 950,
    stamina: 2410,
    secondary: { haste: 480, vers: 300 },
    embellished: true,
    value: 0.51,
  }),
  // Legs
  I({
    itemId: 237611,
    slot: "legs",
    name: "Legplates of the Sundered Dawn",
    icon: "inv_pants_plate_21",
    quality: "epic",
    ilvl: 256,
    source: "equipped",
    primary: 1195,
    stamina: 3060,
    secondary: { crit: 560, mastery: 440 },
    tier: true,
    value: 0,
  }),
  I({
    itemId: 241701,
    slot: "legs",
    name: "Greaves of the Drowned King",
    icon: "inv_pants_plate_17",
    quality: "epic",
    ilvl: 265,
    source: "bags",
    primary: 1330,
    stamina: 3420,
    secondary: { haste: 640, crit: 470 },
    value: 0.52,
  }),
  // Feet
  I({
    itemId: 238410,
    slot: "feet",
    name: "Sabatons of Ember Roads",
    icon: "inv_boots_plate_08",
    quality: "epic",
    ilvl: 259,
    source: "equipped",
    primary: 950,
    stamina: 2410,
    secondary: { haste: 430, vers: 350 },
    value: 0,
  }),
  I({
    itemId: 241799,
    slot: "feet",
    name: "Treads of the Starless March",
    icon: "inv_boots_plate_14",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 990,
    stamina: 2520,
    secondary: { crit: 470, mastery: 320 },
    value: 0.09,
  }),
  I({
    itemId: 239330,
    slot: "feet",
    name: "Ranger's Mail Striders",
    icon: "inv_boots_chain_05",
    quality: "rare",
    ilvl: 250,
    source: "bags",
    primary: 870,
    stamina: 2230,
    secondary: { haste: 400, vers: 300 },
    usable: false,
    unusableReason: "Mail",
    value: 0,
  }),
  // Rings (pair)
  I({
    itemId: 238501,
    slot: "finger",
    name: "Signet of the Ashen Court",
    icon: "inv_jewelry_ring_36",
    quality: "epic",
    ilvl: 259,
    source: "equipped",
    equippedIndex: 0,
    primary: 0,
    stamina: 1790,
    secondary: { crit: 1240, haste: 990 },
    value: 0,
  }),
  I({
    itemId: 238502,
    slot: "finger",
    name: "Band of Endless Vigil",
    icon: "inv_jewelry_ring_60",
    quality: "epic",
    ilvl: 256,
    source: "equipped",
    equippedIndex: 1,
    primary: 0,
    stamina: 1750,
    secondary: { mastery: 1200, vers: 950 },
    value: 0,
  }),
  I({
    itemId: 241830,
    slot: "finger",
    name: "Loop of the Fractured Sun",
    icon: "inv_jewelry_ring_54",
    quality: "epic",
    ilvl: 265,
    source: "vault",
    primary: 0,
    stamina: 1920,
    secondary: { crit: 1380, haste: 1030 },
    unique: true,
    value: 0.58,
  }),
  I({
    itemId: 241831,
    slot: "finger",
    name: "Seal of Hollow Tides",
    icon: "inv_jewelry_ring_73",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 0,
    stamina: 1840,
    secondary: { haste: 1320, vers: 980 },
    value: 0.37,
  }),
  I({
    itemId: 239560,
    slot: "finger",
    name: "Tarnished Copper Ring",
    icon: "inv_jewelry_ring_03",
    quality: "uncommon",
    ilvl: 240,
    source: "bags",
    primary: 0,
    stamina: 1400,
    secondary: { crit: 900, vers: 700 },
    value: -0.9,
  }),
  // Trinkets (pair)
  I({
    itemId: 238701,
    slot: "trinket",
    name: "Ember of the Unmade Forge",
    icon: "inv_trinket_naxxramas03",
    quality: "epic",
    ilvl: 259,
    source: "equipped",
    equippedIndex: 0,
    primary: 1180,
    stamina: 0,
    secondary: {},
    onUse: true,
    value: 0,
  }),
  I({
    itemId: 238702,
    slot: "trinket",
    name: "Vial of Quickened Blood",
    icon: "inv_misc_gem_bloodstone_02",
    quality: "epic",
    ilvl: 256,
    source: "equipped",
    equippedIndex: 1,
    primary: 0,
    stamina: 0,
    secondary: { haste: 1520 },
    value: 0,
  }),
  I({
    itemId: 241901,
    slot: "trinket",
    name: "Idol of the Sleeping Titan",
    icon: "inv_jewelry_talisman_07",
    quality: "epic",
    ilvl: 265,
    source: "bags",
    primary: 1260,
    stamina: 0,
    secondary: {},
    onUse: true,
    unique: true,
    value: 0.94,
  }),
  I({
    itemId: 241902,
    slot: "trinket",
    name: "Rune of Patient Storms",
    icon: "inv_misc_rune_09",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 0,
    stamina: 0,
    secondary: { crit: 1580 },
    value: 0.21,
  }),
  I({
    itemId: 239740,
    slot: "trinket",
    name: "Glowing Pebble of Mild Luck",
    icon: "inv_misc_orb_05",
    quality: "rare",
    ilvl: 246,
    source: "bags",
    primary: 0,
    stamina: 0,
    secondary: { vers: 1100 },
    value: -1.4,
  }),
  // Main hand (two-hand; one-hander included to exercise the hand rule)
  I({
    itemId: 238900,
    slot: "main_hand",
    name: "Oathbreaker, Blade of the Dawn",
    icon: "inv_sword_62",
    quality: "epic",
    ilvl: 259,
    source: "equipped",
    primary: 2480,
    stamina: 6360,
    secondary: { crit: 1080, haste: 900 },
    value: 0,
  }),
  I({
    itemId: 241950,
    slot: "main_hand",
    name: "Maul of the Riven Deep",
    icon: "inv_mace_28",
    quality: "epic",
    ilvl: 265,
    source: "vault",
    primary: 2660,
    stamina: 6840,
    secondary: { haste: 1200, mastery: 860 },
    value: 1.12,
  }),
  I({
    itemId: 241951,
    slot: "main_hand",
    name: "Cleaver of Falling Ash",
    icon: "inv_axe_09",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 2570,
    stamina: 6600,
    secondary: { crit: 1150, vers: 880 },
    value: 0.44,
  }),
  I({
    itemId: 239800,
    slot: "main_hand",
    name: "Pilgrim's Hammer",
    icon: "inv_hammer_05",
    quality: "rare",
    ilvl: 250,
    source: "bags",
    primary: 1190,
    stamina: 3060,
    secondary: { haste: 520, vers: 400 },
    oneHand: true,
    value: -2.1,
  }),
  I({
    itemId: 240100,
    slot: "main_hand",
    name: "Whisperstring Longbow",
    icon: "inv_weapon_bow_07",
    quality: "epic",
    ilvl: 262,
    source: "bags",
    primary: 0,
    stamina: 6600,
    secondary: { crit: 1150, haste: 880 },
    usable: false,
    unusableReason: "Bow",
    value: 0,
  }),
  I({
    itemId: 240101,
    slot: "main_hand",
    name: "Fang of the Dusk Warren",
    icon: "inv_weapon_shortblade_05",
    quality: "rare",
    ilvl: 250,
    source: "bags",
    primary: 0,
    stamina: 3060,
    secondary: { crit: 520, haste: 400 },
    usable: false,
    unusableReason: "Dagger",
    value: 0,
  }),
];

export const TIER_SET = { name: "Sundered Dawn", twoPiece: 0.9, fourPiece: 1.8 };

export const FIGHT_STYLES = [
  { id: "Patchwerk", label: "Patchwerk", hint: "Single target, no movement" },
  { id: "DungeonSlice", label: "Dungeon slice", hint: "Packs and a boss" },
  { id: "LightMovement", label: "Light movement", hint: "Occasional repositioning" },
  { id: "HeavyMovement", label: "Heavy movement", hint: "Frequent movement" },
] as const;

export const PRECISIONS = [
  { id: "low", label: "Low", targetError: 0.5, hint: "Fast, wide error" },
  { id: "medium", label: "Medium", targetError: 0.2, hint: "Default" },
  { id: "high", label: "High", targetError: 0.1, hint: "About 3× slower" },
] as const;

export const CONSUMABLES = {
  flask: "Flask of Tempered Might",
  food: "Hearty Ember Roast",
  potion: "Tempered Potion of Power",
  augmentation: "Crystallized Augment Rune",
  weaponRune: "Ironclaw Whetstone",
};

export const BASELINE_DPS = 412_380;

export const SAMPLE_ADDON_STRING = `# SimC Addon 12.1.0-04
# Requires SimulationCraft 1210-01 or newer
# 2026-09-29 20:14

# Aurelith - Retribution - 2026-09-29 20:14 - EU/Silvermoon
# SimC Addon 12.1.0-04
# WoW 12.1.0.69933, TOC 120100

paladin="Aurelith"
level=90
race=blood_elf
region=eu
server=silvermoon
role=attack
professions=blacksmithing=100/mining=100
spec=retribution

talents=CYEAAAAAAAAAAAAAAAAAAAAAAYMzMjZmZmxYmZMjZMGzYGLzYmZmZ2mBAAAAAAgZbmZmxMzYGjZmZWmZGA

# Saved Loadout: M+ cleave
# talents=CYEAAAAAAAAAAAAAAAAAAAAAAYMzMjZmZmxYmZMjhZMGzYGLzYmZmZ2mBAAAAAAgZbmZmxMzYGjZmhZmZGA

head=,id=237610,bonus_id=12806/6652/12921/1498
neck=,id=238004,gem_id=213743,bonus_id=12806/6652/10532/1482
shoulder=,id=237612,bonus_id=12806/6652/12921/1504
back=,id=238120,enchant_id=7403,bonus_id=12806/6652/1472
chest=,id=237608,enchant_id=7364,bonus_id=12806/6652/12921/1498
wrist=,id=238220,enchant_id=7397,bonus_id=12806/6652/1482
hands=,id=237609,bonus_id=12806/6652/12921/1504
waist=,id=238301,gem_id=213491,bonus_id=12806/6652/1472
legs=,id=237611,enchant_id=7601,bonus_id=12806/6652/12921/1482
feet=,id=238410,enchant_id=7424,bonus_id=12806/6652/1498
finger1=,id=238501,enchant_id=7334,gem_id=213479,bonus_id=12806/6652/1498
finger2=,id=238502,enchant_id=7334,bonus_id=12806/6652/1482
trinket1=,id=238701,bonus_id=12806/6652/1498
trinket2=,id=238702,bonus_id=12806/6652/1482
main_hand=,id=238900,enchant_id=7460,bonus_id=12806/6652/1498

### Gear from Bags
# Visor of Echoing Void (262)
# head=,id=241102,bonus_id=12806/6652/1504
# Hood of the Quiet Grove (268)
# head=,id=240877,bonus_id=12806/6652/1510
# Pendant of Shattered Stars (262)
# neck=,id=241560,bonus_id=12806/6652/1504
# Cloak of the Hollow Choir (262)
# back=,id=241377,bonus_id=12806/6652/8960/1504
# Maul of the Riven Deep (265)
# main_hand=,id=241950,bonus_id=12806/6652/1507
# ... 30 more items

### Weekly Reward Choices
# Greathelm of the Sundered Dawn (265)
# head=,id=237610,bonus_id=12806/6652/12921/1507
# Loop of the Fractured Sun (265)
# finger1=,id=241830,bonus_id=12806/6652/1507

# Checksum: 5e1c0a7b`;
