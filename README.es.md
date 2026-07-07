# steam-discord-widget

Actualiza un **Discord Profile Widget (v2)** con datos de tu cuenta de
Steam, corriendo continuamente y refrescando cada 60 segundos.

Datos que envía:

- Nombre + foto de Steam
- Fecha de creación de la cuenta y antigüedad (en inglés: "September
  23, 2019" / "6 years and 9 months")
- Nivel de Steam (número) + **PNG compuesto estilo Steam** (escudo
  oficial de fondo transparente + número centrado encima)
- Total de badges + Featured Badge del perfil (el que configuras en
  "Edit Profile → Featured Showcase → Badge Showcase", no los awards)
- Total de juegos de la biblioteca
- Juego actual o último jugado, con status "Playing now" / "Last played"

Basado en la guía de
[Chloe Cinders](https://chloecinders.com/blog/discord-widgets) y el
enfoque de [ezxmora/discord-widget](https://github.com/ezxmora/discord-widget).

## Cómo funciona

Los widgets v2 de Discord no leen datos en vivo. Tú les mandas un
`PATCH` con los valores actuales al endpoint de "identidad". Este
script arranca un loop infinito que hace ese PATCH cada 60 segundos
con datos frescos de Steam.

### El ícono del nivel (estilo Steam)

Steam nunca guarda una imagen por nivel del 1 al 6100 — arma el
"escudo con número dentro" en tiempo real con HTML+CSS. Discord solo
acepta URLs a PNG, así que este script imita ese proceso:

1. Consulta la hoja de estilos pública de Steam para saber qué
   imagen/color le corresponde a tu nivel actual.
2. **Nivel < 100**: Steam solo dibuja un aro de color. El script
   genera un círculo con ese color exacto **con interior transparente**
   y superpone tu número.
3. **Nivel ≥ 100**: descarga el sprite oficial de Steam, recorta la
   decena que te toca, la escala a 256×256 y superpone el número.
4. El PNG resultante se sube a [Catbox](https://catbox.moe) (upload
   anónimo, sin API key) para tener una URL usable en Discord.
5. Se guarda un mini-registro en `data/level-icon.json` para no
   re-subir el mismo PNG cuando tu nivel no ha cambiado.

### El Featured Badge

El scraper busca **en este orden**, y usa el primero que encuentre:

1. **Badge Collector / Badges Showcase** (`.badge_showcase >
   .showcase_slot.showcase_badge`) — es el showcase que agregas desde
   "Edit Profile → Featured Showcase → Badge Showcase" y donde eliges
   qué badge lucir. Es lo que muestra la URL de ejemplo que diste
   (`community_assets/images/items/...`).
2. **Favorite Badge** en el header del perfil (`.favorite_badge`) —
   badge único al lado del nombre.

Los "Community Awards" (los que muestran texto tipo "This user's
profile has been given the...") **no se toman en cuenta**, así que ya
no vas a ver esos.

### El juego actual / último jugado

En orden de preferencia:

1. Si estás jugando ahora (`gameid` en GetPlayerSummaries) → nombre y
   status "Playing now".
2. Si tienes actividad en las últimas 2 semanas (GetRecentlyPlayedGames)
   → nombre y status "Last played".
3. Si no, se busca el juego con `rtime_last_played` más reciente en
   toda la biblioteca (GetOwnedGames) → status "Last played".
4. Si nada de eso → "No recent activity".

## Data Fields del widget

Configura estos Data Fields en el editor del widget en el Developer
Portal. El script envía todos estos nombres — usa los que hayas
puesto en tu widget. Están también incluidos alias cortos como
`acc_age` / `acc_created` por si ya tenías el widget con esos nombres.

| Nombre del campo      | Tipo   | Contenido                                     |
| ---------------------- | ------ | ----------------------------------------- |
| `steam_name`            | Texto  | Nombre de Steam                           |
| `avatar`                | Imagen | Foto de perfil de Steam                   |
| `account_created` (o `acc_created`) | Texto | "September 23, 2019"        |
| `account_age` (o `acc_age`) | Texto | "6 years and 9 months"                |
| `level`                 | Número | Nivel de Steam                            |
| `level_icon`             | Imagen | PNG compuesto del nivel estilo Steam      |
| `badge_count`            | Número | Total de badges                           |
| `featured_badge_name`     | Texto  | Nombre del featured badge                 |
| `featured_badge_icon`     | Imagen | Ícono del featured badge                  |
| `total_games`             | Número | Total de juegos en la biblioteca          |
| `current_game_name`       | Texto  | Juego actual / último jugado / "No recent activity" |
| `current_game_icon`       | Imagen | Ícono del juego                           |
| `game_status`             | Texto  | "Playing now" / "Last played" / "" (vacío) |

## Setup

```bash
npm install
cp .env.example .env
# Edita .env con Steam API key, SteamID64, Discord App ID, User ID, Bot Token
npm start
```

El programa queda corriendo y refresca cada 60 segundos. Para
detenerlo, Ctrl+C.

## Automatizar en arranque

- **Windows**: crea un acceso directo en la carpeta Startup que ejecute
  `node index.js` desde el directorio del proyecto, o registra un
  Servicio con `nssm` / `node-windows`.
- **Linux/Mac**: usa un servicio de `systemd`, `launchd`, `pm2` o
  `screen`/`tmux` para que corra en segundo plano.

## Limitaciones

- **Perfil privado**: sin perfil público, el scraper de Featured Badge
  no encuentra nada (envía "No featured badge"). El resto de datos
  funciona con la API key.
- **Cambios en el HTML/CSS de Steam**: el ícono del nivel y el
  Featured Badge dependen de que Steam no cambie el marcado. Si lo
  hacen, esos campos entran en fallback (aro de color simple para el
  nivel, "No featured badge" para el otro) sin romper el resto.
- **Catbox**: uploads permanentes y anónimos. Si prefieres otro host
  (imgbb, S3, GitHub Pages, etc.), sustituye `src/imageUploader.js`
  sin tocar el resto del código.
