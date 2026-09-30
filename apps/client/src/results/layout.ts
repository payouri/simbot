import type { LayoutStorage } from "react-resizable-panels";

/**
 * Where the split layout is remembered. `localStorage` can throw or be absent (private window,
 * blocked site data): the view then works with the default layout and just forgets it.
 */
export const layoutStorage: LayoutStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // not remembered
    }
  },
};

export const RESULTS_LAYOUT_ID = "simbot-top-gear-results";
