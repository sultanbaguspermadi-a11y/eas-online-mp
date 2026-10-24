// Regenerates baseline.json: the layout of the app BEFORE the history-toggle feature (commit 53ff300).
// Serve that older checkout and run:  BASE=http://localhost:PORT node baseline.mjs
import fs from 'fs';
import { launch, openGame, seedHistory, geometry, closeGame, VIEWPORTS } from './lib.mjs';
const b = await launch(); const out = {};
for (const [name, vp] of Object.entries(VIEWPORTS)) {
  const { page, errors } = await openGame(b, vp); await seedHistory(page);
  await page.evaluate(() => document.activeElement?.blur());
  out[name] = await geometry(page);
  console.log(name, 'errors:', errors.length, 'hist items:', await page.$$eval('#hList .hi', n => n.length), 'rack0', JSON.stringify(out[name]['.rack'][0]), 'hist', JSON.stringify(out[name]['.hist'][0]));
  await closeGame(page);
}
fs.writeFileSync(new URL('./baseline.json', import.meta.url), JSON.stringify(out)); await b.close();
