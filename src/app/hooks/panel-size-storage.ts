// What both panel-size hooks need from `localStorage`, in one place. They held
// a copy each while the second one was being written, which is 44 identical
// lines that have to be changed together to stay correct.

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

// Storage can be unavailable (or throw) in some Electron contexts, and a panel
// size is never important enough to break rendering over.
export function readStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // A size that fails to persist is still usable for this session.
  }
}
