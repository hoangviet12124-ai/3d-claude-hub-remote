import { create } from "zustand";

// The sessions Việt keeps as tabs over the Manager chat. A session joins when it is opened or started here and stays,
// even after its turn ends or it is closed, until he closes its tab. Kept per browser (localStorage), so the tabs
// come back after a reload.

const KEY = "aaw:session-tabs";
const MAX = 8;

function load(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-MAX) : [];
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // storage blocked: tabs last for this page only
  }
}

interface TabState {
  ids: string[];
  loaded: boolean;
  /** Add a tab (no-op if present); the oldest tab goes past the limit. */
  pin: (id: string) => void;
  unpin: (id: string) => void;
  /** A session restarted under a new id (/clear): its tab follows. */
  rename: (from: string, to: string) => void;
}

function withLoaded(st: TabState): string[] {
  return st.loaded ? st.ids : load();
}

export const useTabStore = create<TabState>()((set, get) => ({
  ids: [],
  loaded: false,
  pin: (id) => {
    const ids = withLoaded(get());
    const next = ids.includes(id) ? ids : [...ids, id].slice(-MAX);
    save(next);
    set({ ids: next, loaded: true });
  },
  unpin: (id) => {
    const next = withLoaded(get()).filter((x) => x !== id);
    save(next);
    set({ ids: next, loaded: true });
  },
  rename: (from, to) => {
    const ids = withLoaded(get());
    const next = ids.includes(to) ? ids.filter((x) => x !== from) : ids.map((x) => (x === from ? to : x));
    save(next);
    set({ ids: next, loaded: true });
  },
}));

/** Read the saved tabs once, on the client (not during server rendering). */
export function loadTabs(): void {
  if (!useTabStore.getState().loaded) useTabStore.setState({ ids: load(), loaded: true });
}
