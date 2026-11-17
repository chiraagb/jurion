// Browser preferences (pane sizes, collapsed panels, chosen mode). Storage can be blocked or cleared, so a read falls back
// to null and a failed write is ignored: nothing here is ever required.
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked storage: the setting lasts for this visit only */
  }
}
