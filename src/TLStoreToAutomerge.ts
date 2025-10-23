import { RecordsDiff, TLRecord, TLStoreSnapshot } from "tldraw"

export function applyTLStoreChangesToAutomerge(
  doc: TLStoreSnapshot,
  changes: RecordsDiff<TLRecord>
): void {
  const store = doc.store

  for (const record of Object.values(changes.added) as TLRecord[]) {
    store[record.id] = record
  }

  for (const [, record] of Object.values(changes.updated) as Array<[
    TLRecord,
    TLRecord,
  ]>) {
    store[record.id] = record
  }

  for (const record of Object.values(changes.removed) as TLRecord[]) {
    delete store[record.id]
  }
}
