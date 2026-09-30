import { useEffect } from "react";

const SCRIPT = "https://wow.zamimg.com/js/tooltips.js";

type WowheadPower = { refreshLinks?: () => void };
declare global {
  interface Window {
    whTooltips?: Record<string, boolean>;
    $WowheadPower?: WowheadPower;
  }
}

let loading = false;

function load() {
  if (loading) return;
  loading = true;
  window.whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };
  const script = document.createElement("script");
  script.src = SCRIPT;
  script.async = true;
  // A blocked or failed load leaves plain links; the next `online` event may try again.
  script.onerror = () => {
    loading = false;
    script.remove();
  };
  document.head.append(script);
}

/**
 * Optional Wowhead hover tooltips on item links (`data-wowhead`). The script is only requested
 * while the browser is online, so an offline or air-gapped install never waits on it.
 */
export function useWowheadTooltips(refreshKey: unknown) {
  useEffect(() => {
    const start = () => {
      if (navigator.onLine) load();
    };
    start();
    window.addEventListener("online", start);
    return () => window.removeEventListener("online", start);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scan the links when items change
  useEffect(() => {
    window.$WowheadPower?.refreshLinks?.();
  }, [refreshKey]);
}
