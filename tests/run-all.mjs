// npm test: online multiplayer suites (real server core on an in-memory store, then two real browsers), logic suites (jsdom), theme contrast audit, then the real-browser layout regression suites.
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
import { serve } from './layout/serve.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const { srv, base } = await serve(root);
const runs = [['node', ['../tools/sync-edge-shared.mjs', '--check']], ['node', ['online/rooms.mjs']], ['node', ['online/game.mjs']], ['node', ['online/security.mjs']], ['node', ['online/validator.mjs']], ['node', ['online/validator-unavailable.mjs']], ['node', ['online/policy.mjs']], ['node', ['online/network.mjs']], ['node', ['online/endgame.mjs']], ['node', ['online/browser.mjs']],
  ['python3', ['contrast.py']], ['node', ['../tools/validate-dictionary.mjs']], ['node', ['logic/validator.mjs']], ['node', ['logic/grammar.mjs']], ['node', ['logic/bank.mjs']], ['node', ['logic/engine.mjs']], ['node', ['logic/validation-flow.mjs']], ['node', ['logic/validation-fallback.mjs']], ['node', ['logic/startup.mjs']],
  ['node', ['layout/validation-browser.mjs']], ['node', ['layout/history-toggle.mjs']], ['node', ['layout/history-toggle-extra.mjs', 'a']], ['node', ['layout/history-toggle-extra.mjs', 'b']]];
// Optional filter: `node run-all.mjs "extra.mjs b"` runs only the suites whose command line contains that text.
const only = process.argv[2];
let bad = 0;
for (const [cmd, args] of runs.filter(([c, a]) => !only || `${c} ${a.join(' ')}`.includes(only))) {
  console.log(`\n=== ${cmd} ${args.join(' ')}`);
  // async spawn on purpose: spawnSync would block this process's event loop, and with it the static server the browser needs
  const code = await new Promise(res => spawn(cmd, args, { cwd: here, stdio: 'inherit', env: { ...process.env, BASE: base } }).on('close', res)); if (code) bad++;
}
srv.close(); console.log(bad ? `\n${bad} suite(s) FAILED` : '\nALL SUITES PASSED'); process.exit(bad ? 1 : 0);
