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
// Editable settings. After changing any of them, increase CACHE_VERSION
// in src/avatarIcon.js (or delete data/avatar-icon.json) to regenerate.

// Final canvas size in pixels (square). Larger = higher
// quality and less pixelation at the edges of the frame, at the cost of a
// larger GIF. 512 is a good balance
const SIZE = 512;

// Qué fracción del lienzo ocupa TU FOTO en el centro.
const AVATAR_SCALE = 1.0;

// Scale the AVATAR FRAME independently (1.0 = fills the
// entire canvas, like Steam).
const FRAME_SCALE = 1.0;

// Frames per second for the final GIF. More fps = smoother animation
// but a larger file. 20 works well for Discord.
const FPS = 20;

// Transparency threshold (0-255) when quantizing the GIF. Pixels with
// alpha values BELOW this threshold become completely transparent.
const ALPHA_THRESHOLD = 64;

// Maximum duration of the final GIF, in seconds
const MAX_ANIM_SECONDS = 8;

// ======================================================================

const AVATAR_PX = Math.round(SIZE * AVATAR_SCALE);
const AVATAR_OFFSET = Math.max(0, Math.round((SIZE - AVATAR_PX) / 2));
const FRAME_PX = Math.round(SIZE * FRAME_SCALE);
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

// ---- Content-Based Format Detection/Measurement ------------------

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

// Total duration of a GIF in ms, calculated by adding the delays for each frame.
export function gifDurationMs(buf) {
  let total = 0;
  for (let i = 0; i < buf.length - 7; i++) {
    if (isGceAt(buf, i)) {
      const delay = (buf[i + 4] | (buf[i + 5] << 8)) * 10; 
      total += delay > 0 ? delay : 1000 / FPS; // 
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

// ---- Candidate Selection Based on Content ----------------------------

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

// Returns the photo in a SIZE x SIZE canvas, centered.
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
    return avatar;
  }

  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: avatar, top: AVATAR_OFFSET, left: AVATAR_OFFSET }])
    .png()
    .toBuffer();
}

// Returns the frame on a SIZE x SIZE canvas: scaled to FRAME_PX and
// centered. If FRAME_SCALE > 1, the excess is cropped from the edges.
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

// ---- Animated composition ---------------------------------------------


const SCALE_AVATAR =
  AVATAR_PX > SIZE
    ? `scale=${AVATAR_PX}:${AVATAR_PX}:force_original_aspect_ratio=increase:flags=lanczos,crop=${SIZE}:${SIZE}`
    : `scale=${AVATAR_PX}:${AVATAR_PX}:force_original_aspect_ratio=increase:flags=lanczos,crop=${AVATAR_PX}:${AVATAR_PX}`;

const SCALE_FRAME =
  FRAME_PX === SIZE
    ? `scale=${SIZE}:${SIZE}:flags=lanczos`
    : FRAME_PX < SIZE
      ? `scale=${FRAME_PX}:${FRAME_PX}:flags=lanczos,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=black@0.0`
      : `scale=${FRAME_PX}:${FRAME_PX}:flags=lanczos,crop=${SIZE}:${SIZE}`;

async function composeAnimated({ dir, avatarBuf, frameBuf, avatarGifPath, frameGifPath }) {
  const outPath = path.join(dir, "out.gif");

  if (!avatarGifPath && frameGifPath) {
    // A: static avatar + animated frame. The frame defines the duration.
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
    // B: animated avatar + static frame/no frame. The avatar defines
    // the duration
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

  // C: BOTH animated.
  const [avBuf, frBuf] = await Promise.all([readFile(avatarGifPath), readFile(frameGifPath)]);
  const durA = gifDurationMs(avBuf);
  const durF = gifDurationMs(frBuf);
  const targetSec = Math.min(Math.max(durA, durF) / 1000, MAX_ANIM_SECONDS);

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
 * Composes an avatar and frame from buffers previously selected using fetchBestAsset.
 * Returns { buffer, ext, frames }. Throws an error if an animation was expected
 * and the result consists of only 1 frame.
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