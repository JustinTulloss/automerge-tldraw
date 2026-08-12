import { TLStoreSnapshot, createTLStore, loadSnapshot } from "tldraw"
import { cloneSnapshot } from "./utils"

let cachedDefaultSnapshot: TLStoreSnapshot | null = null

export function getDefaultStoreSnapshot(): TLStoreSnapshot {
  if (!cachedDefaultSnapshot) {
    const store = createTLStore({})
    const snapshot = store.getStoreSnapshot()
    loadSnapshot(store, snapshot)
    cachedDefaultSnapshot = store.getStoreSnapshot()
  }

  return cloneSnapshot(cachedDefaultSnapshot!)
}
