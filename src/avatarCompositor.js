// src/avatarCompositor.js
//
// Compone la foto de perfil (abajo) + avatar frame (encima) preservando
// la animación. Ver el bloque CONFIG justo debajo para los ajustes que
// puedes tocar (tamaño, escala del frame, calidad de bordes, fps).

import sharp from "sharp";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// ============================ CONFIG ==================================
// Ajustes editables. Después de cambiar cualquiera, sube CACHE_VERSION
// en src/avatarIcon.js (o borra data/avatar-icon.json) para regenerar.

// Tamaño del lienzo final en píxeles (cuadrado). Más grande = más
// calidad y menos pixelado en los bordes del frame, a costa de un GIF
// más pesado. 512 es un buen balance (Discord lo muestra pequeño).
const SIZE = 512;

// Qué fracción del lienzo ocupa TU FOTO en el centro. El frame siempre
// llena el lienzo completo, así que:
//   - BAJAR este valor (p.ej. 0.55) => foto más pequeña => el frame se
//     ve MÁS GRANDE/grueso alrededor.
//   - SUBIRLO (p.ej. 0.70) => foto más grande => el frame se ve MÁS
//     PEQUEÑO/fino (y puede tapar los bordes de la foto).
// El perfil real de Steam usa aproximadamente 0.62.
const AVATAR_SCALE = 1.0;

// Escala del AVATAR FRAME de forma independiente (1.0 = llena el
// lienzo completo, como Steam).
//   - BAJAR (p.ej. 0.90) => frame más pequeño, centrado, dejando aire
//     transparente alrededor.
//   - SUBIR (p.ej. 1.15) => frame más grande; lo que sobresalga del
//     lienzo se recorta por los bordes.
const FRAME_SCALE = 1.0;

// Frames por segundo del GIF final. Más fps = animación más fluida
// pero archivo más pesado. 20 va bien para Discord.
const FPS = 20;

// Umbral de transparencia (0-255) al cuantizar el GIF. Los píxeles con
// alpha POR DEBAJO de este valor se vuelven totalmente transparentes.
// El GIF solo soporta transparencia de 1 bit, así que los bordes
// suaves/semitransparentes de los frames se pierden si el umbral es
// alto. Con 128 se "comían" los bordes; 64 conserva mucho más detalle.
// Si aún ves bordes comidos, baja a 32 (riesgo: leve halo oscuro).
const ALPHA_THRESHOLD = 64;

// Duración máxima del GIF final, en segundos (tope de seguridad para
// avatares con ciclos larguísimos; limita el peso del archivo).
const MAX_ANIM_SECONDS = 8;
// ======================================================================

const AVATAR_PX = Math.round(SIZE * AVATAR_SCALE);
// Si la foto es mayor que el lienzo (AVATAR_SCALE > 1) se recorta a
// SIZE, así que el offset de colocación nunca es negativo.
const AVATAR_OFFSET = Math.max(0, Math.round((SIZE - AVATAR_PX) / 2));
const FRAME_PX = Math.round(SIZE * FRAME_SCALE);
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

// ---- Detección / medición de formatos por contenido ------------------

export function detectKind(buf) {
  if (!buf || buf.length < 16) return "static";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return countGifFrames(buf) > 1 ? "gif" : "static";
  }
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (isPng) {
    if (buf.includes(Buffer.from("acTL"))) return "apng";
    return "static";
  }
  return "static";
}

// Los bloques Graphic Control Extension tienen estructura FIJA:
//   0x21 0xF9 0x04 <flags> <delayLo> <delayHi> <transparentIdx> 0x00
// Validar el byte de tamaño (0x04) y el terminador (0x00) evita falsos
// positivos del patrón "21 F9" apareciendo dentro de datos de imagen
// comprimidos (que inflaban el conteo y la duración).
function isGceAt(buf, i) {
  return (
    buf[i] === 0x21 &&
    buf[i + 1] === 0xf9 &&
    buf[i + 2] === 0x04 &&
    buf[i + 7] === 0x00
  );
}

export function countGifFrames(buf) {
  let count = 0;
  for (let i = 0; i < buf.length - 7; i++) {
    if (isGceAt(buf, i)) count++;
  }
  return count;
}

// Duración total de un GIF en ms, sumando los delays de cada frame.
export function gifDurationMs(buf) {
  let total = 0;
  for (let i = 0; i < buf.length - 7; i++) {
    if (isGceAt(buf, i)) {
      const delay = (buf[i + 4] | (buf[i + 5] << 8)) * 10; // centiseg -> ms
      total += delay > 0 ? delay : 1000 / FPS; // delay 0 => asumir 1 frame a FPS
    }
  }
  return total;
}

export function checkFfmpeg() {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ["-version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", (err) =>
      reject(
        new Error(
          `ffmpeg NOT FOUND ("${FFMPEG_BIN}"). Animated avatars will NOT work. ` +
            `Install ffmpeg and make sure it's in PATH, or set FFMPEG_PATH in .env. (${err.message})`
        )
      )
    );
    proc.on("close", (code) => {
      if (code === 0) resolve(out.split("\n")[0]);
      else reject(new Error(`ffmpeg exists but exited ${code}`));
    });
  });
}

// ---- Selección de candidato por contenido ----------------------------

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchBestAsset(candidateUrls, log = () => {}) {
  const loaded = [];
  for (const url of candidateUrls) {
    try {
      const buffer = await fetchBuffer(url);
      const kind = detectKind(buffer);
      log(`    candidate ${url} -> ${kind} (${buffer.length}b)`);
      loaded.push({ buffer, kind, url });
      if (kind === "gif" || kind === "apng") {
        return loaded[loaded.length - 1];
      }
    } catch (err) {
      log(`    candidate ${url} -> FAILED (${err.message})`);
    }
  }
  return loaded[0] ?? null;
}

// ---- ffmpeg ----------------------------------------------------------

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

const PALETTE_CHAIN =
  `fps=${FPS},split[o1][o2];` +
  `[o1]palettegen=stats_mode=diff:reserve_transparent=1[p];` +
  `[o2][p]paletteuse=alpha_threshold=${ALPHA_THRESHOLD}`;

async function normalizeToGif(dir, name, buf, kind) {
  const inPath = path.join(dir, `${name}_in.${kind === "gif" ? "gif" : "png"}`);
  const outPath = path.join(dir, `${name}.gif`);
  await writeFile(inPath, buf);

  const inputFlags = kind === "apng" ? ["-f", "apng", "-i", inPath] : ["-i", inPath];

  await runFfmpeg(["-y", ...inputFlags, "-filter_complex", PALETTE_CHAIN, outPath]);
  return outPath;
}

// ---- Capas estáticas (sharp) -----------------------------------------

// Devuelve la foto en un lienzo SIZE x SIZE, centrada. Soporta
// AVATAR_SCALE > 1: la foto se escala más grande que el lienzo y se
// recorta el centro (sharp no permite componer una capa mayor que la
// base, así que hay que recortar ANTES de componer).
async function makeCenteredAvatarPng(avatarBuf) {
  let avatar = await sharp(avatarBuf, { animated: false })
    .resize(AVATAR_PX, AVATAR_PX, { fit: "cover" })
    .png()
    .toBuffer();

  if (AVATAR_PX >= SIZE) {
    if (AVATAR_PX > SIZE) {
      const off = Math.round((AVATAR_PX - SIZE) / 2);
      avatar = await sharp(avatar)
        .extract({ left: off, top: off, width: SIZE, height: SIZE })
        .png()
        .toBuffer();
    }
    return avatar; // la foto llena el lienzo completo
  }

  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: avatar, top: AVATAR_OFFSET, left: AVATAR_OFFSET }])
    .png()
    .toBuffer();
}

// Devuelve el frame en un lienzo SIZE x SIZE: escalado a FRAME_PX y
// centrado. Si FRAME_SCALE > 1, el sobrante se recorta por los bordes.
async function frameToCanvasPng(frameBuf) {
  let frame = await sharp(frameBuf, { animated: false })
    .resize(FRAME_PX, FRAME_PX, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  if (FRAME_PX > SIZE) {
    const off = Math.round((FRAME_PX - SIZE) / 2);
    frame = await sharp(frame).extract({ left: off, top: off, width: SIZE, height: SIZE }).png().toBuffer();
    return frame;
  }

  const off = Math.round((SIZE - FRAME_PX) / 2);
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: frame, top: off, left: off }])
    .png()
    .toBuffer();
}

async function transparentCanvasPng() {
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
}

async function composeStaticPng(avatarBuf, frameBuf) {
  const base = await makeCenteredAvatarPng(avatarBuf);
  if (!frameBuf) return base;
  const frame = await frameToCanvasPng(frameBuf);
  return sharp(base).composite([{ input: frame, top: 0, left: 0 }]).png().toBuffer();
}

// ---- Composición animada ---------------------------------------------

// Escalado con lanczos (bordes más nítidos que el bilinear por defecto).
// Si AVATAR_PX > SIZE, tras escalar se recorta el centro a SIZE para
// que el overlay nunca exceda el lienzo (offset negativo evitado).
const SCALE_AVATAR =
  AVATAR_PX > SIZE
    ? `scale=${AVATAR_PX}:${AVATAR_PX}:force_original_aspect_ratio=increase:flags=lanczos,crop=${SIZE}:${SIZE}`
    : `scale=${AVATAR_PX}:${AVATAR_PX}:force_original_aspect_ratio=increase:flags=lanczos,crop=${AVATAR_PX}:${AVATAR_PX}`;
// Escala el frame a FRAME_PX y lo deja en un lienzo SIZE x SIZE:
// pad transparente centrado si es menor, crop centrado si es mayor.
const SCALE_FRAME =
  FRAME_PX === SIZE
    ? `scale=${SIZE}:${SIZE}:flags=lanczos`
    : FRAME_PX < SIZE
      ? `scale=${FRAME_PX}:${FRAME_PX}:flags=lanczos,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=black@0.0`
      : `scale=${FRAME_PX}:${FRAME_PX}:flags=lanczos,crop=${SIZE}:${SIZE}`;

async function composeAnimated({ dir, avatarBuf, frameBuf, avatarGifPath, frameGifPath }) {
  const outPath = path.join(dir, "out.gif");

  if (!avatarGifPath && frameGifPath) {
    // A: avatar estático + frame animado. El frame define la duración.
    const basePath = path.join(dir, "base.png");
    await writeFile(basePath, await makeCenteredAvatarPng(avatarBuf));
    await runFfmpeg([
      "-y",
      "-loop", "1", "-i", basePath,
      "-i", frameGifPath,
      "-filter_complex",
      `[1:v]${SCALE_FRAME}[fr];[0:v][fr]overlay=0:0:shortest=1,${PALETTE_CHAIN}`,
      outPath,
    ]);
    return readFile(outPath);
  }

  if (avatarGifPath && !frameGifPath) {
    // B: avatar animado + frame estático/sin frame. El avatar define
    // la duración (su ciclo completo se conserva).
    const overlayPath = path.join(dir, "frame.png");
    await writeFile(
      overlayPath,
      frameBuf ? await frameToCanvasPng(frameBuf) : await transparentCanvasPng()
    );
    await runFfmpeg([
      "-y",
      "-i", avatarGifPath,
      "-loop", "1", "-i", overlayPath,
      "-filter_complex",
      `color=c=black@0.0:s=${SIZE}x${SIZE}:r=${FPS}[bg];` +
        `[0:v]${SCALE_AVATAR}[av];` +
        `[bg][av]overlay=${AVATAR_OFFSET}:${AVATAR_OFFSET}:shortest=1[base];` +
        `[base][1:v]overlay=0:0:shortest=1,${PALETTE_CHAIN}`,
      outPath,
    ]);
    return readFile(outPath);
  }

  // C: AMBOS animados.
  // FIX del bug "solo 2 frames": antes se cortaba en el ciclo del input
  // MÁS CORTO (shortest=1), así que un frame con ciclo de 0.1s cortaba
  // un avatar de 3s a 2 frames. Ahora:
  //   - medimos la duración de ambos GIFs ya normalizados,
  //   - loopeamos ambos infinitamente (-ignore_loop 0),
  //   - y cortamos con -t en la duración del MÁS LARGO (con tope),
  // de modo que la animación más larga completa su ciclo y la corta
  // simplemente se repite.
  const [avBuf, frBuf] = await Promise.all([readFile(avatarGifPath), readFile(frameGifPath)]);
  const durA = gifDurationMs(avBuf);
  const durF = gifDurationMs(frBuf);
  const targetSec = Math.min(Math.max(durA, durF) / 1000, MAX_ANIM_SECONDS);

  // IMPORTANTE: el "-t" va como opción DE ENTRADA (antes de cada -i).
  // palettegen necesita ver el EOF para emitir la paleta; con inputs
  // infinitos (-ignore_loop 0) y un -t solo de salida, el filtro nunca
  // termina y ffmpeg se queda sin memoria. Truncar cada INPUT en el
  // tiempo objetivo garantiza el EOF.
  // Tres fuentes deben quedar ACOTADAS para que palettegen reciba el
  // EOF (si alguna es infinita, ffmpeg acumula frames sin fin y muere
  // por memoria): los dos GIFs con "-t" DE ENTRADA, y el color de
  // fondo con ":d=" en el filtro.
  const t = targetSec.toFixed(3);
  await runFfmpeg([
    "-y",
    "-ignore_loop", "0", "-t", t, "-i", avatarGifPath,
    "-ignore_loop", "0", "-t", t, "-i", frameGifPath,
    "-filter_complex",
    `color=c=black@0.0:s=${SIZE}x${SIZE}:r=${FPS}:d=${t}[bg];` +
      `[0:v]${SCALE_AVATAR}[av];` +
      `[bg][av]overlay=${AVATAR_OFFSET}:${AVATAR_OFFSET}:shortest=1[base];` +
      `[1:v]${SCALE_FRAME}[fr];` +
      `[base][fr]overlay=0:0,${PALETTE_CHAIN}`,
    outPath,
  ]);
  return readFile(outPath);
}

/**
 * Compone avatar + frame desde buffers ya elegidos con fetchBestAsset.
 * Devuelve { buffer, ext, frames }. Lanza error si se esperaba
 * animación y el resultado salió de 1 frame.
 */
export async function composeFromBuffers(avatarAsset, frameAsset, log = () => {}) {
  const avatarBuf = avatarAsset.buffer;
  const frameBuf = frameAsset?.buffer ?? null;
  const avatarKind = avatarAsset.kind;
  const frameKind = frameAsset?.kind ?? "static";

  log(`  compose: avatar=${avatarKind}, frame=${frameKind}`);

  const anyAnimated = avatarKind !== "static" || frameKind !== "static";

  if (!anyAnimated) {
    const png = await composeStaticPng(avatarBuf, frameBuf);
    return { buffer: png, ext: "png", frames: 1 };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "avatarcomp-"));
  try {
    const avatarGifPath =
      avatarKind !== "static" ? await normalizeToGif(dir, "avatar", avatarBuf, avatarKind) : null;
    const frameGifPath =
      frameKind !== "static" ? await normalizeToGif(dir, "frame", frameBuf, frameKind) : null;

    if (avatarGifPath) {
      const b = await readFile(avatarGifPath);
      log(`  normalized avatar -> gif (${countGifFrames(b)} frames, ${gifDurationMs(b)}ms)`);
    }
    if (frameGifPath) {
      const b = await readFile(frameGifPath);
      log(`  normalized frame -> gif (${countGifFrames(b)} frames, ${gifDurationMs(b)}ms)`);
    }

    const gif = await composeAnimated({ dir, avatarBuf, frameBuf, avatarGifPath, frameGifPath });
    const frames = countGifFrames(gif);
    log(`  composed gif: ${frames} frames, ${gifDurationMs(gif)}ms, ${gif.length}b`);

    if (frames <= 1) {
      throw new Error(
        `Composition produced a single-frame GIF (expected animation). ` +
          `avatar=${avatarKind}, frame=${frameKind}`
      );
    }

    return { buffer: gif, ext: "gif", frames };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}