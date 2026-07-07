// src/steamAvatar.js
//
// Retrieves the avatar and avatar frame CANDIDATES equipped on Steam
// (GetProfileItemsEquipped). Steam returns image_large and image_small
// per item, and does NOT document which one is the animated version (APNG)—sometimes

const CDN_BASE = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/";

function absolutizeAsset(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  const clean = pathOrUrl.replace(/^\/+/, "");
  const rel = clean.startsWith("items/") ? clean : `items/${clean}`;
  return `${CDN_BASE}${rel}`;
}

/**
 * Returns:
 *   frameCandidates: Candidate URLs for the frame (may be empty)
 *   avatarCandidates: Candidate URLs for the animated avatar (may be empty)
 * Each list is sorted by preference (large first), but the
 * consumer must choose which one is the animated one based on CONTENT.
 */
export async function getEquippedProfileItems(apiKey, steamId) {
  const url =
    `https://api.steampowered.com/IPlayerService/GetProfileItemsEquipped/v1/` +
    `?key=${apiKey}&steamid=${steamId}`;

  const res = await fetch(url);
  if (!res.ok) {
    return { frameCandidates: [], avatarCandidates: [] };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { frameCandidates: [], avatarCandidates: [] };
  }

  const resp = data?.response ?? {};
  const frame = resp.avatar_frame ?? {};
  const animated = resp.animated_avatar ?? {};

  const frameCandidates = [
    absolutizeAsset(frame.image_large),
    absolutizeAsset(frame.image_small),
  ].filter(Boolean);

  const avatarCandidates = [
    absolutizeAsset(animated.image_large),
    absolutizeAsset(animated.image_small),
  ].filter(Boolean);

  return { frameCandidates, avatarCandidates };
}
