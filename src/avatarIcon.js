// src/avatarIcon.js
//
// Orquesta el avatar compuesto (foto + frame) con diagnóstico completo:
//
//   1. Pide a Steam los CANDIDATOS de frame y avatar animado.
//   2. Descarga todos y elige por CONTENIDO cuál es el animado
//      (Steam no documenta si image_large o image_small es la APNG).
//   3. Compone (avatarCompositor) verificando el nº de frames.
//   4. Guarda una copia local en data/avatar-preview.{png|gif} para
//      poder abrirla y comprobar A OJO si el archivo generado anima.
//      -> Si el preview local anima pero Discord no: problema de
//         Discord/upload. Si el preview no anima: problema nuestro,
//         y el log dice en qué eslabón.
//   5. Sube a Catbox y cachea { signature, url } para no repetir
//      trabajo si nada cambió.
//
// Todo el proceso se loguea con el prefijo [avatar] para que puedas
// pegarme el log y ver exactamente qué pasó.

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
 * @returns {Promise<string>} URL final del avatar (compuesto o plano).
 */
export async function resolveComposedAvatarUrl(apiKey, steamId, avatarFullUrl) {
  const { frameCandidates, avatarCandidates } = await getEquippedProfileItems(
    apiKey,
    steamId
  );

  log(`frame candidates: ${frameCandidates.length}, animated-avatar candidates: ${avatarCandidates.length}`);

  // Elegir el frame REALMENTE animado si existe (por contenido).
  const frameAsset =
    frameCandidates.length > 0 ? await fetchBestAsset(frameCandidates, log) : null;

  // Avatar base: el animado equipado si existe; si no, la foto normal.
  let avatarAsset =
    avatarCandidates.length > 0 ? await fetchBestAsset(avatarCandidates, log) : null;

  if (!avatarAsset) {
    const res = await fetch(avatarFullUrl);
    if (!res.ok) throw new Error(`Could not fetch avatarfull (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    avatarAsset = { buffer, kind: detectKind(buffer), url: avatarFullUrl };
    log(`using avatarfull -> ${avatarAsset.kind}`);
  }

  // Sin frame y avatar estático: nada que componer.
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

  // Esquinas redondeadas estilo D.W.I.F. (toggle en src/imageRounder.js).
  const { buffer, ext } = await applyRounding(
    { buffer: composed.buffer, ext: composed.ext },
    log
  );
  const frames = composed.frames;

  // Preview local para inspección manual.
  await mkdir(path.dirname(PREVIEW_BASE), { recursive: true });
  const previewPath = `${PREVIEW_BASE}.${ext}`;
  await writeFile(previewPath, buffer);
  log(`preview saved -> ${previewPath} (open it locally to verify animation)`);

  const url = await uploadImage(buffer, `steam-avatar.${ext}`);
  log(`uploaded (${frames} frame${frames === 1 ? "" : "s"}) -> ${url}`);

  await writeCache({ signature: sig, url });
  return url;
}
