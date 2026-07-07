// src/banIcon.js
//
// Generates the PNG for the ban status icon, uploads it to Catbox, and caches
// { clean, url } in data/ban-icon.json so the same icon isn't re-uploaded
// every minute (there are only two possible states: clean or banned).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildBanIconPng } from "./banStatus.js";
import { uploadImage } from "./imageUploader.js";

const CACHE_PATH = path.resolve("data/ban-icon.json");
const CACHE_VERSION = 1;

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

async function writeCache(entry) {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(entry, null, 2));
}

/**
 * Returns the URL of the ban icon (clean or banned). There are only two
 * possible images, so the cache stores both when they are generated.
 */
export async function resolveBanIconUrl(clean) {
  const cache = (await readCache()) ?? { version: CACHE_VERSION };

  const key = clean ? "cleanUrl" : "bannedUrl";
  if (cache.version === CACHE_VERSION && cache[key]) {
    return cache[key];
  }

  const png = await buildBanIconPng(clean);
  const url = await uploadImage(png, `steam-ban-${clean ? "clean" : "banned"}.png`);

  cache.version = CACHE_VERSION;
  cache[key] = url;
  await writeCache(cache);

  return url;
}
