// src/steamApi.js
// Lightweight wrappers around the public endpoints of the Steam Web API.
//
// Docs:
// - GetPlayerSummaries: https://developer.valvesoftware.com/wiki/Steam_Web_API#GetPlayerSummaries_.28v0002.29
// - IPlayerService: https://partner.steamgames.com/doc/webapi/IPlayerService

const BASE = "https://api.steampowered.com";

async function steamGet(path, params) {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Steam API ${path} returned ${res.status}. ${body}`.trim());
  }
  return res.json();
}

// Name, avatar, timecreated, and whether they're currently playing a game
// (gameid/gameextrainfo). communityvisibilitystate: 3 = public.
export async function getPlayerSummary(apiKey, steamId) {
  const data = await steamGet("/ISteamUser/GetPlayerSummaries/v0002/", {
    key: apiKey,
    steamids: steamId,
  });

  const player = data?.response?.players?.[0];
  if (!player) {
    throw new Error(
      "Steam profile not found. Check STEAM_ID and that the profile is public."
    );
  }
  return player;
}

export async function getSteamLevel(apiKey, steamId) {
  const data = await steamGet("/IPlayerService/GetSteamLevel/v1/", {
    key: apiKey,
    steamid: steamId,
  });
  return data?.response?.player_level ?? 0;
}

export async function getBadges(apiKey, steamId) {
  const data = await steamGet("/IPlayerService/GetBadges/v1/", {
    key: apiKey,
    steamid: steamId,
  });
  return data?.response ?? { badges: [] };
}

// All games in the library. Requires that “Game details” be
// set to Public in Steam's privacy settings (this is a SEPARATE setting from
// the general profile). skip_unvetted_apps=false includes games that
// would otherwise be omitted (e.g., limited/unvetted).
export async function getOwnedGames(apiKey, steamId) {
  const data = await steamGet("/IPlayerService/GetOwnedGames/v1/", {
    key: apiKey,
    steamid: steamId,
    include_appinfo: 1,
    include_played_free_games: 1,
    skip_unvetted_apps: false,
  });
  return data?.response ?? { game_count: 0, games: [] };
}

// Games played in the last 2 weeks. Also requires a public "Game
// details" field. Returns total_count + games[].
export async function getRecentlyPlayedGames(apiKey, steamId, count = 5) {
  const data = await steamGet("/IPlayerService/GetRecentlyPlayedGames/v1/", {
    key: apiKey,
    steamid: steamId,
    count,
  });
  return data?.response ?? { total_count: 0, games: [] };
}

// Player's ban status (VAC, game, community, economy).
// GetPlayerBans does not require the profile to be public.
export async function getPlayerBans(apiKey, steamId) {
  const data = await steamGet("/ISteamUser/GetPlayerBans/v1/", {
    key: apiKey,
    steamids: steamId,
  });
  const player = data?.response?.players?.[0] ?? data?.players?.[0];
  return player ?? null;
}
