// src/discordWidget.js

const USER_AGENT = "DiscordBot (https://github.com/discord/discord-api-docs, 1.0.0)";

function field(type, name, value) {
  return { type, name, value };
}

export function buildPayload({
  discordUsername,
  steamName,
  avatarUrl,
  accountCreated,
  accountAge,
  memberSince,
  level,
  levelIconUrl,
  badgeCountText,
  featuredBadgeName,
  featuredBadgeIconUrl,
  totalGamesText,
  mostPlayed,
  mostPlayedIconUrl,
  banStatus,
  banStatusIconUrl,
  currentGameName,
  currentGameIconUrl,
  gameStatus,
}) {
  const dynamic = [
    field(1, "steam_name", steamName),
    field(3, "avatar", { url: avatarUrl }),
    field(1, "account_created", accountCreated),
    field(1, "acc_created", accountCreated),
    field(1, "account_age", accountAge),
    field(1, "acc_age", accountAge),
    field(1, "member_since", memberSince),
    field(2, "level", level),
    field(3, "level_icon", { url: levelIconUrl }),
    field(1, "badge_count", badgeCountText),
    field(1, "featured_badge_name", featuredBadgeName),
    field(1, "total_games", totalGamesText),
    field(1, "most_played", mostPlayed),
    field(1, "ban_status", banStatus),
    field(1, "current_game_name", currentGameName),
    field(1, "game_status", gameStatus),
  ];

  if (featuredBadgeIconUrl) {
    dynamic.push(field(3, "featured_badge_icon", { url: featuredBadgeIconUrl }));
  }
  if (currentGameIconUrl) {
    dynamic.push(field(3, "current_game_icon", { url: currentGameIconUrl }));
  }
  if (mostPlayedIconUrl) {
    dynamic.push(field(3, "most_played_icon", { url: mostPlayedIconUrl }));
  }
  if (banStatusIconUrl) {
    dynamic.push(field(3, "ban_status_icon", { url: banStatusIconUrl }));
  }

  return {
    username: discordUsername,
    data: { dynamic },
  };
}

export async function pushToDiscord({ appId, userId, botToken, payload }) {
  const url = `https://discord.com/api/v9/applications/${appId}/users/${userId}/identities/0/profile`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord responded ${res.status}: ${text}`);
  }

  return res.json().catch(() => ({}));
}
