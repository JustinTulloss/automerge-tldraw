import { TLStoreSnapshot, createTLStore } from "tldraw"

let cachedDefaultSnapshot: TLStoreSnapshot | null = null

function cloneSnapshot(snapshot: TLStoreSnapshot): TLStoreSnapshot {
  return JSON.parse(JSON.stringify(snapshot))
}

export function getDefaultStoreSnapshot(): TLStoreSnapshot {
  if (!cachedDefaultSnapshot) {
    const store = createTLStore({})
    const ensureStoreIsUsable = (store as {
      ensureStoreIsUsable?: () => void
    }).ensureStoreIsUsable

    ensureStoreIsUsable?.call(store)
    const snapshot = store.getSnapshot()
    cachedDefaultSnapshot = cloneSnapshot(snapshot)
  }

  return cloneSnapshot(cachedDefaultSnapshot!)
}
