// src/steamProfileScraper.js
//
// Retrieves the following from the public Steam profile:
//   1. The “Featured Badge” (Badge Collector showcase or Favorite Badge)
//   2. The most recently played game (“Recent Activity” block)
//   3. The total number of games Steam displays on the profile (“X games”)
//
// This serves as a fallback when the Web API returns an empty result due to the
// “Game details” privacy setting (which is SEPARATE from the
// general public profile). The profile page does show recent activity
// and sometimes the game count even if the API hides them.

function absolutize(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export async function fetchProfileHtml(steamId64) {
  const url = `https://steamcommunity.com/profiles/${steamId64}/?l=english`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; steam-discord-widget/1.0)" },
  });
  if (!res.ok) {
    throw new Error(
      `Could not read Steam public profile (HTTP ${res.status}). Is the profile public?`
    );
  }
  return res.text();
}

// ---- Featured Badge --------------------------------------------------

export function extractBadgeFromShowcase(html) {
  const showcaseIdx = html.indexOf('class="badge_showcase"');
  if (showcaseIdx === -1) {
    const iconsIdx = html.indexOf("showcase_badges_icons");
    if (iconsIdx === -1) return null;
    return findFirstBadgeInBlock(html, iconsIdx);
  }
  return findFirstBadgeInBlock(html, showcaseIdx);
}

function findFirstBadgeInBlock(html, startIdx) {
  const windowEnd = Math.min(html.length, startIdx + 4000);
  const block = html.slice(startIdx, windowEnd);

  const imgMatch = block.match(
    /<div class="showcase_slot showcase_badge"[\s\S]*?<img[^>]+src="([^"]+)"/
  );
  if (!imgMatch) return null;

  const tooltipMatch = block.match(
    /<div class="showcase_slot showcase_badge"[^>]*data-tooltip-html="([^"]+)"/
  );
  let name = "Featured Badge";
  if (tooltipMatch) {
    const decoded = tooltipMatch[1]
      .replace(/&lt;br&gt;/gi, "\n")
      .replace(/<br>/gi, "\n")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"');
    name = decoded.split("\n")[0].trim() || name;
  }

  return { name, iconUrl: absolutize(imgMatch[1]) };
}

export function extractFavoriteBadge(html) {
  const idx = html.indexOf('class="favorite_badge"');
  if (idx === -1) return null;

  const block = html.slice(idx, Math.min(html.length, idx + 2000));
  const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
  const nameMatch = block.match(
    /class="favorite_badge_description"[\s\S]*?<div class="name[^"]*">([\s\S]*?)<\/div>/
  );

  if (!imgMatch) return null;

  return {
    name: nameMatch ? stripHtml(nameMatch[1]) || "Favorite Badge" : "Favorite Badge",
    iconUrl: absolutize(imgMatch[1]),
  };
}

// ---- Total number of games displayed on the profile --------------------------

// The profile displays a counter like this:
//   <a class="profile_count_link ..." href=".../games/">
//     <span class="count_link_label">Games</span>
//     <span class="profile_count_link_total"> 142 </span>
export function extractGamesCountFromProfile(html) {
  // looking for the “Games” link and the associated number.
  const re =
    /count_link_label">\s*Games\s*<\/span>[\s\S]*?profile_count_link_total">\s*([\d,]+)\s*</i;
  const match = html.match(re);
  if (!match) return null;
  const n = parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
