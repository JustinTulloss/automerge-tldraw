import {
  createTLStore,
  defaultShapeUtils,
  defaultBindingUtils,
  getUserPreferences,
  setUserPreferences,
  defaultUserPreferences,
  createPresenceStateDerivation,
  InstancePresenceRecordType,
  UserRecordType,
  createUserId,
  computed,
  react,
  loadSnapshot,
} from "tldraw"
import type {
  TLAnyBindingUtilConstructor,
  TLAnyShapeUtilConstructor,
  TLRecord,
  TLStore,
  TLStoreSnapshot,
  TLStoreWithStatus,
  TLUser,
} from "tldraw"
import { useEffect, useState } from "react"
import { DocHandle, DocHandleChangePayload } from "@automerge/automerge-repo"
import { useLocalAwareness, useRemoteAwareness } from "@automerge/react"

import { applyAutomergePatchesToTLStore } from "./AutomergeToTLStore.js"
import {
  applyTLStoreChangesToAutomerge,
  writeSnapshotToAutomerge,
} from "./TLStoreToAutomerge.js"
import { canonicalJson, cloneSnapshot } from "./utils.js"


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
  bindingUtils = [],
}: {
  handle: DocHandle<TLStoreSnapshot>
  shapeUtils?: TLAnyShapeUtilConstructor[]
  bindingUtils?: TLAnyBindingUtilConstructor[]
}): TLStoreWithStatus {
  const [store] = useState(() => {
    const store = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
      bindingUtils: [...defaultBindingUtils, ...bindingUtils],
    })
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
      const doc = handle.doc()
      if (!doc) throw new Error("Document not found")
      if (!doc.store) throw new Error("Document store not initialized")

      const snapshot = cloneSnapshot(doc)

      store.mergeRemoteChanges(() => {
        loadSnapshot(store, snapshot)
      })

      // loadSnapshot ran tldraw's schema migrations in memory. If the doc's
      // serialized schema is behind, persist the migrated snapshot so the
      // incremental patch paths exchange current-schema records from now on.
      const migrated = store.getStoreSnapshot()
      if (canonicalJson(doc.schema) !== canonicalJson(migrated.schema)) {
        preventPatchApplications = true
        try {
          handle.change((d: TLStoreSnapshot) => {
            writeSnapshotToAutomerge(d, migrated)
          })
        } finally {
          preventPatchApplications = false
        }
      }

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

    // tldraw 5.x presence takes a Signal<TLUser | null> (a full user record
    // with a branded TLUserId) instead of a bare preferences object.
    const user = computed<TLUser | null>("userPreferences", () => {
      const prefs = getUserPreferences()
      return UserRecordType.create({
        id: createUserId(prefs.id),
        name: prefs.name ?? defaultUserPreferences.name,
        color: prefs.color ?? defaultUserPreferences.color,
      })
    })

    const presenceDerivation = createPresenceStateDerivation(user, {
      instanceId: InstancePresenceRecordType.createId(userId),
    })(innerStore)

    return react("when presence changes", () => {
      const presence = presenceDerivation.get()
      requestAnimationFrame(() => {
        updateLocalState(presence)
      })
    })
  }, [innerStore, userId, name, color, updateLocalState])
  /* ----------- End presence stuff ----------- */

}
