// Builds a minimal acyclic deterministic word automaton (DAWG) from a SORTED, de-duplicated word list and packs it into
// a compact Uint32Array that js/dictionary/dawg.js can query without unpacking.   (Daciuk, Mihov, Watson, Watson 2000)
//
// Packed layout: edges of one node are contiguous; block 0 is the root.
//   bits  0..5   letter index (0..35)           bit 6  the word may END after this edge
//   bit   7      last edge of its node          bits 8..31  index of the first edge of the child node (0 = no children)
// A letter is encoded by ALPHABET order. All of Arabic letters U+0621–U+063A and U+0641–U+064A fit in 36 slots.



import { ALPHABET } from '../../js/dictionary/dawg.js';
export { ALPHABET };

export function buildDawg(sortedWords, onProgress) {
  const code = new Map(ALPHABET.map((c, i) => [c, i]));
  let nextId = 1;
  const register = new Map();
  const mk = () => ({ final: false, ch: [], to: [], id: 0 });
  const root = mk();
  const sig = n => { let s = n.final ? 'F' : 'N'; for (let i = 0; i < n.ch.length; i++) s += ',' + n.ch[i] + ':' + n.to[i].id; return s; };
  const reg = n => { const s = sig(n); const hit = register.get(s); if (hit) return hit; n.id = nextId++; register.set(s, n); return n; };

  // path[k] = node reached after k letters of the previous word
  const path = [root];
  let prev = [];
  let count = 0;
  const minimize = depth => {
    for (let k = prev.length; k > depth; k--) {
      const child = path[k], parent = path[k - 1];
      parent.to[parent.to.length - 1] = reg(child);
    }
    path.length = depth + 1;
  };
  for (const w of sortedWords) {
    const cur = [...w].map(c => code.get(c));
    let cp = 0; const m = Math.min(cur.length, prev.length);
    while (cp < m && cur[cp] === prev[cp]) cp++;
    minimize(cp);
    let node = path[cp];
    for (let k = cp; k < cur.length; k++) { const n = mk(); node.ch.push(cur[k]); node.to.push(n); path.push(n); node = n; }
    node.final = true;
    prev = cur;
    if (onProgress && ++count % 500000 === 0) onProgress(count, register.size);
  }
  minimize(0);
  root.id = 0;

  // Pack: depth-first from the root so that frequently shared sub-automata are laid out once.
  const order = [], seen = new Map();
  const visit = n => { if (seen.has(n)) return; seen.set(n, -1); for (const c of n.to) visit(c); order.push(n); };
  // iterative post-order to avoid deep recursion on long words
  const stack = [[root, 0]]; seen.set(root, -1);
  while (stack.length) {
    const top = stack[stack.length - 1], [n, i] = top;
    if (i < n.to.length) { top[1]++; const c = n.to[i]; if (!seen.has(c)) { seen.set(c, -1); stack.push([c, 0]); } }
    else { order.push(n); stack.pop(); }
  }
  // root first, then everything else; block start = running sum of edge counts
  const nodes = [root, ...order.filter(n => n !== root && n.ch.length > 0)];
  let total = 0; for (const n of nodes) { seen.set(n, total); total += n.ch.length; }
  if (total >= 1 << 24) throw new Error(`too many edges (${total}) for the 24-bit child index`);
  const out = new Uint32Array(total);
  for (const n of nodes) {
    const base = seen.get(n);
    for (let i = 0; i < n.ch.length; i++) {
      const c = n.to[i];
      const child = c.ch.length ? seen.get(c) : 0;
      out[base + i] = (n.ch[i] | (c.final ? 64 : 0) | (i === n.ch.length - 1 ? 128 : 0) | (child << 8)) >>> 0;
    }
  }
  return { edges: out, nodes: nodes.length, words: count };
}
