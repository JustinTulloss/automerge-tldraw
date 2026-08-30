import { Repo } from "@automerge/automerge-repo"
import { createTLStore, loadSnapshot } from "tldraw"
import type { TLRecord, TLStoreSnapshot } from "tldraw"
import { describe, expect, it } from "vitest"

import { getDefaultStoreSnapshot } from "../src/default_store.js"
import { writeSnapshotToAutomerge } from "../src/TLStoreToAutomerge.js"
import { canonicalJson } from "../src/utils.js"

const PAGE_ID = "page:page" as TLRecord["id"]
const STALE_ID = "shape:stale" as TLRecord["id"]

function seededHandle() {
  const repo = new Repo({})
  const handle = repo.create<TLStoreSnapshot>()
  handle.change((doc) => {
    Object.assign(doc, getDefaultStoreSnapshot())
  })
  return handle
}

describe("writeSnapshotToAutomerge", () => {
  it("replaces records, deletes stale ones, and updates the schema", () => {
    const handle = seededHandle()
    // A record the migrated snapshot no longer contains.
    handle.change((doc) => {
      doc.store[STALE_ID] = {
        id: STALE_ID,
        typeName: "shape",
      } as TLRecord
    })

    const migrated = getDefaultStoreSnapshot()
    handle.change((doc) => writeSnapshotToAutomerge(doc, migrated))

    const doc = handle.doc() as TLStoreSnapshot
    expect(doc.store[STALE_ID]).toBeUndefined()
    expect(Object.keys(doc.store).sort()).toEqual(
      Object.keys(migrated.store).sort()
    )
    expect(canonicalJson(doc.schema)).toEqual(canonicalJson(migrated.schema))
    // Automerge sorts map keys, so plain stringify comparison would see every
    // load as a schema change; the hook must use the canonical form.
    expect(JSON.stringify(doc.schema)).not.toEqual(
      JSON.stringify(migrated.schema)
    )
  })

  it("produces a doc that loadSnapshot accepts", () => {
    const handle = seededHandle()
    const migrated = getDefaultStoreSnapshot()
    handle.change((doc) => writeSnapshotToAutomerge(doc, migrated))

    const store = createTLStore({})
    const persisted = JSON.parse(
      JSON.stringify(handle.doc())
    ) as TLStoreSnapshot
    expect(() => loadSnapshot(store, persisted)).not.toThrow()
    expect(store.get(PAGE_ID)).toBeDefined()
  })
})
