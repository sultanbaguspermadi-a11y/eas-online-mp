// Read-only query side of the packed word automaton (see tools/lib/dawg-build.mjs for the format and the builder).
// A few MB of typed array answer exact lookups in microseconds and hold millions of words.

export const ALPHABET = Array.from({ length: 0x63A - 0x621 + 1 }, (_, i) => String.fromCharCode(0x621 + i))
  .concat(Array.from({ length: 0x64A - 0x641 + 1 }, (_, i) => String.fromCharCode(0x641 + i)));
const CODE = new Map(ALPHABET.map((c, i) => [c, i]));

export class Dawg {
  constructor(edges) { this.edges = edges; }

  static fromBuffer(buf) { return new Dawg(new Uint32Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf)); }

  get size() { return this.edges.length; }

  // Is `word` (strict spelling) in the set?
  has(word) {
    const E = this.edges;
    let block = 0, e = 0;
    for (let k = 0; k < word.length; k++) {
      const c = CODE.get(word[k]);
      if (c === undefined) return false;
      let i = block;
      for (;;) { if (i >= E.length) return false; e = E[i]; if ((e & 63) === c) break; if (e & 128) return false; i++; }   // bounds: a damaged file must never hang the game
      block = e >>> 8;
      if (k < word.length - 1 && block === 0) return false;
    }
    return word.length > 0 && (e & 64) !== 0;
  }

  // Basic-mode lookup: `word` is spelled with the 28 Basic letters, so each letter may stand for several real letters
  // (ا → أ إ آ ا, ه → ة ه, ي → ئ ى ي, و → ؤ و). `alts` maps a Basic letter to its candidate real letters.
  // The search walks only paths that exist in the automaton, so it stays tiny in practice.
  hasProjected(word, alts) {
    const E = this.edges, n = word.length;
    const cand = Array.from(word, ch => (alts[ch] || [ch]).map(x => CODE.get(x)).filter(x => x !== undefined));
    const rec = (block, pos) => {
      for (const c of cand[pos]) {
        let i = block;
        for (;;) {
          if (i >= E.length) break;
          const e = E[i];
          if ((e & 63) === c) {
            if (pos === n - 1) { if (e & 64) return true; }
            else { const child = e >>> 8; if (child && rec(child, pos + 1)) return true; }
            break;
          }
          if (e & 128) break;
          i++;
        }
      }
      return false;
    };
    return n > 0 && rec(0, 0);
  }

  // Iterate every word (used by tests and tools, not by the game).
  *words() {
    const E = this.edges, buf = [];
    const walk = function* (block) {
      for (let i = block; i < E.length; i++) {
        const e = E[i];
        buf.push(ALPHABET[e & 63]);
        if (e & 64) yield buf.join('');
        const child = e >>> 8;
        if (child) yield* walk(child);
        buf.pop();
        if (e & 128) return;
      }
    };
    if (E.length) yield* walk(0);
  }
}

// Basic letter -> real letters that Basic mode may stand for, derived from rules.json basic.projection.
export function projectionAlternatives(projection) {
  const alts = {};
  for (const [real, basic] of Object.entries(projection)) if (basic) (alts[basic] ||= [basic]).push(real);
  return alts;
}
