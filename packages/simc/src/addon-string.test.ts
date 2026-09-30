import { describe, expect, test } from "bun:test";
import { adler32, parseAddonString } from "./addon-string";

const fixture = `# Rootbeer - Frost - 2026-09-29 22:41 - EU/Draenor
# SimC Addon 12.1.0-01
# Requires SimulationCraft 1210-01+

# Always ensure you are using the latest SimulationCraft version before simming.

deathknight="Rootbeer"
level=90
race=pandaren
region=eu
server=draenor
role=attack
professions=blacksmithing=100/mining=100
talents=CsPAAAAAAAAAAAAAAAAAAAAAAMDwMjZMDY2mZmZmZZmZkZMmZYGGPgZGMzMzMDAAAAAAAAAjZbgBsAWGmQGLYmxMzAzAYYmBYmBD
spec=frost

# Saved Loadout: Raid
# talents=CsPAAAAAAAAAAAAAAAAAAAAAAMDwMjZMDY2mZmZmZZmZkZMmZYGGPgZGMzMzMDAAAAAAAAAjZbgBsAWGmQGLYmxMzAzAYYmBYmBD

head=relentless_riders_crown,id=249970,bonus_id=40/6935/12676/12806/13335/13338/13575,gem_id=240983
neck=rotmires_sporeheart,id=268291,bonus_id=13786,gem_id=240908
shoulders=shoulderplates_of_frozen_blood,id=50234,bonus_id=12806/13577
back=adherents_silken_shroud,id=239656,bonus_id=8791/8960/12066/12214/12384/13622/13667/9627
chest=relentless_riders_cuirass,id=249973,bonus_id=13786,enchant_id=7987
wrists=spellbreakers_bracers,id=237834,bonus_id=8791/8960/12066/12384/13622/12497,gem_id=240908
hands=relentless_riders_bonegrasps,id=249971,bonus_id=40/12675/12806/13335/13337/13574
waist=girdle_of_devouring_rot,id=268289,bonus_id=13786,gem_id=240908
legs=relentless_riders_legguards,id=249969,bonus_id=40/12676/12806/13335/13339/13575,enchant_id=8159
feet=greaves_of_the_unformed,id=249381,bonus_id=13355/13468/13469
finger1=platinum_star_band,id=193708,bonus_id=6935/13355/13468/13469,gem_id=240908,enchant=eyes_of_the_eagle_2
finger2=sindorei_band_of_hope,id=249919,bonus_id=6935/13355/13468/13469,gem_id=240908,enchant=eyes_of_the_eagle_2
trinket1=gaze_of_the_alnseer,id=249343,bonus_id=13654
trinket2=light_company_guidon,id=249344,bonus_id=13654
main_hand=bellamys_final_judgement,id=249277,bonus_id=13654,enchant_id=3368

### Gear from Bags
#
# Spare Ring
# finger1=,id=193708,bonus_id=6935/13355/13468/13469

### Additional Character Info
#
# upgrade_currencies=c:3008:0/c:3028:100
#
# Checksum: d87d732e
`;

describe("Addon String Parser", () => {
  test("parses profile header", () => {
    const result = parseAddonString(fixture);
    expect(result.character).toEqual({
      name: "Rootbeer",
      class: "deathknight",
      spec: "frost",
      race: "pandaren",
      level: 90,
      region: "eu",
      realm: "draenor",
    });
  });

  test("parses equipped items", () => {
    const result = parseAddonString(fixture);
    expect(result.equippedItems).toHaveLength(15);
    const head = result.equippedItems.find((item) => item.slot === "head");
    expect(head).toEqual({
      slot: "head",
      rawLine:
        "head=relentless_riders_crown,id=249970,bonus_id=40/6935/12676/12806/13335/13338/13575,gem_id=240983",
      source: "equipped",
    });
  });

  test("normalizes finger and trinket slots to finger1/finger2, trinket1/trinket2", () => {
    const result = parseAddonString(fixture);
    const fingers = result.equippedItems.filter((item) =>
      ["finger1", "finger2"].includes(item.slot),
    );
    expect(fingers).toHaveLength(2);
    const trinkets = result.equippedItems.filter((item) =>
      ["trinket1", "trinket2"].includes(item.slot),
    );
    expect(trinkets).toHaveLength(2);
  });

  test("handles main_hand and off_hand as weapons", () => {
    const result = parseAddonString(fixture);
    const mainHand = result.equippedItems.find((item) => item.slot === "main_hand");
    expect(mainHand).toBeDefined();
    expect(mainHand?.rawLine).toContain("bellamys_final_judgement");
  });

  test("parses candidate items from Bags section", () => {
    const result = parseAddonString(fixture);
    const bagItems = result.candidateItems.filter((item) => item.source === "bags");
    expect(bagItems.length).toBeGreaterThan(0);
    const spareRing = bagItems.find((item) => item.rawLine.includes("193708"));
    expect(spareRing).toBeDefined();
    expect(spareRing?.slot).toBe("finger1");
  });

  test("parses candidate items from Great Vault section", () => {
    const withGraultVault = fixture.replace(
      "### Gear from Bags",
      "### Gear from Great Vault\n#\n# chest=mythic_chest,id=12345,bonus_id=1234\n\n### Gear from Bags",
    );
    const result = parseAddonString(withGraultVault);
    const vaultItems = result.candidateItems.filter((item) => item.source === "great_vault");
    expect(vaultItems.length).toBeGreaterThan(0);
    const chest = vaultItems.find((item) => item.slot === "chest");
    expect(chest).toBeDefined();
  });

  test("parses Great Vault and linked items under the real addon headers", () => {
    const real = fixture.replace(
      "### Gear from Bags",
      "### Weekly Reward Choices\n#\n# Idol (730)\n# trinket1=,id=249343,bonus_id=1234\n### End of Weekly Reward Choices\n\n### Linked gear\n#\n# head=,id=111\n\n### Gear from Bags",
    );
    const result = parseAddonString(real);
    const vault = result.candidateItems.filter((i) => i.source === "great_vault");
    expect(vault.map((i) => i.slot)).toEqual(["trinket1"]);
    const linked = result.candidateItems.filter((i) => i.source === "linked");
    expect(linked.map((i) => i.slot)).toEqual(["head"]);
  });

  test("reports equipment lines from unrecognised sections", () => {
    const odd = fixture.replace(
      "### Gear from Bags",
      "### Mystery Gear\n#\n# chest=,id=1\n\n### Gear from Bags",
    );
    expect(parseAddonString(odd).report.unknownFields).toContain("mystery gear: chest");
  });

  test("parses talent loadouts", () => {
    const result = parseAddonString(fixture);
    expect(result.talentLoadouts.length).toBeGreaterThan(0);
    const raid = result.talentLoadouts.find((l) => l.comment === "Raid");
    expect(raid).toBeDefined();
    expect(raid?.rawLine).toContain("talents=");
  });

  test("parses additional character info", () => {
    const result = parseAddonString(fixture);
    expect(result.additionalInfo).toBeDefined();
    expect(result.additionalInfo.upgrade_currencies).toBe("c:3008:0/c:3028:100");
  });

  test("verifies Adler-32 checksum", () => {
    const result = parseAddonString(fixture);
    expect(result.checksumVerification).toBeDefined();
    expect(result.checksumVerification?.expected).toBe("d87d732e");
    expect(result.checksumVerification?.matches).toBe(true);
  });

  test("reports checksum mismatch without blocking", () => {
    const modifiedFixture = fixture.replace("Checksum: d87d732e", "Checksum: deadbeef");
    const result = parseAddonString(modifiedFixture);
    expect(result.checksumVerification?.expected).toBe("deadbeef");
    expect(result.checksumVerification?.matches).toBe(false);
    // Should not throw, should have all other data
    expect(result.character).toBeDefined();
    expect(result.equippedItems).toBeDefined();
  });

  test("collects unknown # fields in report", () => {
    const withUnknownField = fixture.replace(
      "### Additional Character Info",
      "### Unknown Section\n# unknown_field=some_value",
    );
    const result = parseAddonString(withUnknownField);
    expect(result.report.unknownFields).toContain("unknown_field");
  });

  test("returns null for missing checksum and notes it in report", () => {
    const noChecksum = fixture.slice(0, fixture.lastIndexOf("# Checksum"));
    const result = parseAddonString(noChecksum);
    expect(result.checksumVerification).toBeNull();
    expect(result.report.missingChecksum).toBe(true);
  });
});

describe("Adler-32 checksum", () => {
  test("computes correct Adler-32", () => {
    // Verified test vectors
    const result1 = adler32("hello world");
    expect(result1).toBe("1a0b045d");

    const result2 = adler32("");
    expect(result2).toBe("00000001");
  });
});
