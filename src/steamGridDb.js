// src/steamGridDb.js
//
// Retrieves high-resolution game icons (512x512+) from
// SteamGridDB, instead of the Steam app icon (which is only 32x32 and
// looks blurry when scaled).
//
// Based on a user-tested script. Requires STEAMGRIDDB_API_KEY.
// If the key is missing or any call fails, it returns null and the caller
// falls back to the Steam app icon as a fallback (without breaking).
//
// SteamGridDB art URLs do not change between runs, so
// they are cached in memory by appid for the lifetime of the process.

const SGDB_BASE = "https://www.steamgriddb.com/api/v2";

// appid -> { iconUrl } | gid:appid -> steamGridId
const assetsCache = new Map();

async function sgdbFetch(path, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch(`${SGDB_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.success ? data : null;
  } catch {
    return null;
  }
}

// Steam AppID -> SteamGridDB internal ID.
async function getSgdbGameId(appid, apiKey) {
  const key = `gid:${appid}`;
  if (assetsCache.has(key)) return assetsCache.get(key);

  const data = await sgdbFetch(`/games/steam/${appid}`, apiKey);
  const gameId = data?.data?.id ?? null;
  assetsCache.set(key, gameId);
  return gameId;
}

// From a list of SteamGridDB assets, choose the one with the highest resolution,
// prioritizing the one closest to or equal to 512x512 and falling back to the next
// largest available size.
function pickBestIcon(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  // I prefer an exact width of 512; otherwise, the nearest larger value <= 512;
  // if there is no value <= 512, the largest available value.
  const withDims = assets
    .map((a) => ({ url: a.url, w: a.width || 0, h: a.height || 0 }))
    .filter((a) => a.url);

  if (withDims.length === 0) return null;

  const exact512 = withDims.find((a) => a.w === 512);
  if (exact512) return exact512.url;

  // Sort by size in descending order and take the largest one.
  withDims.sort((a, b) => b.w * b.h - a.w * a.h);
  return withDims[0].url;
}

/**
 * Returns the URL of the best icon (512x512 or the next largest)
 * for a Steam app ID, or null if there is no key or it cannot be found.
 */
export async function getHiResIconUrl(appid, apiKey) {
  if (!apiKey || !appid) return null;

  if (assetsCache.has(appid)) return assetsCache.get(appid);

  const gameId = await getSgdbGameId(appid, apiKey);
  if (!gameId) {
    assetsCache.set(appid, null);
    return null;
  }

  // Discord doesn't render .ico files, so we filter for web-compatible MIME types.
  const iconMimes = "image/png,image/webp,image/jpeg";
  const iconsRes = await sgdbFetch(
    `/icons/game/${gameId}?mimes=${encodeURIComponent(iconMimes)}`,
    apiKey
  );

  const iconUrl = pickBestIcon(iconsRes?.data);
  assetsCache.set(appid, iconUrl);
  return iconUrl;
}
