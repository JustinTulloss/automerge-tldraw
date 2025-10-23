import {
  createTLStore,
  defaultShapeUtils,
  getUserPreferences,
  setUserPreferences,
  defaultUserPreferences,
  createPresenceStateDerivation,
  InstancePresenceRecordType,
  computed,
  react,
} from "tldraw"
import type {
  TLAnyShapeUtilConstructor,
  TLRecord,
  TLStore,
  TLStoreSnapshot,
  TLStoreWithStatus,
} from "tldraw"
import { useEffect, useState } from "react"
import { DocHandle, DocHandleChangePayload } from "@automerge/automerge-repo"
import {
  useLocalAwareness,
  useRemoteAwareness,
} from "@automerge/automerge-repo-react-hooks"

import { applyAutomergePatchesToTLStore } from "./AutomergeToTLStore.js"
import { applyTLStoreChangesToAutomerge } from "./TLStoreToAutomerge.js"
function cloneSnapshot(snapshot: TLStoreSnapshot): TLStoreSnapshot {
  return JSON.parse(JSON.stringify(snapshot))
}

type StoreHistoryEntry = Parameters<TLStore["listen"]>[0] extends (entry: infer Entry) => any
  ? Entry
  : {
      changes: {
        added: Record<string, TLRecord>
        updated: Record<string, [TLRecord, TLRecord]>
        removed: Record<string, TLRecord>
      }
    }

export function useAutomergeStore({
  handle,
  shapeUtils = [],
}: {
  handle: DocHandle<TLStoreSnapshot>
  userId: string
  shapeUtils?: TLAnyShapeUtilConstructor[]
}): TLStoreWithStatus {
  const [store] = useState(() => {
    const store = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    })
    const ensureStoreIsUsable = (store as {
      ensureStoreIsUsable?: () => void
    }).ensureStoreIsUsable

    ensureStoreIsUsable?.call(store)
    return store
  })

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: "loading",
  })

  /* -------------------- TLDraw <--> Automerge -------------------- */
  useEffect(() => {
    const unsubs: (() => void)[] = []

    // A hacky workaround to prevent local changes from being applied twice
    // once into the automerge doc and then back again.
    let preventPatchApplications = false

    /* TLDraw to Automerge */
    function syncStoreChangesToAutomergeDoc({ changes }: StoreHistoryEntry) {
      preventPatchApplications = true
      try {
        handle.change((doc: TLStoreSnapshot) => {
          applyTLStoreChangesToAutomerge(doc, changes)
        })
      } finally {
        preventPatchApplications = false
      }
    }

    unsubs.push(
      store.listen(syncStoreChangesToAutomergeDoc, {
        source: "user",
        scope: "document",
      })
    )

    /* Automerge to TLDraw */
    const syncAutomergeDocChangesToStore = ({
      patches,
    }: DocHandleChangePayload<TLStoreSnapshot>) => {
      if (preventPatchApplications) return

      applyAutomergePatchesToTLStore(patches, store)
    }

    handle.on("change", syncAutomergeDocChangesToStore)
    unsubs.push(() => handle.off("change", syncAutomergeDocChangesToStore))

    /* Defer rendering until the document is ready */
    // TODO: need to think through the various status possibilities here and how they map
    handle.whenReady().then(() => {
      const doc = handle.docSync()
      if (!doc) throw new Error("Document not found")
      if (!doc.store) throw new Error("Document store not initialized")

      const snapshot = cloneSnapshot(doc)

      store.mergeRemoteChanges(() => {
        store.loadSnapshot(snapshot)
      })

      setStoreWithStatus({
        store,
        status: "synced-remote",
        connectionStatus: "online",
      })
    })

    return () => {
      unsubs.forEach((fn) => fn())
      unsubs.length = 0
    }
  }, [handle, store])

  return storeWithStatus
}

export function useAutomergePresence({ handle, store, userMetadata }: 
  { handle: DocHandle<TLStoreSnapshot>, store: TLStoreWithStatus, userMetadata: any }) {

  const innerStore = store?.store

  const { userId, name, color } = userMetadata

  const [, updateLocalState] = useLocalAwareness({
    handle,
    userId,
    initialState: {},
  })

  const [peerStates] = useRemoteAwareness({
    handle,
    localUserId: userId,
  })

  /* ----------- Presence stuff ----------- */
  useEffect(() => {
    if (!innerStore) return 
    
    const remotePresence = Object.values(peerStates) as Array<
      TLRecord | undefined
    >
    const toPut: TLRecord[] = remotePresence
      .filter((record): record is TLRecord => Boolean(record))
      .filter((record) => Object.keys(record).length !== 0)

    // put / remove the records in the store
    const existingPresence = innerStore
      .query.records("instance_presence")
      .get()
      .slice() as TLRecord[]
    const toRemove = existingPresence
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => record.id)
      .filter((id) => !toPut.some((record) => record.id === id))

    if (toRemove.length) innerStore.remove(toRemove)
    if (toPut.length) innerStore.put(toPut)
  }, [innerStore, peerStates])

  useEffect(() => {
    if (!innerStore) return 
    /* ----------- Presence stuff ----------- */
    setUserPreferences({ id: userId, color, name })

    const userPreferences = computed<{
      id: string
      color: string
      name: string
    }>("userPreferences", () => {
      const user = getUserPreferences()
      return {
        id: user.id,
        color: user.color ?? defaultUserPreferences.color,
        name: user.name ?? defaultUserPreferences.name,
      }
    })

    const presenceId = InstancePresenceRecordType.createId(userId)
    const presenceDerivation = createPresenceStateDerivation(
      userPreferences,
      presenceId
    )(innerStore)

    return react("when presence changes", () => {
      const presence = presenceDerivation.get()
      requestAnimationFrame(() => {
        updateLocalState(presence)
      })
    })
  }, [innerStore, userId, updateLocalState])
  /* ----------- End presence stuff ----------- */

}