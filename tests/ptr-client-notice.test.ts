import { expect, test } from "bun:test";
import { showsPtrClientNotice } from "../apps/client/src/notice/showsPtrClientNotice";

test("the PTR-client notice shows on a Live Sim from a PTR-client Import only", () => {
  const sim = (importPtrClient: boolean, gameData: "live" | "ptr") => ({
    importPtrClient,
    settings: { gameData },
  });
  expect(showsPtrClientNotice(sim(true, "live"))).toBe(true);
  expect(showsPtrClientNotice(sim(true, "ptr"))).toBe(false);
  expect(showsPtrClientNotice(sim(false, "live"))).toBe(false);
  expect(showsPtrClientNotice(sim(false, "ptr"))).toBe(false);
});
