// index.js
//
// Loops every 60 seconds. Checks Steam and sends a PATCH request to the Discord widget.
//
// Source for “last game played” (same method as the
// user script that already runs 24/7 without delay):
//   1. Currently playing  → GetPlayerSummaries.gameid
//   2. Last played   → GetOwnedGames sorted by rtime_last_played
//
// Game icon: SteamGridDB (512x512+) as the primary icon so it doesn’t
// look blurry, with the Steam app icon (32x32) as a fallback.

import "dotenv/config";
import {
  getPlayerSummary,
  getSteamLevel,
  getBadges,
  getOwnedGames,
  getPlayerBans,
} from "./src/steamApi.js";
import { describeAccountAge } from "./src/accountAge.js";
import { describeBanStatus } from "./src/banStatus.js";
import { resolveBanIconUrl } from "./src/banIcon.js";
import { resolveLevelIconUrl } from "./src/levelIcon.js";
import { resolveComposedAvatarUrl } from "./src/avatarIcon.js";
import { checkFfmpeg } from "./src/avatarCompositor.js";
import { getHiResIconUrl } from "./src/steamGridDb.js";
import {
  fetchProfileHtml,
  extractBadgeFromShowcase,
  extractFavoriteBadge,
  extractGamesCountFromProfile,
} from "./src/steamProfileScraper.js";
import { buildPayload, pushToDiscord } from "./src/discordWidget.js";

const {
  STEAM_API_KEY,
  STEAM_ID,
  DISCORD_APP_ID,
  DISCORD_USER_ID,
  DISCORD_BOT_TOKEN,
  DISCORD_WIDGET_USERNAME,
  STEAMGRIDDB_API_KEY, // opcional
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Check your .env file.`);
  }
}

requireEnv("STEAM_API_KEY", STEAM_API_KEY);
requireEnv("STEAM_ID", STEAM_ID);
requireEnv("DISCORD_APP_ID", DISCORD_APP_ID);
requireEnv("DISCORD_USER_ID", DISCORD_USER_ID);
requireEnv("DISCORD_BOT_TOKEN", DISCORD_BOT_TOKEN);

const REFRESH_MS = 60_000;

// Steam app icon (32x32). Used only as a FALLBACK if SteamGridDB
// returns nothing.
function steamAppIconUrl(appid, imgIconHash) {
  if (appid && imgIconHash) {
    return `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${imgIconHash}.jpg`;
  }
  return null;
}

function formatBadgesOwned(n) {
  return n === 1 ? "1 ɢᴀᴍᴇ ᴏᴡɴᴇᴅ" : `${n} ʙᴀᴅɢᴇꜱ ᴏᴡɴᴇᴅ`;
}
function formatGamesOwned(n) {
  return n === 1 ? "1 ɢᴀᴍᴇ ᴏᴡɴᴇᴅ" : `${n} ɢᴀᴍᴇꜱ ᴏᴡɴᴇᴅ`;
}

// Game with the most playtime_forever in the entire library (GetOwnedGames).
// Returns { name, appid, steamIconHash } or null if there is no
// playtime data (profile with private “Game details,” or empty library).
function getMostPlayed(ownedGamesResp) {
  const games = ownedGamesResp?.games ?? [];
  const withPlaytime = games
    .filter((g) => (g.playtime_forever || 0) > 0)
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));

  const top = withPlaytime[0];
  if (!top) return null;
  return {
    name: top.name ?? `App ${top.appid}`,
    appid: top.appid,
    steamIconHash: top.img_icon_url || null,
  };
}

/**
 * Retrieves the current game or the last game played (user-tested method):
 *   1. Currently playing (GetPlayerSummaries.gameid).
 *   2. Last played based on rtime_last_played (GetOwnedGames).
 * Returns the app ID and the Steam icon hash (for backup).
 */
function resolveCurrentOrLastGame({ player, ownedGamesResp }) {
  const games = ownedGamesResp?.games ?? [];

  if (player.gameid) {
    const appid = Number(player.gameid);
    const inLibrary = games.find((g) => g.appid === appid);
    return {
      appid,
      name: player.gameextrainfo || inLibrary?.name || `App ${appid}`,
      steamIconHash: inLibrary?.img_icon_url || null,
      status: "ᴘʟᴀʏɪɴɢ ɴᴏᴡ",
    };
  }

  if (games.length > 0) {
    const sorted = [...games].sort(
      (a, b) => (b.rtime_last_played || 0) - (a.rtime_last_played || 0)
    );
    const last = sorted[0];
    return {
      appid: last.appid,
      name: last.name ?? `App ${last.appid}`,
      steamIconHash: last.img_icon_url || null,
      status: "ʟᴀꜱᴛ ᴘʟᴀʏᴇᴅ",
    };
  }

  return { appid: null, name: "No recent activity", steamIconHash: null, status: "" };
}

// Find the best icon: SteamGridDB (high resolution) → Steam app icon.
async function resolveGameIconUrl(appid, steamIconHash) {
  if (!appid) return null;

  const hiRes = await getHiResIconUrl(appid, STEAMGRIDDB_API_KEY);
  if (hiRes) return hiRes;

  return steamAppIconUrl(appid, steamIconHash);
}

async function runOnce() {
  const t0 = Date.now();
  console.log(`\n[${new Date().toISOString()}] Refreshing widget...`);

  const [player, level, badgeData, ownedGamesResp, bansData] = await Promise.all([
    getPlayerSummary(STEAM_API_KEY, STEAM_ID),
    getSteamLevel(STEAM_API_KEY, STEAM_ID),
    getBadges(STEAM_API_KEY, STEAM_ID),
    getOwnedGames(STEAM_API_KEY, STEAM_ID),
    getPlayerBans(STEAM_API_KEY, STEAM_ID).catch(() => null),
  ]);

  const badgeCount = (badgeData.badges ?? []).length;
  let totalGames = ownedGamesResp.game_count ?? 0;

  let featuredBadge = null;
  let gamesFromProfile = null;
  try {
    const profileHtml = await fetchProfileHtml(STEAM_ID);
    featuredBadge =
      extractBadgeFromShowcase(profileHtml) ?? extractFavoriteBadge(profileHtml);
    gamesFromProfile = extractGamesCountFromProfile(profileHtml);
  } catch (err) {
    console.warn("  ! Could not read public profile:", err.message);
  }

  if (totalGames === 0 && gamesFromProfile && gamesFromProfile > 0) {
    totalGames = gamesFromProfile;
  }

  if (totalGames === 0) {
    console.warn(
      "  ! total_games is 0. This is the 'Game details' privacy setting, " +
        "which is SEPARATE from your profile being public.\n" +
        "    Fix: Steam → Profile → Edit Profile → Privacy Settings → " +
        "set 'Game details' to Public."
    );
  }

  const { createdLabel, ageLabel, memberSinceYear } = describeAccountAge(
    player.timecreated
  );

  const mostPlayed = getMostPlayed(ownedGamesResp);
  const ban = describeBanStatus(bansData);

  const currentGame = resolveCurrentOrLastGame({ player, ownedGamesResp });

  // Icons side by side: level, current game, composite avatar,
  // most played, and ban status.
  const [
    levelIconUrl,
    currentGameIconUrl,
    composedAvatarUrl,
    mostPlayedIconUrl,
    banStatusIconUrl,
  ] = await Promise.all([
    resolveLevelIconUrl(level),
    resolveGameIconUrl(currentGame.appid, currentGame.steamIconHash),
    resolveComposedAvatarUrl(STEAM_API_KEY, STEAM_ID, player.avatarfull).catch(
      (err) => {
        console.warn("  ! Avatar compose failed, using plain avatar:", err.message);
        return player.avatarfull;
      }
    ),
    mostPlayed
      ? resolveGameIconUrl(mostPlayed.appid, mostPlayed.steamIconHash).catch(
          () => null
        )
      : Promise.resolve(null),
    resolveBanIconUrl(ban.clean).catch((err) => {
      console.warn("  ! Ban icon failed:", err.message);
      return null;
    }),
  ]);

  const payload = buildPayload({
    discordUsername: DISCORD_WIDGET_USERNAME || player.personaname,
    steamName: player.personaname,
    avatarUrl: composedAvatarUrl,
    accountCreated: createdLabel,
    accountAge: ageLabel,
    memberSince: memberSinceYear
      ? `ᴍᴇᴍʙᴇʀ ꜱɪɴᴄᴇ: ${memberSinceYear}`
      : "ᴍᴇᴍʙᴇʀ ꜱɪɴᴄᴇ: ᴜɴᴋɴᴏᴡɴ",
    level,
    levelIconUrl,
    badgeCountText: formatBadgesOwned(badgeCount),
    featuredBadgeName: featuredBadge?.name ?? "No featured badge",
    featuredBadgeIconUrl: featuredBadge?.iconUrl ?? null,
    totalGamesText: formatGamesOwned(totalGames),
    mostPlayed: mostPlayed
    //  ? `Most Played: ${mostPlayed.name}`
    //  : "Most Played: Unknown",
	  ? `‎‎‎ 「‎ ${mostPlayed.name}‎ ‎」 `
      : "‎‎ ‎ ‎ ‎ ‎  ᴜɴᴋɴᴏᴡɴ",
    mostPlayedIconUrl,
    banStatus: `ʙᴀɴ ꜱᴛᴀᴛᴜꜱ: ${ban.label}`,
    banStatusIconUrl,
    currentGameName: currentGame.name,
    currentGameIconUrl,
    gameStatus: currentGame.status,
  });

  await pushToDiscord({
    appId: DISCORD_APP_ID,
    userId: DISCORD_USER_ID,
    botToken: DISCORD_BOT_TOKEN,
    payload,
  });

  const elapsed = Date.now() - t0;
  console.log(
    `  ✔ Updated in ${elapsed}ms — level ${level}, ${totalGames} games, ` +
      `${badgeCount} badges, ban: ${ban.label}, ${currentGame.status || "no activity"}${
        currentGame.name ? `: ${currentGame.name}` : ""
      }${mostPlayed ? ` | most played: ${mostPlayed.name}` : ""}`
  );
}

async function loop() {
  console.log("Steam Discord Widget — refreshing every 60s. Ctrl+C to stop.");

  // Check for ffmpeg at startup with a clear message. Without ffmpeg, the
  // avatars/animated frames CANNOT be rendered (they will appear static).
  try {
    const version = await checkFfmpeg();
    console.log(`ffmpeg OK: ${version}`);
  } catch (err) {
    console.warn(`⚠ ${err.message}`);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce();
    } catch (err) {
      console.error("  ✘ Error this cycle:", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, REFRESH_MS));
  }
}

loop().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
