// src/levelImageBuilder.js
//
// Creates the level image in the Steam style:
//   - Background ring/shield with a TRANSPARENT INTERIOR
//   - Level number centered above it

import sharp from "sharp";

const OUTPUT_SIZE = 256;
const SPRITE_CELL = 32;
const FONT_STACK = "Arial, DejaVu Sans, sans-serif";

function buildNumberSvg(level) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}">
  <text x="50%" y="50%" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="120" font-weight="bold"
        fill="#ffffff" stroke="#000000" stroke-width="7" paint-order="stroke fill">
    ${level}
  </text>
</svg>`;
}

function buildRingSvg(hexColorNoHash) {
  const cx = OUTPUT_SIZE / 2;
  const strokeWidth = OUTPUT_SIZE * 0.06;
  const r = cx - strokeWidth;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}">
  <circle cx="${cx}" cy="${cx}" r="${r}"
          fill="none" stroke="#${hexColorNoHash}" stroke-width="${strokeWidth}" />
</svg>`;
}

async function renderSvgToPng(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Generate a PNG of the number cropped to its exact bounding box.
async function renderTrimmedNumber(level) {
  return sharp(Buffer.from(buildNumberSvg(level)))
    .png()
    .trim()
    .toBuffer();
}

async function extractShieldFromSprite(spriteUrl, tensBracket) {
  const res = await fetch(spriteUrl);
  if (!res.ok) {
    throw new Error(`Could not download level sprite (${res.status})`);
  }
  const spriteBuffer = Buffer.from(await res.arrayBuffer());

  const rowIndex = Math.floor(tensBracket / 10);
  const top = rowIndex * SPRITE_CELL;

  return sharp(spriteBuffer)
    .extract({ left: 0, top, width: SPRITE_CELL, height: SPRITE_CELL })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      kernel: "nearest",
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

export async function buildLevelPng(level, { borderColor, spriteUrl, tensBracket }) {
  // Background (transparent ring or shield).
  const background = spriteUrl
    ? await extractShieldFromSprite(spriteUrl, tensBracket)
    : await renderSvgToPng(buildRingSvg(borderColor));

  const numberPng = await renderTrimmedNumber(level);

  return sharp(background)
    .composite([{ input: numberPng, gravity: "centre" }])
    .png()
    .toBuffer();
}
