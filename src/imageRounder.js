// src/imageRounder.js
// This fixes the weird edges for the pfp in discord
// by rounding the top-right corner or all corners


import sharp from "sharp";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// ============================ CONFIG ==================================

export const ROUNDED_CORNERS_ENABLED = true; //Rounded borders true or false

const RADIUS_RATIO = 0.05; // Radius for borders
const RADIUS_PX = 0;

// PUSH DOWN: How many pixels the image is moved downward.
// The final size of the image does NOT change; any excess at the bottom is removed.
const TOP_STRIP = 17;

const FPS = 20; // FPS when re-encoding GIFs (keep the same as avatarCompositor).
const ALPHA_THRESHOLD = 64; // Alpha threshold when re-quantizing the GIF (same as avatarCompositor).

// ======================================================================

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

function computeRadius(width, height) {
  if (RADIUS_PX > 0) return RADIUS_PX;
  return Math.round(Math.min(width, height) * RADIUS_RATIO);
}

function gifDimensions(buf) {
  return {
    width: buf[6] | (buf[7] << 8),
    height: buf[8] | (buf[9] << 8),
  };
}

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


// Mask: rounded rectangle, all corners rounded!!
/*
function buildMaskSvg(width, height, radius, forSharp) {
  const fill = "#ffffff";
  const bg = forSharp ? "" : `<rect width="${width}" height="${height}" fill="#000000"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${bg}
  <rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${fill}"/>
</svg>`;
}
*/


// Mask: Only the top-right corner is rounded
function buildMaskSvg(width, height, radius, topStrip, forSharp) {
  const fill = "#ffffff";
  const bg = forSharp ? "" : `<rect width="${width}" height="${height}" fill="#000000"/>`;
  
  const topRect = topStrip > 0 
    ? `<rect x="0" y="0" width="${width}" height="${topStrip}" fill="${fill}"/>` 
    : "";

  const pathData = `
    M 0,${topStrip} 
    H ${width - radius} 
    A ${radius},${radius} 0 0 1 ${width},${topStrip + radius} 
    V ${height} 
    H 0 
    Z
  `.trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${bg}
  ${topRect}
  <path d="${pathData}" fill="${fill}"/>
</svg>`;
}

// ---- PNG (sharp) ------------------------------------------------------

async function roundPng(buffer) {
  let img = sharp(buffer, { animated: false }).ensureAlpha();
  let { width, height } = await img.metadata();

  if (TOP_STRIP > 0) {
    img = img
      .extend({
        top: TOP_STRIP,
        bottom: 0,
        left: 0,
        right: 0,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .extract({
        left: 0,
        top: 0,
        width: width,
        height: height
      });
  }

  const contentHeight = Math.max(height - TOP_STRIP, 0);
  const radius = computeRadius(width, contentHeight);
  const clampedRadius = Math.min(radius, width, contentHeight);

  const mask = Buffer.from(buildMaskSvg(width, height, clampedRadius, TOP_STRIP, true));

  return img
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// ---- GIF (ffmpeg) -----------------------------------------------------

async function roundGif(buffer) {
  const { width, height } = gifDimensions(buffer);
  const contentHeight = Math.max(height - TOP_STRIP, 0);
  const radius = computeRadius(width, contentHeight);
  const clampedRadius = Math.min(radius, width, contentHeight);

  const dir = await mkdtemp(path.join(tmpdir(), "rounder-"));
  try {
    const gifPath = path.join(dir, "in.gif");
    const maskPath = path.join(dir, "mask.png");
    const outPath = path.join(dir, "out.gif");

    await writeFile(gifPath, buffer);
    await writeFile(
      maskPath,
      await sharp(Buffer.from(buildMaskSvg(width, height, clampedRadius, TOP_STRIP, false))).png().toBuffer()
    );

    const shiftFilter = TOP_STRIP > 0 
      ? `pad=${width}:${height + TOP_STRIP}:0:${TOP_STRIP}:color=0x00000000,crop=${width}:${height}:0:0,` 
      : "";

    await runFfmpeg([
      "-y",
      "-i", gifPath,
      "-loop", "1", "-i", maskPath,
      "-filter_complex",
      `[0:v]${shiftFilter}format=rgba,split[c][ax];` +
        `[ax]alphaextract[a0];` +
        `[1:v]format=gray[mk];` +
        `[a0][mk]blend=all_mode=multiply:shortest=1[na];` +
        `[c][na]alphamerge,fps=${FPS},split[o1][o2];` +
        `[o1]palettegen=stats_mode=diff:reserve_transparent=1[p];` +
        `[o2][p]paletteuse=alpha_threshold=${ALPHA_THRESHOLD}`,
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---- public API -------------------------------------------------------

export async function applyRounding(asset, log = () => {}) {
  if (!ROUNDED_CORNERS_ENABLED) return asset;

  try {
    if (asset.ext === "gif") {
      const rounded = await roundGif(asset.buffer);
      log(`  [rounder] gif corners rounded (${asset.buffer.length}b -> ${rounded.length}b)`);
      return { buffer: rounded, ext: "gif" };
    }
    const rounded = await roundPng(asset.buffer);
    log(`  [rounder] png corners rounded (${asset.buffer.length}b -> ${rounded.length}b)`);
    return { buffer: rounded, ext: "png" };
  } catch (err) {
    log(`  [rounder] FAILED, using original image: ${err.message.split("\n")[0]}`);
    return asset;
  }
}