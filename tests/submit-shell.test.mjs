import test from "node:test";
import assert from "node:assert/strict";

import {
  renderSubmitPageView,
  renderSubmitSuggestionMarkup
} from "../scripts/surfaces/submit-shell.js";

const deps = {
  escapeAttribute: (value) => String(value || ""),
  escapeHtml: (value) => String(value || ""),
  renderLoadingState: (value) => `<div data-loading>${value}</div>`,
  renderOption: (value, current) => `<option value="${value}" ${current === value ? "selected" : ""}>${value}</option>`,
  resolveEntityDisplayValue: (value) => String(value || ""),
  trimmed: (value) => String(value || "")
};

test("submit shell renders cache-first loading and sessionless states distinctly", () => {
  const loadingView = renderSubmitPageView({
    submitState: { loading: true, loadingMessage: "Looking up your submissions...", session: { username: "aux" } },
    deps
  });
  assert.match(loadingView.shellMarkup, /data-loading/);
  assert.match(loadingView.shellMarkup, /data-open-submission-modal="new"/);

  const gateView = renderSubmitPageView({
    submitState: { loading: false, session: null, submissions: [] },
    deps
  });
  assert.match(gateView.shellMarkup, /Log in required/);
});

test("submit shell renders attached search fields and consent copy inside the modal", () => {
  const view = renderSubmitPageView({
    submitState: {
      loading: false,
      session: { username: "aux" },
      publicState: { submissionStatuses: new Map() },
      submissions: [],
      formModal: {
        mode: "create",
        submissionId: "",
        payload: {
          entity_refs: [],
          contact: {},
          suggested_entity: {}
        }
      },
      chatModal: null
    },
    deps
  });

  assert.match(view.shellMarkup, /data-submit-entity-results/);
  assert.match(view.shellMarkup, /data-submit-suggested-entity-results/);
  assert.match(view.shellMarkup, /data-submit-location-results/);
  assert.match(view.shellMarkup, /Allow follow-up/);
});

test("submit shell blocks conflicting username sessions with a warning panel", () => {
  const view = renderSubmitPageView({
    submitState: {
      loading: false,
      session: { username: "aux" },
      publicState: { submissionStatuses: new Map() },
      submissions: []
    },
    deps: {
      ...deps,
      sessionHasUsernameConflict: true,
      sessionConflictMessage: "@aux is already claimed by another identity on the network."
    }
  });

  assert.match(view.shellMarkup, /Username conflict/);
  assert.match(view.shellMarkup, /already claimed/);
  assert.doesNotMatch(view.shellMarkup, /Add submission/);
});

test("submit shell blocks stale-password sessions with a reauth panel", () => {
  const view = renderSubmitPageView({
    submitState: {
      loading: false,
      session: { username: "aux" },
      publicState: { submissionStatuses: new Map() },
      submissions: []
    },
    deps: {
      ...deps,
      sessionHasStalePassword: true,
      sessionStaleMessage: "@aux is using an older password for this account."
    }
  });

  assert.match(view.shellMarkup, /Password changed/);
  assert.match(view.shellMarkup, /older password/);
  assert.doesNotMatch(view.shellMarkup, /Add submission/);
});

test("submit suggestion markup keeps attached dropdown semantics for each field kind", () => {
  const entityMarkup = renderSubmitSuggestionMarkup(
    [{ slug: "yard", name: "County Yard", location: "Phoenix, Arizona" }],
    "",
    { kind: "entity", escapeAttribute: deps.escapeAttribute, escapeHtml: deps.escapeHtml }
  );
  assert.match(entityMarkup, /data-submit-entity-pick="yard"/);
  assert.match(entityMarkup, /workspace-search__option/);
  assert.doesNotMatch(entityMarkup, /picker-chip/);

  const suggestedMarkup = renderSubmitSuggestionMarkup(
    [{ slug: "route", name: "County Route", location: "Arizona" }],
    "",
    { kind: "suggested-entity", escapeAttribute: deps.escapeAttribute, escapeHtml: deps.escapeHtml }
  );
  assert.match(suggestedMarkup, /data-submit-suggested-entity-pick="route"/);
  assert.match(suggestedMarkup, /workspace-search__option-meta/);

  const locationMarkup = renderSubmitSuggestionMarkup(
    ["Phoenix, Arizona"],
    "",
    { kind: "location", escapeAttribute: deps.escapeAttribute, escapeHtml: deps.escapeHtml, highlightedIndex: 0 }
  );
  assert.match(locationMarkup, /data-submit-location-pick="Phoenix, Arizona"/);
  assert.match(locationMarkup, /workspace-search__option/);
  assert.match(locationMarkup, /is-highlighted/);
});
