import type { SimcJobTarget, SimcUpdateStep } from "@simbot/shared";

export const STEP_LABEL: Record<SimcUpdateStep, string> = {
  fetch: "Fetching the build",
  check: "Running the Check Sim",
  meta: "Building item data",
  commit: "Switching over",
};

export const targetLabel = (t: SimcJobTarget) =>
  t.kind === "installed"
    ? `Switch to ${t.tag}`
    : t.kind === "seed"
      ? "Install the shipped build"
      : "Install the latest nightly";
