import { createTLStore, loadSnapshot } from "tldraw"
import type { RecordsDiff, TLRecord } from "tldraw"
import { describe, expect, it } from "vitest"

import { getDefaultStoreSnapshot } from "../src/default_store.js"
import { applyTLStoreChangesToAutomerge } from "../src/TLStoreToAutomerge.js"
import { cloneSnapshot } from "../src/utils.js"

const PAGE_ID = "page:page" as TLRecord["id"]
const DOCUMENT_ID = "document:document" as TLRecord["id"]
const POINTER_ID = "pointer:pointer" as TLRecord["id"]

describe("store snapshot utilities", () => {
  it("getDefaultStoreSnapshot returns populated snapshot", () => {
    const snapshot = getDefaultStoreSnapshot()
    const records = snapshot.store
    const recordIds = Object.keys(records)
    const recordValues = Object.values(records) as TLRecord[]
    const recordTypes = recordValues.reduce<Record<string, number>>((acc, record) => {
      acc[record.typeName] = (acc[record.typeName] ?? 0) + 1
      return acc
    }, {})

    expect(recordIds).toContain(DOCUMENT_ID)
    expect(recordIds).toContain(PAGE_ID)
    expect(snapshot.schema?.schemaVersion).toBeTruthy()
    if (snapshot.schema?.schemaVersion === 1) {
      expect("storeVersion" in snapshot.schema).toBe(true)
    } else {
      const sequences = (snapshot.schema as { sequences?: Record<string, number> }).sequences
      expect(sequences && Object.keys(sequences).length > 0).toBe(true)
    }

    const page = records[PAGE_ID] as TLRecord & { name?: string }
    expect(page).toBeDefined()
    expect(page.name).toBeTruthy()
    expect(recordTypes.document ?? 0).toBe(1)
    expect(recordTypes.page ?? 0).toBe(1)
  })

  it("cloneSnapshot returns a deep clone", () => {
    const snapshot = getDefaultStoreSnapshot()
    const cloned = cloneSnapshot(snapshot)

    const clonedPage = cloned.store[PAGE_ID] as TLRecord & { name?: string }
    clonedPage.name = "Changed name"

    const originalPage = snapshot.store[PAGE_ID] as TLRecord & { name?: string }
    expect(originalPage.name).not.toBe("Changed name")
  })

  it("getDefaultStoreSnapshot returns a fresh clone each time", () => {
    const first = getDefaultStoreSnapshot()
    const firstPage = first.store[PAGE_ID] as TLRecord & { name?: string }
    const originalName = firstPage.name
    firstPage.name = "Changed name"

    const second = getDefaultStoreSnapshot()
    const secondPage = second.store[PAGE_ID] as TLRecord & { name?: string }

    expect(firstPage.name).toBe("Changed name")
    expect(secondPage.name).toBe(originalName)
  })

  it("loadSnapshotIntoStore populates TL store records", () => {
    const store = createTLStore({})
    const before = store.getStoreSnapshot()

    loadSnapshot(store, getDefaultStoreSnapshot())

    const after = store.getStoreSnapshot()
    const afterRecords = after.store

    expect(Object.keys(before.store)).toHaveLength(0)
    expect(Object.keys(after.store).length).toBeGreaterThan(0)
    expect(afterRecords[DOCUMENT_ID]).toBeDefined()
    expect(afterRecords[PAGE_ID]).toBeDefined()
  })

  it("applyTLStoreChangesToAutomerge updates snapshots", () => {
    const snapshot = getDefaultStoreSnapshot()
    const records = snapshot.store
    const originalDocument = records[DOCUMENT_ID]
    const pointer = records[POINTER_ID]

    const updatedDocument = {
      ...originalDocument,
      name: "Updated document name",
    }

    const added: Record<string, TLRecord> = {}
    const removed: Record<string, TLRecord> = pointer ? { [pointer.id]: pointer } : {}
    const updated: Record<string, [TLRecord, TLRecord]> = {
      [originalDocument.id]: [originalDocument, updatedDocument],
    }

    const changes: RecordsDiff<TLRecord> = {
      added,
      removed,
      updated,
    }

    const doc = cloneSnapshot(snapshot)

    applyTLStoreChangesToAutomerge(doc, changes)

    const mutatedDocument = doc.store[DOCUMENT_ID] as TLRecord & { name?: string }
    expect(mutatedDocument.name).toBe("Updated document name")
    if (pointer) {
      expect(doc.store[pointer.id]).toBeUndefined()
    }
  })
})
