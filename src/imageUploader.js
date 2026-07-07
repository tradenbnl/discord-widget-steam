// src/imageUploader.js
//
// Uploads an image (PNG or GIF) to Catbox.moe and returns the public URL.
// Catbox: no API key, no account, permanent uploads. Node 18+ includes
// native FormData/Blob support.

const CATBOX_ENDPOINT = "https://catbox.moe/user/api.php";

function mimeFor(filename) {
  if (/\.gif$/i.test(filename)) return "image/gif";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (/\.webp$/i.test(filename)) return "image/webp";
  return "image/png";
}

export async function uploadImage(buffer, filename = "image.png") {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("userhash", "");
  form.append(
    "fileToUpload",
    new Blob([buffer], { type: mimeFor(filename) }),
    filename
  );

  const res = await fetch(CATBOX_ENDPOINT, { method: "POST", body: form });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Catbox returned ${res.status}: ${body}`.trim());
  }

  const url = (await res.text()).trim();
  if (!url.startsWith("https://")) {
    throw new Error(`Catbox returned unexpected response: ${url}`);
  }
  return url;
}
