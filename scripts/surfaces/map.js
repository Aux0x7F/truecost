import SITE from "../core/site-config.js";

export function renderMapPageSurface(list, canvas, entities, entityUsage = null, deps = {}) {
  const renderEntityCard = deps.renderEntityCard || (() => "");
  const bindMapEntityCards = deps.bindMapEntityCards || (() => {});
  const renderLeafletMapSurface = deps.renderLeafletMapSurface || (() => {});
  const focusRequestedEntity = deps.focusRequestedEntity || (() => {});
  list.innerHTML = (Array.isArray(entities) ? entities : [])
    .map((entity) => renderEntityCard(entity, entityUsage?.get?.(entity.slug) || []))
    .join("");
  renderLeafletMapSurface(canvas, entities, deps.mapState || {}, deps);
  bindMapEntityCards();
  focusRequestedEntity();
}

export function destroyLeafletMap(mapState) {
  if (mapState?.markers?.remove) mapState.markers.remove();
  mapState.markers = null;
  mapState.markerIndex = new Map();
  if (mapState?.map?.remove) mapState.map.remove();
  mapState.map = null;
  mapState.mapCanvas = null;
  mapState.pendingMapEntitySlug = "";
}

export function renderLeafletMapSurface(canvas, entities, mapState, deps = {}) {
  if (!window.L) {
    destroyLeafletMap(mapState);
    canvas.innerHTML = `<div class="map-empty">Map library unavailable.</div>`;
    return;
  }
  if (mapState.map && mapState.mapCanvas !== canvas) {
    destroyLeafletMap(mapState);
  }
  if (!mapState.map) {
    canvas.innerHTML = "";
    mapState.map = window.L.map(canvas, {
      keyboard: false,
      zoomControl: true,
      scrollWheelZoom: false
    }).setView(SITE.map.defaultCenter, SITE.map.defaultZoom);
    mapState.mapCanvas = canvas;
    window.L.tileLayer(SITE.map.tileUrl, {
      attribution: SITE.map.tileAttribution,
      minZoom: SITE.map.minZoom
    }).addTo(mapState.map);
  }
  if (mapState.markers) mapState.markers.remove();
  mapState.markerIndex = new Map();
  mapState.markers = window.L.layerGroup().addTo(mapState.map);

  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const points = [];
  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!Number.isFinite(entity.lat) || !Number.isFinite(entity.lng)) continue;
    points.push([entity.lat, entity.lng]);
    const marker = window.L.circleMarker([entity.lat, entity.lng], {
      radius: 8,
      color: "#6f0d09",
      weight: 2,
      fillColor: "#b3201a",
      fillOpacity: 0.88
    }).addTo(mapState.markers);
    mapState.markerIndex.set(entity.slug, marker);
    marker.bindPopup(`
      <div class="map-popup">
        <strong>${escapeHtml(entity.name)}</strong>
        <div>${escapeHtml(entity.location)}</div>
        <a href="./map.html?entity=${encodeURIComponent(entity.slug)}">Open entry</a>
      </div>
    `);
    marker.on("click", () => {
      highlightMapEntityCard(
        entity.slug,
        deps.queryEntityCard || ((slug) => document.querySelector(`[data-entity-card="${slug}"]`))
      );
    });
  }

  queueLeafletBoundsFit(mapState.map, points, {
    padding: [40, 40],
    duration: 0.45,
    defaultCenter: SITE.map.defaultCenter,
    defaultZoom: SITE.map.defaultZoom,
    singleZoom: 8,
    onSettled: () => {
      if (mapState.pendingMapEntitySlug && typeof deps.scheduleMapEntityFocus === "function") {
        deps.scheduleMapEntityFocus(mapState.pendingMapEntitySlug);
      }
    }
  });
}

export function queueLeafletBoundsFit(map, points, options = {}) {
  if (!map) return;
  const validPoints = (Array.isArray(points) ? points : []).filter(
    (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
  );
  const padding = Array.isArray(options.padding) ? options.padding : [40, 40];
  const duration = Number.isFinite(options.duration) ? options.duration : 0.45;
  const defaultCenter = Array.isArray(options.defaultCenter) ? options.defaultCenter : SITE.map.defaultCenter;
  const defaultZoom = Number.isFinite(options.defaultZoom) ? options.defaultZoom : SITE.map.defaultZoom;
  const singleZoom = Number.isFinite(options.singleZoom) ? options.singleZoom : Math.max(map.getZoom?.() || defaultZoom, 8);

  const applyFit = (animate) => {
    map.invalidateSize({ pan: false });
    if (validPoints.length > 1 && window.L?.latLngBounds) {
      const bounds = window.L.latLngBounds(validPoints);
      if (bounds.isValid()) {
        if (animate && typeof map.flyToBounds === "function") {
          map.flyToBounds(bounds, { padding, duration });
        } else {
          map.fitBounds(bounds, { padding });
        }
        return;
      }
    }
    if (validPoints.length === 1) {
      const target = validPoints[0];
      if (animate && typeof map.flyTo === "function") {
        map.flyTo(target, singleZoom, { duration });
      } else {
        map.setView(target, singleZoom);
      }
      return;
    }
    map.setView(defaultCenter, defaultZoom);
  };

  const raf = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 0);
  raf(() => applyFit(true));
  window.setTimeout(() => {
    applyFit(false);
    if (typeof options.onSettled === "function") options.onSettled();
  }, 180);
}

export function bindMapEntityCards(onFocus, root = document) {
  for (const card of root.querySelectorAll("[data-entity-card]")) {
    if (!(card instanceof HTMLElement) || card.dataset.bound === "yes") continue;
    card.dataset.bound = "yes";
    card.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".entity-card__links a")) return;
      event.preventDefault();
    });
    card.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".entity-card__links a")) return;
      event.preventDefault();
      onFocus?.(card.getAttribute("data-entity-card") || "");
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (target instanceof Element && target.closest(".entity-card__links a")) return;
      event.preventDefault();
      onFocus?.(card.getAttribute("data-entity-card") || "");
    });
  }
}

export function focusEntityOnRenderedMap(slug, mapState, deps = {}) {
  const cleanSlug = deps.cleanSlug || ((value) => String(value || "").trim());
  const clean = cleanSlug(slug || "");
  if (!clean) return false;
  const marker = mapState?.markerIndex?.get(clean);
  const queryEntityCard = deps.queryEntityCard || ((value) => document.querySelector(`[data-entity-card="${value}"]`));
  highlightMapEntityCard(clean, queryEntityCard);
  if (marker && mapState?.map) {
    mapState.pendingMapEntitySlug = "";
    const latLng = marker.getLatLng();
    mapState.map.flyTo(latLng, Math.max(mapState.map.getZoom(), 8), { duration: 0.45 });
    window.setTimeout(() => marker.openPopup(), 80);
    return true;
  }
  mapState.pendingMapEntitySlug = clean;
  return false;
}

export function scheduleMapEntityFocus(slug, mapState, deps = {}, options = {}, attempt = 0) {
  const cleanSlug = deps.cleanSlug || ((value) => String(value || "").trim());
  const clean = cleanSlug(slug || "");
  if (!clean) return;
  mapState.pendingMapEntitySlug = clean;
  const applied = focusEntityOnRenderedMap(clean, mapState, deps);
  if (applied || attempt >= 10) return;
  window.setTimeout(() => {
    scheduleMapEntityFocus(clean, mapState, deps, options, attempt + 1);
  }, 140);
}

export function requestedMapEntity(search = window.location.search, cleanSlug = (value) => String(value || "").trim()) {
  return cleanSlug(new URLSearchParams(search).get("entity") || "");
}

function highlightMapEntityCard(slug, queryEntityCard) {
  const cleanSlug = String(slug || "").trim();
  if (!cleanSlug) return;
  for (const item of document.querySelectorAll(".entity-card--focus")) {
    item.classList.remove("entity-card--focus");
  }
  const card = typeof queryEntityCard === "function" ? queryEntityCard(cleanSlug) : null;
  if (card instanceof HTMLElement) {
    card.classList.add("entity-card--focus");
  }
}
