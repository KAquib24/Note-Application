/** Shared localStorage boundary for app preferences and the persisted workspace. */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try { const value = localStorage.getItem(`notehub:${key}`); return value === null ? fallback : JSON.parse(value) as T }
    catch { return fallback }
  },
  set<T>(key: string, value: T): boolean {
    try { localStorage.setItem(`notehub:${key}`, JSON.stringify(value)); return true }
    catch (error) { console.warn('NoteHub could not save this preference.', error); return false }
  },
}
