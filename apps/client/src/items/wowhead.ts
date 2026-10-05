import type { ImportItem } from "@simbot/shared";
import { type MouseEvent as ReactMouseEvent, useEffect, useRef } from "react";

const SCRIPT = "https://wow.zamimg.com/js/tooltips.js";

type WowheadTooltips = {
  triggerTooltip?: (element: HTMLElement, event?: Event) => void;
};
declare global {
  interface Window {
    whTooltips?: Record<string, boolean>;
    WH?: { Tooltips?: WowheadTooltips };
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
  // A blocked or failed load leaves items without tooltips; the next `online` event may try again.
  script.onerror = () => {
    loading = false;
    script.remove();
  };
  document.head.append(script);
}

/**
 * Loads Wowhead's tooltip script once, from the app shell. It is only requested while the
 * browser is online, so an offline or air-gapped install never waits on it.
 */
export function useWowheadScript() {
  useEffect(() => {
    const start = () => {
      if (navigator.onLine) load();
    };
    start();
    window.addEventListener("online", start);
    return () => window.removeEventListener("online", start);
  }, []);
}

/** The `data-wowhead` params of an item, or nothing when Wowhead cannot know it. */
export function wowheadData(item: ImportItem): string | undefined {
  if (item.itemId === null || item.status === "unknown") return undefined;
  const bonus = item.bonusIds.length ? `&bonus=${item.bonusIds.join(":")}` : "";
  return `item=${item.itemId}${bonus}${item.ilvl ? `&ilvl=${item.ilvl}` : ""}`;
}

/*
 * tooltips.js only shows tooltips for <a href> elements: its hover handler checks the node name,
 * and `refreshLinks()` scans `document.links`. An item sits inside a slot button or a tray label,
 * where a link is invalid markup, so items host their tooltip on a span instead. Hovering one
 * lays a single hidden link (the bridge) over it and asks Wowhead to show that link's tooltip.
 * Wowhead hides it on the link's `mouseout`, which leaving the item dispatches.
 */
let bridge: HTMLAnchorElement | null = null;
let shownFor: HTMLElement | null = null;

function getBridge(): HTMLAnchorElement {
  if (bridge) return bridge;
  const a = document.createElement("a");
  a.tabIndex = -1;
  a.setAttribute("aria-hidden", "true");
  // Placed beside the bridge's box, which covers the hovered item.
  a.dataset.tooltipMode = "attach";
  a.style.cssText = "position:absolute;pointer-events:none;opacity:0";
  document.body.append(a);
  bridge = a;
  return a;
}

function show(host: HTMLElement, data: string, event: ReactMouseEvent) {
  const tooltips = window.WH?.Tooltips;
  if (!tooltips?.triggerTooltip) return;
  const a = getBridge();
  const box = host.getBoundingClientRect();
  a.style.left = `${box.left + window.scrollX}px`;
  a.style.top = `${box.top + window.scrollY}px`;
  a.style.width = `${box.width}px`;
  a.style.height = `${box.height}px`;
  a.href = `https://www.wowhead.com/${data.split("&")[0]}`;
  a.dataset.wowhead = data;
  shownFor = host;
  tooltips.triggerTooltip(a, event.nativeEvent);
}

function hide(host: HTMLElement | null) {
  if (!host || shownFor !== host) return;
  shownFor = null;
  bridge?.dispatchEvent(new MouseEvent("mouseout"));
}

/**
 * Props that make an element an item's tooltip host. Without `data` (an Unknown Item) the
 * element is no host at all.
 */
export function useTooltipHost(data: string | undefined) {
  const host = useRef<HTMLElement | null>(null);
  // An item removed or changed while hovered never gets its mouseleave; drop its tooltip with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hide when the item's data changes
  useEffect(() => () => hide(host.current), [data]);
  if (!data) return {};
  return {
    "data-wowhead": data,
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
      host.current = e.currentTarget;
      show(e.currentTarget, data, e);
    },
    onMouseLeave: (e: ReactMouseEvent<HTMLElement>) => hide(e.currentTarget),
  };
}
