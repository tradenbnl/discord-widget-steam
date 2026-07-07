// src/banStatus.js
//
// Parses the response from GetPlayerBans and returns:
//   - a status message (“Clean,” “VAC Banned,” etc.)
//   - a PNG with a representative icon (Steam doesn’t have an official one,
//     so we generate it: green = clean account, red = banned).
//
// The PNG is then uploaded to Catbox (just like the level icon) to
// provide a usable URL for the widget.

import sharp from "sharp";

const SIZE = 256;

/**
 * Returns { label, clean } from the GetPlayerBans object.
 *   label: short text to display (without the prefix “Ban Status: ”).
 *   clean: true if there are no bans in the log.
 */
export function describeBanStatus(bans) {
  if (!bans) {
    return { label: "Unknown", clean: true };
  }

  const vac = bans.VACBanned === true || (bans.NumberOfVACBans || 0) > 0;
  const gameBans = (bans.NumberOfGameBans || 0) > 0;
  const community = bans.CommunityBanned === true;
  const economy = bans.EconomyBan && bans.EconomyBan !== "none";

  // If there is absolutely nothing -> account is clear.
  if (!vac && !gameBans && !community && !economy) {
    return { label: "Clean (No bans)", clean: true };
  }

  // We build a list of the types of bans that exist.
  const parts = [];
  if (vac) {
    const n = bans.NumberOfVACBans || 0;
    parts.push(n > 1 ? `${n} VAC bans` : "VAC banned");
  }
  if (gameBans) {
    const n = bans.NumberOfGameBans || 0;
    parts.push(n > 1 ? `${n} game bans` : "Game banned");
  }
  if (community) parts.push("Community banned");
  if (economy) parts.push(`Trade ${bans.EconomyBan}`); // p.ej. "Trade probation"

  return { label: parts.join(", "), clean: false };
}

// Icon: green circle with a check mark (clean) or red circle with an “X”/shield
// (with bans). Transparent background.
function buildIconSvg(clean) {
  const color = clean ? "4c9f38" : "c0392b"; // green / red
  const cx = SIZE / 2;
  const r = cx - 16;

  const glyph = clean
    ? // check
      `<path d="M ${cx - 55} ${cx} L ${cx - 18} ${cx + 38} L ${cx + 60} ${cx - 45}"
             fill="none" stroke="#ffffff" stroke-width="26"
             stroke-linecap="round" stroke-linejoin="round"/>`
    : // X
      `<path d="M ${cx - 45} ${cx - 45} L ${cx + 45} ${cx + 45}
                M ${cx + 45} ${cx - 45} L ${cx - 45} ${cx + 45}"
             fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <circle cx="${cx}" cy="${cx}" r="${r}" fill="#${color}"/>
  ${glyph}
</svg>`;
}

/**
 * Generates the PNG file for the ban status icon.
 */
export async function buildBanIconPng(clean) {
  return sharp(Buffer.from(buildIconSvg(clean))).png().toBuffer();
}
