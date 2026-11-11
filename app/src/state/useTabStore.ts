import { create } from "zustand";

// The sessions Việt keeps as tabs over the Manager chat. A session joins when it is opened or started here and stays,
// even after its turn ends or it is closed, until he closes its tab. Kept per browser (localStorage), so the tabs
// come back after a reload.

const KEY = "aaw:session-tabs";
const LABELS_KEY = "aaw:session-tab-labels";
const MAX = 8;
const MAX_LABEL = 60;

function load(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-MAX) : [];
  } catch {
    return [];
  }
}

function loadLabels(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LABELS_KEY) ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""));
  } catch {
    return {};
  }
}

function saveLabels(labels: Record<string, string>): void {
  try {
    localStorage.setItem(LABELS_KEY, JSON.stringify(labels));
  } catch {
    // storage blocked: names last for this page only
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
  /** Names Việt gave tabs (session id → name); a tab without one shows the session's title. */
  labels: Record<string, string>;
  loaded: boolean;
  /** Add a tab (no-op if present); the oldest tab goes past the limit. */
  pin: (id: string) => void;
  unpin: (id: string) => void;
  /** A session restarted under a new id (/clear): its tab follows. */
  rename: (from: string, to: string) => void;
  /** Name a tab; an empty name goes back to the session's title. */
  setLabel: (id: string, label: string) => void;
}

function withLoaded(st: TabState): string[] {
  return st.loaded ? st.ids : load();
}

function without(labels: Record<string, string>, id: string): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).filter(([k]) => k !== id));
}

function labelsOf(st: TabState): Record<string, string> {
  return st.loaded ? st.labels : loadLabels();
}

export const useTabStore = create<TabState>()((set, get) => ({
  ids: [],
  labels: {},
  loaded: false,
  pin: (id) => {
    const ids = withLoaded(get());
    const next = ids.includes(id) ? ids : [...ids, id].slice(-MAX);
    save(next);
    set({ ids: next, labels: labelsOf(get()), loaded: true });
  },
  unpin: (id) => {
    const next = withLoaded(get()).filter((x) => x !== id);
    const labels = without(labelsOf(get()), id);
    save(next);
    saveLabels(labels);
    set({ ids: next, labels, loaded: true });
  },
  rename: (from, to) => {
    const ids = withLoaded(get());
    const next = ids.includes(to) ? ids.filter((x) => x !== from) : ids.map((x) => (x === from ? to : x));
    const all = labelsOf(get());
    const label = all[from];
    const labels = without(all, from);
    if (label && !labels[to]) labels[to] = label;
    save(next);
    saveLabels(labels);
    set({ ids: next, labels, loaded: true });
  },
  setLabel: (id, label) => {
    const clean = label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
    const labels = without(labelsOf(get()), id);
    if (clean) labels[id] = clean;
    saveLabels(labels);
    set({ ids: withLoaded(get()), labels, loaded: true });
  },
}));

/** Read the saved tabs once, on the client (not during server rendering). */
export function loadTabs(): void {
  if (!useTabStore.getState().loaded) useTabStore.setState({ ids: load(), labels: loadLabels(), loaded: true });
}
