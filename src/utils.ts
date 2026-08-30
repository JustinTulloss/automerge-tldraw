import { type TLStoreSnapshot } from "tldraw";

const jsonClone = (s: TLStoreSnapshot) =>  JSON.parse(JSON.stringify(s))
export const cloneSnapshot: (snapshot: TLStoreSnapshot) => TLStoreSnapshot =
  typeof structuredClone === "function" ?
  structuredClone<TLStoreSnapshot> :
  jsonClone

/**
 * JSON with object keys sorted, so comparisons ignore key order (Automerge
 * returns maps with sorted keys; tldraw serializes in insertion order).
 */
export const canonicalJson = (value: unknown): string => {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, entry]) => [k, sort(entry)])
      )
    }
    return v
  }
  return JSON.stringify(sort(value))
}
