export type PtrClientNoticeSim = {
  importPtrClient: boolean;
  settings: { gameData: "live" | "ptr" };
};

/** The hint is about a Live answer, so a PTR Sim never gets it. */
export function showsPtrClientNotice(sim: PtrClientNoticeSim): boolean {
  return sim.importPtrClient && sim.settings.gameData === "live";
}
