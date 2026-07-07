// src/avatarIcon.js
//
// Assembles the composite avatar (photo + frame) with full diagnostics:
//
//   1. Requests the frame and animated avatar CANDIDATES from Steam.
//   2. Download all of them and determine which one is animated based on its CONTENT
//      (Steam does not specify whether image_large or image_small is the APNG).
//   3. Compose (avatarCompositor) while verifying the number of frames.
//   4. Save a local copy in data/avatar-preview.{png|gif} so
//      you can open it and visually check if the generated file animates.
//      -> If the local preview animates but Discord doesn’t: a
//         Discord/upload issue. If the preview doesn’t animate: our issue,
//         and the log indicates which step caused it.
//   5. Upload to Catbox and cache { signature, url } so you don’t have to repeat
//      the work if nothing has changed.
//
// The entire process is logged with the prefix [avatar] so you can
// paste the log for me and see exactly what happened.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getEquippedProfileItems } from "./steamAvatar.js";
import { fetchBestAsset, composeFromBuffers, detectKind } from "./avatarCompositor.js";
import { uploadImage } from "./imageUploader.js";

const CACHE_PATH = path.resolve("data/avatar-icon.json");
const PREVIEW_BASE = path.resolve("data/avatar-preview");
const CACHE_VERSION = 4; // v4: candidate selection based on content + verification

const log = (msg) => console.log(`  [avatar] ${msg}`);

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

async function writeCache(entry) {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(entry, null, 2));
}

function signature(parts) {
  return crypto
    .createHash("sha1")
    .update(`v${CACHE_VERSION}|${parts.join("|")}`)
    .digest("hex");
}

/**
 * @returns {Promise<string>} Final avatar URL (composite or flat).
 */
export async function resolveComposedAvatarUrl(apiKey, steamId, avatarFullUrl) {
  const { frameCandidates, avatarCandidates } = await getEquippedProfileItems(
    apiKey,
    steamId
  );

  log(`frame candidates: ${frameCandidates.length}, animated-avatar candidates: ${avatarCandidates.length}`);

  // Select the ACTUALLY animated frame, if it exists (based on content).
  const frameAsset =
    frameCandidates.length > 0 ? await fetchBestAsset(frameCandidates, log) : null;

  // Default avatar: the animated avatar, if available; otherwise, the regular photo.
  let avatarAsset =
    avatarCandidates.length > 0 ? await fetchBestAsset(avatarCandidates, log) : null;

  if (!avatarAsset) {
    const res = await fetch(avatarFullUrl);
    if (!res.ok) throw new Error(`Could not fetch avatarfull (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    avatarAsset = { buffer, kind: detectKind(buffer), url: avatarFullUrl };
    log(`using avatarfull -> ${avatarAsset.kind}`);
  }

  // No frame and a static avatar: nothing to compose.
  if (!frameAsset && avatarAsset.kind === "static") {
    log("no frame equipped and static avatar -> using plain avatarfull URL");
    return avatarFullUrl;
  }

  const sig = signature([avatarAsset.url, frameAsset?.url ?? "noframe"]);
  const cached = await readCache();
  if (cached && cached.signature === sig && cached.url) {
    log(`cache hit -> ${cached.url}`);
    return cached.url;
  }

  const { buffer, ext, frames } = await composeFromBuffers(avatarAsset, frameAsset, log);

  // Local preview for manual inspection.
  await mkdir(path.dirname(PREVIEW_BASE), { recursive: true });
  const previewPath = `${PREVIEW_BASE}.${ext}`;
  await writeFile(previewPath, buffer);
  log(`preview saved -> ${previewPath} (open it locally to verify animation)`);

  const url = await uploadImage(buffer, `steam-avatar.${ext}`);
  log(`uploaded (${frames} frame${frames === 1 ? "" : "s"}) -> ${url}`);

  await writeCache({ signature: sig, url });
  return url;
}
