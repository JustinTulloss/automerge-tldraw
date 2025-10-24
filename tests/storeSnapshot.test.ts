import { createTLStore, getSnapshot, loadSnapshot } from "tldraw"
import type { RecordsDiff, TLRecord, TLStoreSnapshot } from "tldraw"

import { getDefaultStoreSnapshot } from "../src/default_store"
import { applyTLStoreChangesToAutomerge } from "../src/TLStoreToAutomerge"

const cloneSnapshot = (snapshot: TLStoreSnapshot): TLStoreSnapshot =>
  typeof structuredClone === "function"
    ? structuredClone(snapshot)
    : JSON.parse(JSON.stringify(snapshot))

const PAGE_ID = "page:page" as TLRecord["id"]
const DOCUMENT_ID = "document:document" as TLRecord["id"]
const POINTER_ID = "pointer:pointer" as TLRecord["id"]

type TestFn = () => void | Promise<void>
const tests: { name: string; fn: TestFn }[] = []

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? "Assertion failed")
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ?? `Assertion failed: expected ${String(actual)} to equal ${String(expected)}`,
    )
  }
}

function assertNotEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual === expected) {
    throw new Error(
      message ?? `Assertion failed: expected ${String(actual)} to not equal ${String(expected)}`,
    )
  }
}

function test(name: string, fn: TestFn) {
  tests.push({ name, fn })
}

test("getDefaultStoreSnapshot returns populated snapshot", () => {
  const snapshot = getDefaultStoreSnapshot()
  const records = snapshot.store
  const recordIds = Object.keys(records)
  const recordValues = Object.values(records) as TLRecord[]
  const recordTypes = recordValues.reduce<Record<string, number>>(
    (acc, record) => {
      acc[record.typeName] = (acc[record.typeName] ?? 0) + 1
      return acc
    },
    {},
  )

  assert(recordIds.includes("document:document"))
  assert(recordIds.includes("page:page"))
  assert(snapshot.schema?.schemaVersion)
  assert(snapshot.schema?.storeVersion)
  const page = records[PAGE_ID]
  assert(page)
  assert((page as { name?: string }).name)
  assertEqual(recordTypes.document ?? 0, 1)
  assertEqual(recordTypes.page ?? 0, 1)
})

test("cloneSnapshot returns a deep clone", () => {
  const snapshot = getDefaultStoreSnapshot()
  const cloned = cloneSnapshot(snapshot)

  const cloneRecords = cloned.store
  const clonedPage = cloneRecords[PAGE_ID] as TLRecord & { name?: string }
  clonedPage.name = "Changed name"

  const originalPage = snapshot.store[PAGE_ID] as TLRecord & { name?: string }
  assertNotEqual(originalPage.name, "Changed name")
})

test("getDefaultStoreSnapshot returns a fresh clone each time", () => {
  const first = getDefaultStoreSnapshot()
  const firstRecords = first.store
  const firstPage = firstRecords[PAGE_ID] as TLRecord & { name?: string }
  const originalName = firstPage.name
  firstPage.name = "Changed name"

  const second = getDefaultStoreSnapshot()
  const secondRecords = second.store
  const secondPage = secondRecords[PAGE_ID] as TLRecord & { name?: string }

  assertEqual(firstPage.name, "Changed name")
  assertEqual(secondPage.name, originalName)
})

test("loadSnapshotIntoStore populates TL store records", () => {
  const store = createTLStore({})
  const before = getSnapshot(store)

  loadSnapshot(store, getDefaultStoreSnapshot())

  const after = getSnapshot(store)
  const afterRecords = after.store

  assertEqual(Object.keys(before.store).length, 0)
  assert(Object.keys(after.store).length > 0)
  assert(afterRecords[DOCUMENT_ID])
  assert(afterRecords[PAGE_ID])
})

test("applyTLStoreChangesToAutomerge updates snapshots", () => {
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
  assertEqual(mutatedDocument.name, "Updated document name")
  if (pointer) {
    assertEqual(doc.store[pointer.id], undefined)
  }
})

async function run() {
  let failed = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`PASS ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    }
  }

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`)
  }
}

run()
  .then(() => {
    console.log("All tests passed")
  })
  .catch((error) => {
    console.error(error)
    const maybeProcess = (globalThis as {
      process?: { exit(code?: number): never }
    }).process
    if (maybeProcess?.exit) {
      maybeProcess.exit(1)
    } else {
      throw error
    }
  })
