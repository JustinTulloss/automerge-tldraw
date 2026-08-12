import { type TLStoreSnapshot } from "tldraw";

const jsonClone = (s: TLStoreSnapshot) =>  JSON.parse(JSON.stringify(s))
export const cloneSnapshot: (snapshot: TLStoreSnapshot) => TLStoreSnapshot = 
  typeof structuredClone === "function" ?
  structuredClone<TLStoreSnapshot> :
  jsonClone
