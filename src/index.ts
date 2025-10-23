import { TLStoreSnapshot } from "tldraw"
import { getDefaultStoreSnapshot } from "./default_store"

/* a similar pattern to other automerge init functions */
export function init(doc: TLStoreSnapshot) {
  Object.assign(doc, getDefaultStoreSnapshot())
}

export * from "./useAutomergeStore"
