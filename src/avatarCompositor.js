// src/avatarCompositor.js
//
// Composes the profile photo (bottom) + avatar frame (top) while preserving
// the animation, with DIAGNOSTICS at each step so you can determine
// exactly where the problem lies if the result does not animate:
//
//   [1] Asset selection: ALL candidates are downloaded from the URL, and
//       the animated one (GIF or APNG) is chosen based on CONTENT.
//   [2] Normalization: any animated file is converted to GIF (ffmpeg).
//   [3] Composition: overlay using ffmpeg (or sharp if everything is static).
//   [4] Verification: the frames of the final GIF are counted; if we expect
//       animation and it turns out to be 1 frame, it is reported as an ERROR (not ignored).
//
// ffmpeg: the binary from process.env.FFMPEG_PATH is used if defined,
// otherwise “ffmpeg” from the PATH. checkFfmpeg() allows this to be verified at the beginning.

import sharp from "sharp";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SIZE = 256;
const AVATAR_SCALE = 1;
const AVATAR_PX = Math.round(SIZE * AVATAR_SCALE);
const AVATAR_OFFSET = Math.round((SIZE - AVATAR_PX) / 2);
const FPS = 20;

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

// ---- Diagnosis: Detection and Counting ---------------------------------

export function detectKind(buf) {
  if (!buf || buf.length < 16) return "static";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    // GIF: Is it animated? We count the Graphic Control Extensions (0x21 0xF9).
    return countGifFrames(buf) > 1 ? "gif" : "static";
  }
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (isPng) {
    // APNG: acTL chunk before the first IDAT (always in the header).
    if (buf.includes(Buffer.from("acTL"))) return "apng";
    return "static";
  }
  return "static";
}

// Counts the frames in a GIF using Graphic Control Extension blocks.
export function countGifFrames(buf) {
  let count = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) count++;
  }
  return count;
}

// Checks that ffmpeg exists and is executable. Returns the first
// version line, or throws a clear error.
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

/**
 * Downloads all candidate URLs and returns the best one:
 * the first ANIMATED one, if it exists; otherwise, the first one to load.
 * Returns { buffer, kind, url } or null if there are no valid candidates.
 */
export async function fetchBestAsset(candidateUrls, log = () => {}) {
  const loaded = [];
  for (const url of candidateUrls) {
    try {
      const buffer = await fetchBuffer(url);
      const kind = detectKind(buffer);
      log(`    candidate ${url} -> ${kind} (${buffer.length}b)`);
      loaded.push({ buffer, kind, url });
      if (kind === "gif" || kind === "apng") {
        return loaded[loaded.length - 1]; // The first one to animate wins
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

async function normalizeToGif(dir, name, buf, kind) {
  const inPath = path.join(dir, `${name}_in.${kind === "gif" ? "gif" : "png"}`);
  const outPath = path.join(dir, `${name}.gif`);
  await writeFile(inPath, buf);

  const inputFlags = kind === "apng" ? ["-f", "apng", "-i", inPath] : ["-i", inPath];

  await runFfmpeg([
    "-y",
    ...inputFlags,
    "-filter_complex",
    `fps=${FPS},split[s0][s1];` +
      `[s0]palettegen=stats_mode=diff:reserve_transparent=1[p];` +
      `[s1][p]paletteuse=alpha_threshold=128`,
    outPath,
  ]);

  return outPath;
}

// ---- Static layers (sharp) -----------------------------------------

async function makeCenteredAvatarPng(avatarBuf) {
  const avatar = await sharp(avatarBuf, { animated: false })
    .resize(AVATAR_PX, AVATAR_PX, { fit: "cover" })
    .png()
    .toBuffer();

  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: avatar, top: AVATAR_OFFSET, left: AVATAR_OFFSET }])
    .png()
    .toBuffer();
}

async function frameToCanvasPng(frameBuf) {
  return sharp(frameBuf, { animated: false })
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
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

async function composeAnimated({ dir, avatarBuf, frameBuf, avatarGifPath, frameGifPath }) {
  const outPath = path.join(dir, "out.gif");
  const paletteChain =
    `fps=${FPS},split[o1][o2];` +
    `[o1]palettegen=stats_mode=diff:reserve_transparent=1[p];` +
    `[o2][p]paletteuse=alpha_threshold=128`;

  if (!avatarGifPath && frameGifPath) {
    // A: static avatar + animated frame
    const basePath = path.join(dir, "base.png");
    await writeFile(basePath, await makeCenteredAvatarPng(avatarBuf));
    await runFfmpeg([
      "-y",
      "-loop", "1", "-i", basePath,
      "-i", frameGifPath,
      "-filter_complex",
      `[1:v]scale=${SIZE}:${SIZE}[fr];[0:v][fr]overlay=0:0:shortest=1,${paletteChain}`,
      outPath,
    ]);
    return readFile(outPath);
  }

  if (avatarGifPath && !frameGifPath) {
    // B: animated avatar + static frame / no frame
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
        `[0:v]scale=${AVATAR_PX}:${AVATAR_PX}:force_original_aspect_ratio=increase,` +
        `crop=${AVATAR_PX}:${AVATAR_PX}[av];` +
        `[bg][av]overlay=${AVATAR_OFFSET}:${AVATAR_OFFSET}:shortest=1[base];` +
        `[base][1:v]overlay=0:0:shortest=1,${paletteChain}`,
      outPath,
    ]);
    return readFile(outPath);
  }

  // C: both animated
  await runFfmpeg([
    "-y",
    "-ignore_loop", "0", "-i", avatarGifPath,
    "-i", frameGifPath,
    "-filter_complex",
    `color=c=black@0.0:s=${SIZE}x${SIZE}:r=${FPS}[bg];` +
      `[0:v]scale=${AVATAR_PX}:${AVATAR_PX}:force_original_aspect_ratio=increase,` +
      `crop=${AVATAR_PX}:${AVATAR_PX}[av];` +
      `[bg][av]overlay=${AVATAR_OFFSET}:${AVATAR_OFFSET}:shortest=1[base];` +
      `[1:v]scale=${SIZE}:${SIZE}[fr];` +
      `[base][fr]overlay=0:0:shortest=1,${paletteChain}`,
    outPath,
  ]);
  return readFile(outPath);
}

/**
 * Composes an avatar and frame from pre-selected BUFFERS (use fetchBestAsset
 * to select them). Returns { buffer, ext, frames }:
 *   ext = “png” | “gif”;  frames = number of frames in the result.
 *
 * THROWS an error if an animation was expected but the result was static
 * (no silent fallbacks: the caller decides what to do).
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
      const n = countGifFrames(await readFile(avatarGifPath));
      log(`  normalized avatar -> gif (${n} frames)`);
    }
    if (frameGifPath) {
      const n = countGifFrames(await readFile(frameGifPath));
      log(`  normalized frame -> gif (${n} frames)`);
    }

    const gif = await composeAnimated({ dir, avatarBuf, frameBuf, avatarGifPath, frameGifPath });
    const frames = countGifFrames(gif);
    log(`  composed gif: ${frames} frames, ${gif.length}b`);

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
