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
  loadSnapshot,
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

const cloneSnapshot = (snapshot: TLStoreSnapshot): TLStoreSnapshot =>
  typeof structuredClone === "function"
    ? structuredClone(snapshot)
    : JSON.parse(JSON.stringify(snapshot))

type InstancePresenceRecord = ReturnType<
  typeof InstancePresenceRecordType.create
>

type StoreHistoryEntry = Parameters<TLStore["listen"]>[0] extends (
  entry: infer Entry
) => void
  ? Entry
  : never

type PresenceMetadata = {
  userId: string
  name?: string
  color?: string
}

const ensureStoreIsUsableIfAvailable = (store: TLStore): void => {
  const maybeEnsure = (store as TLStore & { ensureStoreIsUsable?: () => void }).ensureStoreIsUsable
  maybeEnsure?.call(store)
}

const isTLRecord = (value: unknown): value is TLRecord => {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "typeName" in value
  )
}

export function useAutomergeStore({
  handle,
  shapeUtils = [],
}: {
  handle: DocHandle<TLStoreSnapshot>
  shapeUtils?: TLAnyShapeUtilConstructor[]
}): TLStoreWithStatus {
  const [store] = useState(() => {
    const store = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    })
    ensureStoreIsUsableIfAvailable(store)
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
        loadSnapshot(store, snapshot)
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

export function useAutomergePresence({
  handle,
  store,
  userMetadata,
}: {
  handle: DocHandle<TLStoreSnapshot>
  store: TLStoreWithStatus
  userMetadata: PresenceMetadata
}): void {
  const innerStore = store?.store

  const { userId, name, color } = userMetadata

  const [, updateLocalState] = useLocalAwareness({
    handle,
    userId,
    initialState: {},
  }) as [unknown, (state: unknown) => void]

  const [peerStates] = useRemoteAwareness({
    handle,
    localUserId: userId,
  })

  /* ----------- Presence stuff ----------- */
  useEffect(() => {
    if (!innerStore) return 
    
    const remotePresence = Object.values(peerStates).filter(isTLRecord)
    const toPut: TLRecord[] = remotePresence.filter(
      (record: TLRecord) => Object.keys(record).length !== 0
    )

    // put / remove the records in the store
    const existingPresence = innerStore
      .query.records("instance_presence")
      .get()
      .slice() as InstancePresenceRecord[]
    const toRemove = existingPresence
      .sort((a: InstancePresenceRecord, b: InstancePresenceRecord) =>
        a.id.localeCompare(b.id)
      )
      .map((record: InstancePresenceRecord) => record.id)
      .filter((id: InstancePresenceRecord["id"]) =>
        !toPut.some((record: TLRecord) => record.id === id)
      )

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