import { Repo } from "@automerge/automerge-repo"
import { Schema } from "prosemirror-model"
import { createTLStore, defaultShapeUtils, loadSnapshot } from "tldraw"
import type { RecordsDiff, TLRecord, TLStoreSnapshot } from "tldraw"
import { describe, expect, it } from "vitest"

import { getDefaultStoreSnapshot } from "../src/default_store.js"
import { applyTLStoreChangesToAutomerge } from "../src/TLStoreToAutomerge.js"
import { cloneSnapshot } from "../src/utils.js"

const PAGE_ID = "page:page" as TLRecord["id"]
const SHAPE_ID = "shape:labelled" as TLRecord["id"]

/**
 * Real prosemirror-model rather than a hand-rolled `Object.create(null)`, so
 * this keeps tracking whatever ProseMirror actually emits.
 */
function richTextFromProseMirror(text: string) {
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+", attrs: { dir: { default: "auto" } } },
      paragraph: { content: "text*", attrs: { dir: { default: "auto" } } },
      text: {},
    },
  })

  const paragraph = schema.node(
    "paragraph",
    null,
    text ? [schema.text(text)] : []
  )

  return schema.node("doc", null, [paragraph]).toJSON()
}

/** A real Automerge doc, seeded the way `init` seeds one. */
function automergeDoc() {
  const repo = new Repo({})
  const handle = repo.create<TLStoreSnapshot>()
  handle.change((doc) => {
    Object.assign(doc, getDefaultStoreSnapshot())
  })

  return {
    read: () => handle.doc() as TLStoreSnapshot,
    apply: (changes: RecordsDiff<TLRecord>) =>
      handle.change((doc) => applyTLStoreChangesToAutomerge(doc, changes)),
  }
}

/** A text shape with tldraw's own default props and the given rich text. */
function textShape(richText: unknown): TLRecord {
  const util = defaultShapeUtils.find((u) => u.type === "text")!
  const props = (
    util.prototype as unknown as {
      getDefaultProps(): Record<string, unknown>
    }
  ).getDefaultProps()

  return {
    id: SHAPE_ID,
    typeName: "shape",
    type: "text",
    parentId: PAGE_ID,
    index: "a1",
    x: 300,
    y: 252,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {},
    props: { ...props, richText },
  } as unknown as TLRecord
}

const added = (record: TLRecord): RecordsDiff<TLRecord> => ({
  added: { [record.id]: record },
  updated: {},
  removed: {},
})

describe("Automerge representability", () => {
  it("writes a record whose rich text came from ProseMirror", () => {
    const richText = richTextFromProseMirror("HELLO") as {
      attrs: Record<string, unknown>
    }
    // The premise. If it stops holding, the guard can be revisited.
    expect(Object.getPrototypeOf(richText.attrs)).toBeNull()

    const record = textShape(richText)
    const doc = automergeDoc()
    expect(() => doc.apply(added(record))).not.toThrow()

    const stored = doc.read().store[SHAPE_ID] as TLRecord & {
      props: { richText: unknown }
    }
    expect(JSON.stringify(stored.props.richText)).toContain("HELLO")
  })

  it("keeps persisting later edits to a record that has rich text", () => {
    const created = textShape(richTextFromProseMirror(""))
    const doc = automergeDoc()
    doc.apply(added(created))

    // Label and reposition in one rewrite: a rejected `richText` takes x/y too.
    const edited = {
      ...(created as unknown as Record<string, unknown>),
      x: 437,
      y: 161,
      props: {
        ...(created as unknown as { props: Record<string, unknown> }).props,
        richText: richTextFromProseMirror(`12'-6"`),
      },
    } as unknown as TLRecord

    doc.apply({
      added: {},
      updated: { [SHAPE_ID]: [created, edited] },
      removed: {},
    })

    const stored = doc.read().store[SHAPE_ID] as TLRecord & {
      x: number
      y: number
      props: { richText: unknown }
    }
    expect(stored.x).toBe(437)
    expect(stored.y).toBe(161)
    expect(JSON.stringify(stored.props.richText)).toContain("12'-6")
  })

  it("drops undefined values, which Automerge also rejects", () => {
    const record = textShape(richTextFromProseMirror("HELLO")) as TLRecord & {
      meta: Record<string, unknown>
    }
    record.meta = { note: undefined }

    const doc = automergeDoc()
    expect(() => doc.apply(added(record))).not.toThrow()

    const stored = doc.read().store[SHAPE_ID] as TLRecord & {
      meta: Record<string, unknown>
    }
    expect("note" in stored.meta).toBe(false)
  })

  it("round-trips through cloneSnapshot back into a TLDraw store", () => {
    const doc = automergeDoc()
    doc.apply(added(textShape(richTextFromProseMirror("HELLO"))))

    const reopened = createTLStore({})
    loadSnapshot(reopened, cloneSnapshot(doc.read()))

    const shape = reopened.get(SHAPE_ID) as TLRecord & {
      props: { richText: unknown }
    }
    expect(shape).toBeDefined()
    expect(JSON.stringify(shape.props.richText)).toContain("HELLO")
  })
})
