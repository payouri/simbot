import { afterEach, describe, expect, test } from "bun:test";
import { simSchema } from "@simbot/shared";
import { addonString, type Harness, makeHarness } from "./harness";

let h: Harness;
afterEach(() => h?.close());

// The test build's Live version is 12.1.0.69933 and its PTR version 12.1.5.69952. The `# WoW`
// line is hand-written (see packages/simc/src/fixtures/addon-string/README.md).
const withHeader = (version: string | null) =>
  addonString().replace(
    "# SimC Addon 12.1.0-01\n",
    `# SimC Addon 12.1.0-01\n${version ? `# WoW ${version}\n` : ""}`,
  );

describe("PTR-client flag on Imports", () => {
  test("an Addon String from the PTR client is flagged, on the Import and on its Sims", async () => {
    h = makeHarness();
    const imp = await h.importText(withHeader("12.1.5.69952"));
    expect(imp.ptrClient).toBe(true);

    const sim = await h.createSim(imp.id);
    expect(sim.importPtrClient).toBe(true);
    const got = simSchema.parse(await (await h.call("GET", `/api/sims/${sim.id}`)).json());
    expect(got.importPtrClient).toBe(true);
  });

  test("one newer than Live is flagged, a Live one or one without the header is not", async () => {
    h = makeHarness();
    expect((await h.importText(withHeader("12.2.0.70500"))).ptrClient).toBe(true);
    expect((await h.importText(withHeader("12.1.0.69933"))).ptrClient).toBe(false);
    const plain = await h.importText(withHeader(null));
    expect(plain.ptrClient).toBe(false);
    expect((await h.createSim(plain.id)).importPtrClient).toBe(false);
  });

  test("without a Current SimC Build nothing is flagged", async () => {
    h = makeHarness({ withBuild: false });
    expect((await h.importText(withHeader("12.1.5.69952"))).ptrClient).toBe(false);
  });

  test("pasting the same text again keeps the flag the Import was recorded with", async () => {
    h = makeHarness();
    const text = withHeader("12.1.5.69952");
    const first = await h.importText(text);
    const again = await h.importText(text);
    expect([again.id, again.ptrClient]).toEqual([first.id, true]);
  });

  test("the flag never changes the Sim's Game Data", async () => {
    h = makeHarness();
    const imp = await h.importText(withHeader("12.1.5.69952"));
    const sim = await h.createSim(imp.id);
    expect(sim.settings).toEqual((await h.createSim((await h.importText()).id)).settings);
  });
});
