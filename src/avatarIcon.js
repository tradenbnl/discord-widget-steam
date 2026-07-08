// src/avatarIcon.js
//
// Generates the composite avatar (photo + frame) with a complete diagnosis:
//
//   1. Requests the frame and animated avatar CANDIDATES from Steam.
//   2. Downloads all of them and selects the animated one based on CONTENT
//      (Steam does not specify whether image_large or image_small is the APNG).
//   3. Compose (avatarCompositor) while verifying the number of frames.
//   4. Save a local copy in data/avatar-preview.{png|gif} so
//      you can open it and visually check if the generated file animates.
//      -> If the local preview animates but Discord doesn’t: a problem with
//         Discord/upload. If the preview doesn’t animate: our problem,
//         and the log will indicate where the issue lies.
//   5. Upload to Catbox and cache { signature, url } to avoid repeating
//      the work if nothing has changed.
//

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getEquippedProfileItems } from "./steamAvatar.js";
import { fetchBestAsset, composeFromBuffers, detectKind } from "./avatarCompositor.js";
import { applyRounding } from "./imageRounder.js";
import { uploadImage } from "./imageUploader.js";

const CACHE_PATH = path.resolve("data/avatar-icon.json");
const PREVIEW_BASE = path.resolve("data/avatar-preview");
const CACHE_VERSION = 6; // v6: esquinas redondeadas D.W.I.F. (imageRounder)

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
 * @returns {Promise<string>} Final URL of the avatar (composite or flat).
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

  const composed = await composeFromBuffers(avatarAsset, frameAsset, log);

  // D.W.I.F.-style rounded corners (toggle in src/imageRounder.js).
  const { buffer, ext } = await applyRounding(
    { buffer: composed.buffer, ext: composed.ext },
    log
  );
  const frames = composed.frames;

  // local prview 
  await mkdir(path.dirname(PREVIEW_BASE), { recursive: true });
  const previewPath = `${PREVIEW_BASE}.${ext}`;
  await writeFile(previewPath, buffer);
  log(`preview saved -> ${previewPath} (open it locally to verify animation)`);

  const url = await uploadImage(buffer, `steam-avatar.${ext}`);
  log(`uploaded (${frames} frame${frames === 1 ? "" : "s"}) -> ${url}`);

  await writeCache({ signature: sig, url });
  return url;
}
