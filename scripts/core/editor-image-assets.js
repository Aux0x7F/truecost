const DEFAULT_IMAGE_ASSET = Object.freeze({
  id: "",
  name: "",
  mimeType: "",
  byteSize: 0,
  localDataUrl: "",
  publishUrl: "",
  bakedPath: "",
  blobSha256: "",
  uploadStatus: "local",
  alt: "",
  caption: "",
  tags: [],
  linkedEntities: [],
  width: 0,
  height: 0,
  focusX: 0.5,
  focusY: 0.5,
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  rotationQuarterTurns: 0,
  flipX: false,
  flipY: false,
  createdAt: "",
  updatedAt: ""
});

const INVESTIGATION_BAKED_IMAGE_ROOT = "./content/investigation-assets";

export function createImageAssetId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `img-${globalThis.crypto.randomUUID()}`;
  }
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeImageAsset(asset = {}) {
  const source = asset && typeof asset === "object" ? asset : {};
  const now = new Date().toISOString();
  return {
    ...DEFAULT_IMAGE_ASSET,
    id: String(source.id || "").trim() || createImageAssetId(),
    name: String(source.name || "").trim(),
    mimeType: String(source.mimeType || source.type || "").trim(),
    byteSize: Number.isFinite(Number(source.byteSize || source.size)) ? Number(source.byteSize || source.size) : 0,
    localDataUrl: String(source.localDataUrl || source.localUrl || "").trim(),
    publishUrl: String(source.publishUrl || source.url || "").trim(),
    bakedPath: String(source.bakedPath || "").trim(),
    blobSha256: String(source.blobSha256 || source.sha256 || "").trim(),
    uploadStatus: normalizeUploadStatus(source.uploadStatus || source.status || ""),
    alt: String(source.alt || "").trim(),
    caption: String(source.caption || "").trim(),
    tags: normalizeStringArray(source.tags),
    linkedEntities: normalizeStringArray(source.linkedEntities || source.entities),
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : 0,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : 0,
    focusX: clampFraction(source.focusX, 0.5),
    focusY: clampFraction(source.focusY, 0.5),
    cropX: clampFraction(source.cropX, 0),
    cropY: clampFraction(source.cropY, 0),
    cropWidth: clampFraction(source.cropWidth, 1),
    cropHeight: clampFraction(source.cropHeight, 1),
    rotationQuarterTurns: normalizeQuarterTurns(source.rotationQuarterTurns),
    flipX: Boolean(source.flipX),
    flipY: Boolean(source.flipY),
    createdAt: String(source.createdAt || now).trim() || now,
    updatedAt: String(source.updatedAt || now).trim() || now
  };
}

export function normalizeImageAssets(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeImageAsset(value))
    .filter((asset) => {
      if (!asset.id || seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    });
}

export function updateImageAsset(asset = {}, patch = {}) {
  return normalizeImageAsset({
    ...asset,
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

export function resolveImageAssetUrl(asset = {}, { preferBaked = false } = {}) {
  const normalized = normalizeImageAsset(asset);
  if (preferBaked && normalized.bakedPath) return normalized.bakedPath;
  return normalized.bakedPath || normalized.publishUrl || normalized.localDataUrl || "";
}

export function deriveInvestigationImageBakedPath(slug = "", asset = {}) {
  const normalized = normalizeImageAsset(asset);
  const cleanSlug = cleanPathSegment(slug) || "unsaved";
  const cleanName = cleanPathSegment(normalized.name) || "image";
  const fileStem = String(normalized.blobSha256 || normalized.id || cleanName).trim().toLowerCase();
  const extension = inferImageAssetExtension(normalized);
  if (!fileStem) return "";
  return `${INVESTIGATION_BAKED_IMAGE_ROOT}/${cleanSlug}/${fileStem}.${extension}`;
}

export function serializeImageAssetForDraft(asset = {}, { slug = "" } = {}) {
  const normalized = normalizeImageAsset(asset);
  const bakedPath = normalized.bakedPath || deriveInvestigationImageBakedPath(slug, normalized);
  return {
    id: normalized.id,
    name: normalized.name,
    mimeType: normalized.mimeType,
    byteSize: normalized.byteSize,
    publishUrl: normalized.publishUrl,
    bakedPath,
    blobSha256: normalized.blobSha256,
    uploadStatus: normalized.uploadStatus,
    alt: normalized.alt,
    caption: normalized.caption,
    tags: normalized.tags.slice(),
    linkedEntities: normalized.linkedEntities.slice(),
    width: normalized.width,
    height: normalized.height,
    focusX: normalized.focusX,
    focusY: normalized.focusY,
    cropX: normalized.cropX,
    cropY: normalized.cropY,
    cropWidth: normalized.cropWidth,
    cropHeight: normalized.cropHeight,
    rotationQuarterTurns: normalized.rotationQuarterTurns,
    flipX: normalized.flipX,
    flipY: normalized.flipY,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt
  };
}

export function serializeImageAssetForLocalState(asset = {}) {
  const normalized = normalizeImageAsset(asset);
  return {
    ...serializeImageAssetForDraft(normalized),
    localDataUrl: normalized.localDataUrl
  };
}

export function filterImageAssets(assets = [], query = "") {
  const clean = String(query || "").trim().toLowerCase();
  const normalized = normalizeImageAssets(assets);
  if (!clean) return normalized;
  return normalized.filter((asset) =>
    imageAssetSearchText(asset).includes(clean)
  );
}

export function imageAssetSearchText(asset = {}) {
  const normalized = normalizeImageAsset(asset);
  return [
    normalized.name,
    normalized.alt,
    normalized.caption,
    ...normalized.tags,
    ...normalized.linkedEntities
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export async function measureImageDataUrl(dataUrl = "") {
  const src = String(dataUrl || "").trim();
  if (!src || typeof globalThis.Image !== "function") {
    return { width: 0, height: 0 };
  }
  return new Promise((resolve) => {
    const image = new globalThis.Image();
    image.onload = () => resolve({
      width: Number(image.naturalWidth || image.width || 0),
      height: Number(image.naturalHeight || image.height || 0)
    });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = src;
  });
}

export async function createImageAssetFromFile(file, patch = {}) {
  const localDataUrl = await fileToDataUrl(file);
  const dimensions = await measureImageDataUrl(localDataUrl);
  return normalizeImageAsset({
    id: createImageAssetId(),
    name: String(patch.name || cleanFileStem(file?.name || "")).trim(),
    mimeType: file?.type || "",
    byteSize: Number(file?.size || 0),
    localDataUrl,
    uploadStatus: "local",
    width: dimensions.width,
    height: dimensions.height,
    ...patch
  });
}

export function dataUrlToBlob(dataUrl = "", fallbackType = "") {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;
  const mimeType = String(match[1] || fallbackType || "application/octet-stream").trim();
  const isBase64 = Boolean(match[2]);
  const payload = String(match[3] || "");
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch {
    return null;
  }
}

function normalizeUploadStatus(value = "") {
  const clean = String(value || "").trim().toLowerCase();
  if (["local", "syncing", "synced", "error"].includes(clean)) return clean;
  return "local";
}

function normalizeStringArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function clampFraction(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeQuarterTurns(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = Math.round(numeric) % 4;
  return normalized < 0 ? normalized + 4 : normalized;
}

function cleanFileStem(value = "") {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim() || "Image";
}

function cleanPathSegment(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-._]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferImageAssetExtension(asset = {}) {
  const normalized = normalizeImageAsset(asset);
  const fromMime = extensionFromMimeType(normalized.mimeType);
  if (fromMime) return fromMime;
  const fromPublishUrl = extensionFromPath(normalized.publishUrl);
  if (fromPublishUrl) return fromPublishUrl;
  const fromName = extensionFromPath(normalized.name);
  if (fromName) return fromName;
  return "webp";
}

function extensionFromMimeType(value = "") {
  const clean = String(value || "").trim().toLowerCase();
  if (!clean) return "";
  if (clean === "image/jpeg" || clean === "image/jpg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  if (clean === "image/avif") return "avif";
  if (clean === "image/svg+xml") return "svg";
  if (clean === "image/heic") return "heic";
  return "";
}

function extensionFromPath(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const withoutQuery = clean.split(/[?#]/, 1)[0];
  const match = withoutQuery.match(/\.([a-z0-9]+)$/i);
  return match ? String(match[1] || "").trim().toLowerCase() : "";
}
