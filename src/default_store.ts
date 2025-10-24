import { TLStoreSnapshot, TLStore, createTLStore, getSnapshot } from "tldraw"

let cachedDefaultSnapshot: TLStoreSnapshot | null = null

const cloneSnapshot = (snapshot: TLStoreSnapshot): TLStoreSnapshot =>
  typeof structuredClone === "function"
    ? structuredClone(snapshot)
    : JSON.parse(JSON.stringify(snapshot))

const ensureStoreIsUsableIfAvailable = (store: TLStore): void => {
  const maybeEnsure = (store as TLStore & { ensureStoreIsUsable?: () => void }).ensureStoreIsUsable
  maybeEnsure?.call(store)
}

export function getDefaultStoreSnapshot(): TLStoreSnapshot {
  if (!cachedDefaultSnapshot) {
    const store = createTLStore({})
    ensureStoreIsUsableIfAvailable(store)
    const snapshot = getSnapshot(store)
    cachedDefaultSnapshot = cloneSnapshot(snapshot)
  }

  return cloneSnapshot(cachedDefaultSnapshot!)
}
