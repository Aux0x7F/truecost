import { renderSearchField } from "../core/search-controls.js";

export function createWorkspaceSurfaceDeps(config = {}) {
  return {
    ...config,
    renderSearchField
  };
}
