// src/imageUploader.js
//
// Uploads an image (PNG or GIF) to imgbbe and returns the public URL.
// Node 18+ includes native FormData/Blob support. IS PERFECT AAAAAAAAAAAAHH

// ============================ CONFIG ==================================
 
//  "imgbb"
const UPLOAD_BACKEND = "imgbb"; // do not forget to set up your IMGBB Key
 
// ======================================================================
 
const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";
 
const USER_AGENT = "steam-discord-widget/1.0 (+https://github.com/)";
 
function mimeFor(filename) {
  if (/\.gif$/i.test(filename)) return "image/gif";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (/\.webp$/i.test(filename)) return "image/webp";
  return "image/png";
}
 
// ---- imgbb -----------------------------------------------------------
 
async function uploadToImgbb(buffer, filename) {
  const key = process.env.IMGBB_API_KEY;
  if (!key) {
    throw new Error(
      'IMGBB_API_KEY missing. Get a free key at https://api.imgbb.com and set ' +
        'it in your .env, or switch UPLOAD_BACKEND to "0x0" in src/imageUploader.js'
    );
  }
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeFor(filename) });
  form.append("image", blob, filename);
 
  const res = await fetch(`${IMGBB_ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`imgbb returned ${res.status}: ${body.slice(0, 300)}`.trim());
  }
  const data = await res.json();
  const url = data?.data?.url;
  if (!url) {
    throw new Error(`imgbb: no url in response ${JSON.stringify(data).slice(0, 200)}`);
  }
  return url;
}
 
// ---- public api ----
 
export async function uploadImage(buffer, filename = "image.png") {
  switch (UPLOAD_BACKEND) {
    case "imgbb": return uploadToImgbb(buffer, filename);
    default:
      throw new Error(
        `Unknown UPLOAD_BACKEND "${UPLOAD_BACKEND}" in imageUploader.js — use "imgbb"`
      );
  }
}
 
export async function isUrlAlive(url) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) {
      res = await fetch(url, { headers: { Range: "bytes=0-0" }, redirect: "follow" });
      if (!res.ok && res.status !== 206) return false;
    }
    const len = Number(res.headers.get("content-length") || 0);
    return len > 0 || (res.headers.get("content-type") || "").startsWith("image/");
  } catch {
    return false;
  }
}