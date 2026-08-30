import { RecordsDiff, TLRecord, TLStoreSnapshot } from "tldraw"

/**
 * `props.richText` is ProseMirror's `toJSON()`, whose node `attrs` have a null
 * prototype. Automerge only hydrates `Object.prototype`-rooted objects and
 * throws `RangeError: invalid value` otherwise, discarding the whole enclosing
 * `change()`. Since each update rewrites the entire record, one unrepresentable
 * `richText` stops a shape persisting anything at all — x/y included.
 *
 * `undefined` is rejected for the same reason, so it's dropped here too.
 */
function toAutomergeValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(toAutomergeValue) as T
  }

  const source = value as Record<string, unknown>
  const plain: Record<string, unknown> = {}

  for (const key of Object.keys(source)) {
    const entry = source[key]
    if (entry === undefined) continue
    plain[key] = toAutomergeValue(entry)
  }

  return plain as T
}

/**
 * Replace the doc's records and schema with a (migrated) snapshot. Used once
 * per schema upgrade, so the doc catches up to the running tldraw version and
 * incremental patches exchange current-schema records.
 */
export function writeSnapshotToAutomerge(
  doc: TLStoreSnapshot,
  snapshot: TLStoreSnapshot
): void {
  for (const id of Object.keys(doc.store)) {
    if (!(id in snapshot.store)) delete doc.store[id as TLRecord["id"]]
  }
  for (const record of Object.values(snapshot.store) as TLRecord[]) {
    doc.store[record.id] = toAutomergeValue(record)
  }
  doc.schema = toAutomergeValue(snapshot.schema)
}

export function applyTLStoreChangesToAutomerge(
  doc: TLStoreSnapshot,
  changes: RecordsDiff<TLRecord>
): void {
  const store = doc.store

  for (const record of Object.values(changes.added) as TLRecord[]) {
    store[record.id] = toAutomergeValue(record)
  }

  for (const [, record] of Object.values(changes.updated) as Array<[
    TLRecord,
    TLRecord,
  ]>) {
    store[record.id] = toAutomergeValue(record)
  }

  for (const record of Object.values(changes.removed) as TLRecord[]) {
    delete store[record.id]
  }
}
