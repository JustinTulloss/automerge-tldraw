import { TLRecord, RecordId, TLStore } from "tldraw"
import type {
  Patch as AutomergePatch,
  Prop as AutomergeProp,
  InsertPatch,
  PutPatch,
  SpliceTextPatch,
} from "@automerge/automerge"

type LegacyUpdatePatch = {
  action: "update"
  path: AutomergeProp[]
  value: unknown
}

type StorePatch = AutomergePatch | LegacyUpdatePatch

export function applyAutomergePatchesToTLStore(
  patches: StorePatch[],
  store: TLStore
) {
  const toRemove: TLRecord["id"][] = []
  const updatedObjects: { [id: string]: TLRecord } = {}

  patches.forEach((patch) => {
    if (!isStorePatch(patch)) return

    const id = pathToId(patch.path)
    const record =
      updatedObjects[id] || JSON.parse(JSON.stringify(store.get(id) || {}))

    switch (patch.action) {
      case "insert": {
        updatedObjects[id] = applyInsertToObject(patch, record)
        break
      }
      case "put":
        updatedObjects[id] = applyPutToObject(patch, record)
        break
      case "splice": {
        updatedObjects[id] = applySpliceToObject(patch, record)
        break
      }
      case "del": {
        const recordId = pathToId(patch.path)
        toRemove.push(recordId as TLRecord["id"])
        break
      }
      default: {
        if (isLegacyUpdatePatch(patch)) {
          updatedObjects[id] = applyLegacyUpdateToObject(patch, record)
        } else {
          console.log("Unsupported patch:", patch)
        }
      }
    }
  })
  const toPut = Object.values(updatedObjects)

  // put / remove the records in the store
  store.mergeRemoteChanges(() => {
    if (toRemove.length) store.remove(toRemove)
    if (toPut.length) store.put(toPut)
  })
}

const isStorePatch = (patch: StorePatch): patch is StorePatch & { path: AutomergeProp[] } => {
  return patch.path.length > 1 && patch.path[0] === "store"
}

// path: ["store", "camera:page:page", "x"] => "camera:page:page"
const pathToId = (path: AutomergeProp[]): RecordId<any> => {
  const raw = path[1]
  if (typeof raw !== "string") {
    throw new Error(`Invalid TLDraw record id in Automerge patch path: ${String(raw)}`)
  }
  return raw as RecordId<any>
}

const applyInsertToObject = (patch: InsertPatch, object: TLRecord): TLRecord => {
  const { path, values } = patch
  let current: any = object
  const insertionPoint = Number(path[path.length - 1])
  const listKey = path[path.length - 2]
  const parts = path.slice(2, -2)

  for (const part of parts) {
    if (current[part as any] === undefined) {
      throw new Error("Unable to apply Automerge insert patch: missing path segment")
    }
    current = current[part as any]
  }

  const existing = Array.isArray(current[listKey as any])
    ? current[listKey as any].slice()
    : []
  existing.splice(insertionPoint, 0, ...(values as any[]))
  current[listKey as any] = existing
  return object
}

const applyPutToObject = (patch: PutPatch, object: TLRecord): TLRecord => {
  const { path, value } = patch
  let current: any = object
  // special case
  if (path.length === 2) {
    // this would be creating the object, but we have done
    return object
  }

  const parts = path.slice(2, -2)
  const property = path[path.length - 1]
  const target = path[path.length - 2]

  if (path.length === 3) {
    return { ...object, [property as any]: value }
  }

  // default case
  for (const part of parts) {
    current = current[part as any]
  }
  current[target as any] = { ...current[target as any], [property as any]: value }
  return object
}

const applyLegacyUpdateToObject = (
  patch: LegacyUpdatePatch,
  object: TLRecord
): TLRecord => {
  const { path, value } = patch
  let current: any = object
  const parts = path.slice(2, -1)
  const pathEnd = path[path.length - 1]
  for (const part of parts) {
    if (current[part as any] === undefined) {
      throw new Error("Unable to apply Automerge update patch: missing path segment")
    }
    current = current[part as any]
  }
  current[pathEnd as any] = value
  return object
}

const applySpliceToObject = (
  patch: SpliceTextPatch,
  object: TLRecord
): TLRecord => {
  const { path, value } = patch
  let current: any = object
  const insertionPoint = Number(path[path.length - 1])
  const pathEnd = path[path.length - 2]
  const parts = path.slice(2, -2)
  for (const part of parts) {
    if (current[part as any] === undefined) {
      throw new Error("Unable to apply Automerge splice patch: missing path segment")
    }
    current = current[part as any]
  }
  if (insertionPoint !== 0) {
    throw new Error("Splices are not supported yet")
  }
  current[pathEnd as any] = value
  return object
}

function isLegacyUpdatePatch(patch: StorePatch): patch is LegacyUpdatePatch {
  return patch.action === "update"
}
