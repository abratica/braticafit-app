// Looks up each Precision Nutrition Vimeo video's length and thumbnail (Vimeo oEmbed) and writes data/pn-media.json
// as { "<vimeo id>": [seconds, thumbnailUrl] }. Resumable: ids already in the file are skipped.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const cat = JSON.parse(readFileSync("data/pn.json", "utf8"));
const out = existsSync("data/pn-media.json") ? JSON.parse(readFileSync("data/pn-media.json", "utf8")) : {};
const ids = [...new Set(cat.items.flatMap((e) => [e.men, e.women]).filter(Boolean))].filter((id) => !out[id]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`${ids.length} to look up, ${Object.keys(out).length} already done`);

let fails = 0;
for (const [i, id] of ids.entries()) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent("https://vimeo.com/" + id)}`);
    if (r.status === 429 || r.status >= 500) { await sleep(15000 * (attempt + 1)); continue; }
    if (!r.ok) { console.log(`skip ${id}: ${r.status}`); fails++; break; }
    const j = await r.json();
    out[id] = [j.duration || 0, (j.thumbnail_url || "").replace(/_\d+x\d+(\?|$)/, "_640x360$1")];
    break;
  }
  if (i % 50 === 49) { writeFileSync("data/pn-media.json", JSON.stringify(out)); console.log(`${i + 1}/${ids.length}`); }
  await sleep(400);
}
writeFileSync("data/pn-media.json", JSON.stringify(out));
console.log(`done: ${Object.keys(out).length} with media, ${fails} skipped`);
