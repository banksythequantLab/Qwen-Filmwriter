// agent/season.mjs — the STUDIO VAULT. A showrunner doesn't run a film, it runs a SHOW: this
// persists a finished film's cast (canon-audited character anchors + their locked wardrobe) so the
// next episode stars the SAME actors — same face, same wardrobe lock — instead of re-casting from
// scratch. Reusing a vault anchor also skips the whole anchor-generation/refinement spend.
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";

const VAULT_ROOT = process.env.QWEN_VAULT_DIR || "output/seasons";
export function vaultPath(name) { return path.resolve(VAULT_ROOT, String(name).trim().replace(/[^\w-]+/g, "_").slice(0, 40) || "untitled"); }

// Save/refresh a season after a finished film. localRefByName maps character name -> the LOCAL png
// path of the anchor used this run (freshly downloaded, or the vault file itself when reused).
export function saveCast(name, { storyState, localRefByName = {}, style = "", title = "" } = {}) {
  const dir = vaultPath(name);
  mkdirSync(dir, { recursive: true });
  const cast = [];
  let i = 0;
  for (const c of (storyState?.characters || [])) {
    const src = localRefByName[c.name];
    if (!src || !existsSync(src)) continue;
    const dst = path.join(dir, `cast_${i}.png`);
    if (path.resolve(src) !== path.resolve(dst)) copyFileSync(src, dst);
    cast.push({ name: c.name, appearance: c.appearance || "", locked: c.locked || [], ref: `cast_${i}.png` });
    i++;
  }
  const season = { name, updated: new Date().toISOString(), style, lastTitle: title, cast };
  writeFileSync(path.join(dir, "season.json"), JSON.stringify(season, null, 2));
  return { dir, cast: cast.length };
}

// Load a season. Each cast member gets a dataUri (usable as an image-edit reference for stills) and
// a file path. NOTE: data URIs are NOT valid for the video r2v API (public URLs only) — the r2v
// branch must filter them out; still-side identity anchoring is where the vault earns its keep.
export function loadCast(name) {
  const dir = vaultPath(name);
  const f = path.join(dir, "season.json");
  if (!existsSync(f)) return null;
  try {
    const season = JSON.parse(readFileSync(f, "utf8"));
    for (const c of (season.cast || [])) {
      const p = path.join(dir, c.ref || "");
      if (existsSync(p)) { c.file = p; c.dataUri = `data:image/png;base64,${readFileSync(p).toString("base64")}`; }
    }
    season.cast = (season.cast || []).filter((c) => c.dataUri);
    return season;
  } catch { return null; }
}
