// src/levelIcon.js
//
// Generates the composite level icon: checks Steam's CSS
// to determine which color/sprite corresponds to the current level, composes the
// PNG (transparent background + centered number) using
// levelImageBuilder, uploads it to Catbox, and saves { level, url } in
// data/level-icon.json to avoid re-uploading the same image every minute.
//
// The cache includes a CACHE_VERSION: if we change the logic for
// image generation (for example, to fix transparency or
// centering), incrementing this number invalidates old caches and forces
// a re-upload on the next run.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildLevelPng } from "./levelImageBuilder.js";
import { uploadImage } from "./imageUploader.js";

const STEAM_SHARED_CSS_URL =
  "https://steamcommunity-a.akamaihd.net/public/shared/css/shared_global.css";
const CACHE_PATH = path.resolve("data/level-icon.json");
const CACHE_VERSION = 4; // v4: geometric centering (trim + center of gravity)

let cssInMemory = null;

async function getSharedCss() {
  if (cssInMemory) return cssInMemory;
  const res = await fetch(STEAM_SHARED_CSS_URL);
  if (!res.ok) {
    throw new Error(
      `Could not read Steam level stylesheet (HTTP ${res.status})`
    );
  }
  cssInMemory = await res.text();
  return cssInMemory;
}

function extractBorderColor(css, tensBracket) {
  const re = new RegExp(
    `\\.friendPlayerLevel\\.lvl_${tensBracket}\\s*\\{[^}]*border-color:\\s*(#[0-9a-fA-F]{3,6})`
  );
  const match = css.match(re);
  return match ? match[1].replace("#", "") : "5a6773";
}

function extractBackgroundImage(css, centuryBracket) {
  const re = new RegExp(
    `\\.friendPlayerLevel\\.lvl_${centuryBracket}\\s*\\{[^}]*background-image:\\s*url\\(\\s*['"]?([^'")]+)['"]?\\s*\\)`
  );
  const match = css.match(re);
  return match ? match[1] : null;
}

async function readCache() {
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(entry) {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(entry, null, 2));
}

export async function resolveLevelIconUrl(level) {
  const cached = await readCache();
  if (
    cached &&
    cached.version === CACHE_VERSION &&
    cached.level === level &&
    cached.url
  ) {
    return cached.url;
  }

  const css = await getSharedCss();
  const century = Math.floor(level / 100) * 100;
  const tens = Math.floor((level % 100) / 10) * 10;

  const borderColor = extractBorderColor(css, tens);
  const spriteUrl = century >= 100 ? extractBackgroundImage(css, century) : null;

  const pngBuffer = await buildLevelPng(level, {
    borderColor,
    spriteUrl,
    tensBracket: tens,
  });

  const url = await uploadImage(pngBuffer, `steam-level-${level}-v${CACHE_VERSION}.png`);

  await writeCache({ version: CACHE_VERSION, level, url });

  return url;
}
