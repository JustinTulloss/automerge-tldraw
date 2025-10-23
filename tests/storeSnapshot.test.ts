import { createTLStore } from "tldraw"
import type { TLRecord, TLStore, TLStoreSnapshot } from "tldraw"

import { getDefaultStoreSnapshot } from "../src/default_store"
import { applyTLStoreChangesToAutomerge } from "../src/TLStoreToAutomerge"

function cloneSnapshot(snapshot: TLStoreSnapshot): TLStoreSnapshot {
  return JSON.parse(JSON.stringify(snapshot))
}

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
  const records = snapshot.store as Record<string, TLRecord>
  const recordIds = Object.keys(records)
  const recordTypes = Object.values(records).reduce<Record<string, number>>(
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
  const page = records["page:page"] as { name?: string }
  assert(page?.name)
  assertEqual(recordTypes.document ?? 0, 1)
  assertEqual(recordTypes.page ?? 0, 1)
})

test("cloneSnapshot returns a deep clone", () => {
  const snapshot = getDefaultStoreSnapshot()
  const cloned = cloneSnapshot(snapshot)

  const cloneRecords = cloned.store as Record<string, { name?: string }>
  cloneRecords["page:page"].name = "Changed name"

  const originalRecords = snapshot.store as Record<string, { name?: string }>
  assertNotEqual(originalRecords["page:page"].name, "Changed name")
})

test("getDefaultStoreSnapshot returns a fresh clone each time", () => {
  const first = getDefaultStoreSnapshot()
  const firstRecords = first.store as Record<string, { name?: string }>
  const originalName = firstRecords["page:page"].name
  firstRecords["page:page"].name = "Changed name"

  const second = getDefaultStoreSnapshot()
  const secondRecords = second.store as Record<string, { name?: string }>

  assertEqual(firstRecords["page:page"].name, "Changed name")
  assertEqual(secondRecords["page:page"].name, originalName)
})

test("loadSnapshotIntoStore populates TL store records", () => {
  const store = createTLStore({}) as TLStore
  const before = store.getSnapshot()

  store.loadSnapshot(getDefaultStoreSnapshot())

  const after = store.getSnapshot()
  const afterRecords = after.store as Record<string, TLRecord>

  assertEqual(Object.keys(before.store).length, 0)
  assert(Object.keys(after.store).length > 0)
  assert(afterRecords["document:document"])
  assert(afterRecords["page:page"])
})

test("applyTLStoreChangesToAutomerge updates snapshots", () => {
  const snapshot = getDefaultStoreSnapshot()
  const records = snapshot.store as Record<string, TLRecord>
  const originalDocument = records["document:document"]
  const pointer = records["pointer:pointer"]

  const updatedDocument = {
    ...originalDocument,
    name: "Updated document name",
  }

  const changes = {
    added: {} as Record<string, TLRecord>,
    removed: pointer ? { [pointer.id]: pointer } : {},
    updated: {
      [originalDocument.id]: [
        originalDocument,
        updatedDocument,
      ] as unknown as [TLRecord, TLRecord],
    },
  }

  const doc = { store: JSON.parse(JSON.stringify(snapshot.store)) as Record<string, TLRecord> }

  applyTLStoreChangesToAutomerge(doc, changes)

  const mutatedRecords = doc.store as Record<string, { name?: string }>
  assertEqual(mutatedRecords["document:document"].name, "Updated document name")
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

const proc: any = (globalThis as any)?.process

run()
  .then(() => {
    console.log("All tests passed")
    if (proc?.exit) {
      proc.exit(0)
    }
  })
  .catch((error) => {
    console.error(error)
    if (proc?.exit) {
      proc.exit(1)
    } else {
      throw error
    }
  })
