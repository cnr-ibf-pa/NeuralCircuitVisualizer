// Lazy gid -> vertex-index lookup (built on first use after each network rebuild).
import { state } from "./state.js";

export function getGidIndexMap() {
  if (!state.gidIndexMap) {
    const map = new Map();
    const ids = state.gIDs;
    for (let i = 0; i < ids.length; i++) map.set(ids[i], i);
    state.gidIndexMap = map;
  }
  return state.gidIndexMap;
}
