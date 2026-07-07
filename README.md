# 🎮 Steam → Discord Profile Widget (v2)

A Node.js service that keeps a **Discord Profile Widget (v2)** in sync with your **Steam account** — level, badges, games, live "now playing" status, and even your **animated avatar + avatar frame composited together as a GIF**.

It runs in a loop, pulls fresh data from the Steam Web API (plus your public profile and SteamGridDB), builds/uploads any images it needs, and `PATCH`es your Discord application identity every 60 seconds.

> Based on [Chloe Cinders' widget guide](https://chloecinders.com/blog/discord-widgets) and the polling approach from [ezxmora/discord-widget](https://github.com/ezxmora/discord-widget).

---

## ✨ Features

- **Steam identity** — username and profile photo.
- **Composited animated avatar** — downloads your equipped **avatar frame** (Steam Points Shop) and overlays it on your profile photo. If either one is animated (Steam uses **APNG** for frames, and animated avatars can be APNG/GIF), both are normalized and merged into a single **animated GIF** with ffmpeg. Static + static outputs a clean PNG instead.
- **Steam level, Steam-style** — Steam paints levels with HTML/CSS (a colored ring under 100, sprite shields at 100+). This project replicates that: it reads Steam's own stylesheet for the exact ring color / official sprite, composites your level number on top (transparent background, centered), and produces a real image Discord can display.
- **Badges** — total badge count ("X badges owned") plus your **Featured Badge** (the one from your profile's Badge Showcase) with its real icon and name, scraped from your public profile.
- **Games** — total games owned ("X games owned"), with a public-profile fallback if the API returns nothing.
- **Most played** — your top game by total playtime, as `Most Played: <name>`, with a **high-resolution icon** (512×512+) from SteamGridDB.
- **Now playing / last played** — detects the game you're playing right now, or the last one you played (via `rtime_last_played`, which updates fast), with its icon. Status text: `Playing now` / `Last played`.
- **Account age** — creation date ("6 years and 9 months"), and `Member Since: <year>`.
- **Ban status** — `Ban Status: Clean (No bans)` or a breakdown (VAC / game / community / trade), with a generated green-check or red-X icon.
- **Self-diagnosing avatar pipeline** — logs every step (`[avatar]` prefix), verifies the output GIF actually has multiple frames, saves a local preview to `data/avatar-preview.gif` so you can check the animation yourself, and checks ffmpeg availability at startup.
- **Smart caching** — composed images (level icon, avatar, ban icons) are uploaded once to [Catbox](https://catbox.moe) and reused until the underlying data changes (cached in `data/*.json`). Restart-safe.
- **Auto refresh** — infinite loop, every **60 seconds**; one failed cycle never kills the process.

---

## 🧩 Widget Data Fields

Create these **Data Fields** in the Discord Developer Portal widget editor (Games → Widget → your widget). Names must match **exactly**. Set each field's *Value Type* to **User Data**.

| Data Field name | Type | Example value / content |
| --- | --- | --- |
| `steam_name` | String | `xXPlayerXx` — your Steam persona name |
| `avatar` | Image | Composited photo + avatar frame (animated GIF if either is animated) |
| `account_created` | String | `September 23, 2019` |
| `acc_created` | String | Alias of `account_created` |
| `account_age` | String | `6 years and 9 months` |
| `acc_age` | String | Alias of `account_age` |
| `member_since` | String | `Member Since: 2019` |
| `level` | Number | `38` |
| `level_icon` | Image | Steam-style level badge (ring color / official sprite + number) |
| `badge_count` | String | `15 badges owned` |
| `featured_badge_name` | String | `Community Leader` |
| `featured_badge_icon` | Image | Real icon of your featured badge |
| `total_games` | String | `129 games owned` |
| `most_played` | String | `Most Played: Team Fortress 2` |
| `most_played_icon` | Image | Hi-res icon of your most played game |
| `ban_status` | String | `Ban Status: Clean (No bans)` |
| `ban_status_icon` | Image | Green check (clean) / red X (banned) |
| `current_game_name` | String | `ARC Raiders` |
| `current_game_icon` | Image | Hi-res icon of the current / last game |
| `game_status` | String | `Playing now` / `Last played` |

> Notes
> - You don't need to use them all — the script always sends everything; Discord only renders the fields your widget defines.
> - Image fields must be created as type **Image** in the editor; the script sends them as `{ "url": ... }`.
> - `account_age`/`acc_age` and `account_created`/`acc_created` are duplicates so either naming works.

---

## 📋 Requirements

| Requirement | Version / notes |
| --- | --- |
| **Node.js** | **18+** (uses native `fetch`, `FormData`, ESM) |
| **ffmpeg** | Required **only** for animated avatars/frames (APNG/GIF compositing). Without it, everything still works but the avatar falls back to a static PNG. Must be on `PATH`, or set `FFMPEG_PATH` in `.env`. |
| **npm packages** | `dotenv`, `sharp` (installed by `npm install`; sharp ships prebuilt binaries — no build tools needed) |

### Accounts / API keys

| Key | Where to get it | Required |
| --- | --- | --- |
| Steam Web API key | <https://steamcommunity.com/dev/apikey> | ✅ |
| SteamID64 (17 digits) | <https://steamid.io> (paste your steam profile URL) | ✅ |
| Discord Application ID | [Developer Portal](https://discord.com/developers/applications) → your app | ✅ |
| Discord User ID | Discord → Settings → Advanced → Developer Mode → right-click yourself → Copy User ID | ✅ |
| Discord Bot Token | Developer Portal → your app → Bot → Reset Token | ✅ |
| SteamGridDB API key | <https://www.steamgriddb.com/profile/preferences/api> | Optional (hi-res game icons; falls back to Steam's 32×32 icons) |

- **Steam account**: <https://store.steampowered.com/account/> Log into your Steam account and go to **Account Details**. There you should be able to see your SteamID64 Under your Name


### Steam privacy settings

For game data to be available: Steam → your profile → **Edit Profile → Privacy Settings** →
- **My profile**: Public
- **Game details**: Public (this one is separate from the profile setting — without it, `total_games` and `most_played` will be empty)

### Discord widget setup (one-time)

Follow [Chloe Cinders' guide](https://chloecinders.com/blog/discord-widgets) to:
1. Create the application and enable the **Social SDK**.
2. Build the widget in the editor and add the Data Fields from the table above.
3. Authorize your app with the `openid` + `sdk.social_layer` OAuth2 scopes (use `response_type=token`).
4. Add the widget to your profile.

> ⚠️ Since June 4th, Discord restricts widgets to the **application owner** — only your own account can display your app's widget.

---

## 🚀 Installation & Running

```bash
# 1. Clone
git clone https://github.com/<you>/discord-widget-steam.git
cd discord-widget-steam

# 2. Install dependencies
npm install

# 3. Configure credentials
cp env.example .env      # on Windows: copy env.example .env
#    ...then edit .env and fill in your keys

# 4. Run
npm start
```

You should see:

```
Steam Discord Widget — refreshing every 60s. Ctrl+C to stop.
ffmpeg OK: ffmpeg version 6.1.1 ...
[2026-07-05T23:08:17.447Z] Refreshing widget...
  [avatar] frame candidates: 2, animated-avatar candidates: 0
  [avatar]     candidate https://cdn...items/....png -> apng (48123b)
  [avatar]   composed gif: 14 frames, 59857b
  ✔ Updated in 1414ms — level 38, 129 games, 15 badges, ban: Clean (No bans), Playing now: ARC Raiders | most played: Team Fortress 2
```

The process keeps running and refreshes every 60 seconds. Stop it with `Ctrl+C`.

### .env reference

```ini
STEAM_API_KEY=            # required
STEAM_ID=                 # required — SteamID64
DISCORD_APP_ID=           # required
DISCORD_USER_ID=          # required
DISCORD_BOT_TOKEN=        # required — keep it secret!
DISCORD_WIDGET_USERNAME=  # optional — widget title; defaults to Steam name
STEAMGRIDDB_API_KEY=      # optional — hi-res game icons - I recommend you to set this up
FFMPEG_PATH=              # optional — full path to ffmpeg if not on PATH
```

### Running 24/7 with pm2 (Windows / PowerShell)  Recommended but **Optional**

[pm2](https://pm2.keymetrics.io/) keeps the script alive in the background, restarts it if it crashes, and can launch it automatically when Windows boots.

**1. Install pm2 (once):**

```powershell
npm install -g pm2
```

**2. Start the widget as a managed process:**

```powershell
cd F:\path\to\discord-widget-steam
pm2 start index.js --name discord-widget2
```

**3. Check that it's running and watch the logs:**

```powershell
pm2 status
pm2 logs discord-widget2
```

You should see the usual startup lines (`ffmpeg OK`, `Refreshing widget...`). Press `Ctrl+C` to exit the log view — the process keeps running in the background.

**4. Make it start automatically when Windows boots:**

> ⚠️ `pm2 startup` does **not** work natively on Windows. Use the
> [`pm2-windows-startup`](https://www.npmjs.com/package/pm2-windows-startup) helper instead:

```powershell
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

`pm2 save` snapshots the current process list (including `discord-widget2`); `pm2-startup` makes pm2 restore that snapshot on every boot. Done — the widget now survives crashes **and** reboots.

**Day-to-day commands:**

```powershell
pm2 status                     # list processes and their state
pm2 logs discord-widget2       # live logs
pm2 restart discord-widget2    # restart (e.g. after editing .env or updating files)
pm2 stop discord-widget2       # stop without removing
pm2 delete discord-widget2     # remove from pm2 entirely (then pm2 save to persist)
```

> Tip: whenever you add/remove processes and want that reflected at boot, run `pm2 save` again.

**Linux/macOS**: same `pm2` commands work, and native `pm2 startup` is supported (run it and follow the printed instruction, then `pm2 save`). Alternatives: a `systemd` unit or `tmux`/`screen`.

---

## 🔧 Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `ffmpeg NOT FOUND` at startup | ffmpeg isn't on PATH. Install it (`winget install ffmpeg` on Windows) and **open a new terminal**, or set `FFMPEG_PATH` in `.env`. |
| Avatar shows but doesn't animate | Open `data/avatar-preview.gif` locally. If it animates there, the issue is on Discord's side; if not, check the `[avatar]` log lines to see which step failed. |
| `total_games` is 0 / `Most Played: Unknown` | Steam privacy: set **Game details** to Public (separate from profile visibility). |
| `Discord responded 403: Invalid OAuth2 access token` | Re-authorize your app with scopes `openid + sdk.social_layer` and `response_type=token` (see widget setup). |
| Steam API `403 Forbidden ... key=` | Bad `STEAM_API_KEY` (check for quotes/spaces in `.env`). |
| Fields not showing on the widget | The Data Field name in the editor must match the table exactly (case-sensitive) and its Value Type must be **User Data**. |

---

## 📁 Project structure

```
discord-widget-steam/
├── index.js                    # main 60s loop + startup checks
├── env.example                 # .env template
└── src/
    ├── steamApi.js             # Steam Web API calls (summaries, level, badges, games, bans)
    ├── steamProfileScraper.js  # public profile: featured badge + games count fallback
    ├── steamAvatar.js          # equipped avatar frame / animated avatar (all URL candidates)
    ├── avatarCompositor.js     # APNG/GIF detection, normalization, ffmpeg compositing
    ├── avatarIcon.js           # avatar pipeline: pick → compose → verify → preview → upload
    ├── levelIcon.js            # level icon resolver (Steam stylesheet + cache)
    ├── levelImageBuilder.js    # ring/sprite + centered number composition (sharp)
    ├── steamGridDb.js          # hi-res (512px) game icons from SteamGridDB
    ├── banStatus.js            # GetPlayerBans interpretation + check/X icon generator
    ├── banIcon.js              # ban icon upload + cache
    ├── accountAge.js           # created date, age label, member-since year
    ├── imageUploader.js        # anonymous uploads to catbox.moe (PNG/GIF)
    └── discordWidget.js        # payload builder + PATCH to Discord identity endpoint
```

Runtime artifacts (`data/` caches and previews, `node_modules/`, your `.env`) are git-ignored.

---

## ⚠️ Security

- **Never commit your `.env`** — your Discord bot token gives full control of your bot.
- Composited images are uploaded to Catbox anonymously and their URLs are public (they're just your Steam avatar/level/ban icons). Swap `src/imageUploader.js` for your own host (S3, imgbb, etc.) if you prefer.
