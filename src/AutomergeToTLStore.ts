import { TLRecord, RecordId, TLStore } from "tldraw"
import type {
  Patch,
  Prop as AutomergeProp,
  InsertPatch,
  PutPatch,
  SpliceTextPatch,
} from "@automerge/automerge"

type MutableContainer = Record<string, unknown>

export function applyAutomergePatchesToTLStore(
  patches: Patch[],
  store: TLStore
) {
  const toRemove: TLRecord["id"][] = []
  const updatedObjects: { [id: string]: TLRecord } = {}

  patches.forEach((patch) => {
    if (!isStorePatch(patch)) return

    const id = pathToId(patch.path)
    let record = updatedObjects[id]
    if (!record) {
      const existing = store.get(id)
      record = existing ? cloneRecord(existing) : ({} as TLRecord)
    }

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
        throw new Error(`Unsupported Automerge patch action: ${patch.action}`)
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

const isStorePatch = (patch: Patch): patch is Patch & { path: AutomergeProp[] } => {
  return Array.isArray(patch.path) && patch.path.length > 1 && patch.path[0] === "store"
}

// path: ["store", "camera:page:page", "x"] => "camera:page:page"
const pathToId = (path: AutomergeProp[]): RecordId<any> => {
  const raw = path[1]
  if (typeof raw !== "string") {
    throw new Error(`Invalid TLDraw record id in Automerge patch path: ${String(raw)}`)
  }
  return raw as RecordId<any>
}

const cloneRecord = (record: TLRecord): TLRecord =>
  JSON.parse(JSON.stringify(record)) as TLRecord

const toKey = (segment: AutomergeProp): string => {
  if (typeof segment === "string" || typeof segment === "number") {
    return String(segment)
  }
  throw new Error(`Invalid Automerge patch segment: ${String(segment)}`)
}

const ensureContainer = (value: unknown): MutableContainer => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Unable to apply Automerge patch: missing path segment")
  }
  return value as MutableContainer
}

const getContainer = (record: TLRecord, parts: AutomergeProp[]): MutableContainer => {
  if (parts.length === 0) {
    return ensureContainer(record)
  }

  let current: unknown = record
  for (const part of parts) {
    const container = ensureContainer(current)
    const key = toKey(part)
    if (!(key in container)) {
      throw new Error("Unable to apply Automerge patch: missing path segment")
    }
    current = container[key]
  }

  return ensureContainer(current)
}

const applyInsertToObject = (patch: InsertPatch, object: TLRecord): TLRecord => {
  const { path, values } = patch
  const insertionPointRaw = path[path.length - 1]
  const insertionPoint = typeof insertionPointRaw === "number"
    ? insertionPointRaw
    : Number(insertionPointRaw)
  if (!Number.isInteger(insertionPoint)) {
    throw new Error("Unable to apply Automerge insert patch: invalid index")
  }

  const listKey = toKey(path[path.length - 2])
  const container = getContainer(object, path.slice(2, -2))
  const existing = container[listKey]
  const nextValues = Array.isArray(existing) ? [...existing] : []
  nextValues.splice(insertionPoint, 0, ...values)
  container[listKey] = nextValues
  return object
}

const applyPutToObject = (patch: PutPatch, object: TLRecord): TLRecord => {
  const { path, value } = patch
  if (path.length === 2) {
    return value as TLRecord
  }

  const propertyKey = toKey(path[path.length - 1])
  const container = getContainer(object, path.slice(2, -1))
  container[propertyKey] = value
  return object
}

const applySpliceToObject = (
  patch: SpliceTextPatch,
  object: TLRecord
): TLRecord => {
  const { path, value } = patch
  const insertionPointRaw = path[path.length - 1]
  const insertionPoint = typeof insertionPointRaw === "number"
    ? insertionPointRaw
    : Number(insertionPointRaw)
  if (insertionPoint !== 0) {
    throw new Error("Splices are not supported yet")
  }
  const propertyKey = toKey(path[path.length - 2])
  const container = getContainer(object, path.slice(2, -2))
  container[propertyKey] = value
  return object
}
