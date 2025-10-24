import { TLStoreSnapshot, createTLStore } from "tldraw"
import { cloneSnapshot } from "./utils"

let cachedDefaultSnapshot: TLStoreSnapshot | null = null

export function getDefaultStoreSnapshot(): TLStoreSnapshot {
  if (!cachedDefaultSnapshot) {
    const store = createTLStore({})
    const snapshot = store.getStoreSnapshot()
    cachedDefaultSnapshot = snapshot;
  }

  return cloneSnapshot(cachedDefaultSnapshot!)
}
