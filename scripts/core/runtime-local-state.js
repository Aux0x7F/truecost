import {
  clearRuntimeProjectionValue,
  getCachedRuntimeProjectionValue,
  loadRuntimeProjectionValue,
  moveRuntimeProjectionValue,
  rememberRuntimeProjectionValue
} from "../../vendor/nostr-site-support.esm.js";
import {
  clearCachedSiteRuntimeChannel as clearCachedRuntimeProjectionChannel,
  clearCachedSiteRuntimeProjection,
  getCachedSiteRuntimeProjection,
  rememberCachedSiteRuntimeProjection,
  getSiteRuntimeClient
} from "./runtime-client.js";

export async function loadSiteRuntimeValue(channel = "", params = {}, options = {}) {
  const runtimeClient = await getSiteRuntimeClient();
  return loadRuntimeProjectionValue(runtimeClient, channel, params, options);
}

export async function rememberSiteRuntimeValue(channel = "", params = {}, value = null, meta = {}, options = {}) {
  const runtimeClient = await getSiteRuntimeClient();
  return rememberRuntimeProjectionValue(runtimeClient, channel, params, value, meta, options);
}

export async function clearSiteRuntimeValue(channel = "", params = {}, meta = {}, options = {}) {
  const runtimeClient = await getSiteRuntimeClient();
  return clearRuntimeProjectionValue(runtimeClient, channel, params, meta, options);
}

export async function moveSiteRuntimeValue(channel = "", fromParams = {}, toParams = {}, meta = {}, options = {}) {
  const runtimeClient = await getSiteRuntimeClient();
  return moveRuntimeProjectionValue(runtimeClient, channel, fromParams, toParams, meta, options);
}

export async function getCachedSiteRuntimeValue(channel = "", params = {}, options = {}) {
  const runtimeClient = await getSiteRuntimeClient();
  return getCachedRuntimeProjectionValue(runtimeClient, channel, params, options);
}

export function readCachedSiteRuntimeValue(channel = "", params = {}, options = {}) {
  return getCachedRuntimeProjectionValue({
    getCachedProjection(nextChannel = "", nextParams = {}) {
      return getCachedSiteRuntimeProjection(nextChannel, nextParams);
    }
  }, channel, params, options);
}

export function rememberCachedSiteRuntimeValue(channel = "", params = {}, value = null, meta = {}, options = {}) {
  const normalizedParams = normalizeProjectionStateParams(params, options);
  return rememberCachedSiteRuntimeProjection(channel, normalizedParams, {
    value,
    status: value === null || typeof value === "undefined" ? "idle" : "ready",
    updatedAt: Date.now(),
    meta
  })?.value ?? null;
}

export function clearCachedSiteRuntimeValue(channel = "", params = {}, options = {}) {
  return clearCachedSiteRuntimeProjection(channel, normalizeProjectionStateParams(params, options));
}

export function clearCachedSiteRuntimeChannel(channel = "") {
  return clearCachedRuntimeProjectionChannel(channel);
}

export default {
  clearCachedSiteRuntimeChannel,
  clearCachedSiteRuntimeValue,
  clearSiteRuntimeValue,
  getCachedSiteRuntimeValue,
  readCachedSiteRuntimeValue,
  loadSiteRuntimeValue,
  moveSiteRuntimeValue,
  rememberCachedSiteRuntimeValue,
  rememberSiteRuntimeValue
};

function normalizeProjectionStateParams(params = {}, options = {}) {
  const normalizedParams = params && typeof params === "object" ? { ...params } : {};
  const projectionScope = String(options?.scope || "").trim().toLowerCase();
  if (projectionScope === "global") {
    normalizedParams.__projectionScope = "global";
  }
  return normalizedParams;
}
