// Runtime side of the mined lexicon (tools/mine-bank.mjs → tools/build-mined.mjs).
// The mined stems are expanded by the morphology rules at BUILD time and stored as small word automata, one per (class, attach kind).
// MinedIndex answers the same two questions as the in-memory index (bare form? alternate stem?), so the clitic grammar works on it
// unchanged, but costs a few hundred KB instead of tens of MB of Map entries.
import { Dawg } from './dawg.js';

export function parseMined(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hlen)));
  const start = (4 + hlen + 3) & ~3;                                   // blobs are 4-byte aligned
  const blob = bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + bytes.byteLength);
  const edges = ([off, len]) => new Dawg(new Uint32Array(blob, off * 4, len));
  return header.groups.map(g => ({ c: g.c, k: g.k, t: g.t, bare: edges(g.bare), alt: g.alt ? edges(g.alt) : null }));
}

export class MinedIndex {
  constructor(groups, { basic = false, alts = null } = {}) {
    this.groups = groups;
    this.has = basic ? (d, key) => d.hasProjected(key, alts) : (d, key) => d.has(key);
    this.bare = { get: key => this.#find(key, 'bare') };
    this.alt = { get: key => this.#find(key, 'alt') };
  }
  #find(key, which) {
    let out;
    for (const g of this.groups) {
      const d = g[which];
      if (d && this.has(d, key)) (out ||= []).push({ f: key, l: null, t: g.t, c: g.c, k: g.k });
    }
    return out;
  }
}
