import test from "node:test";
import assert from "node:assert/strict";

import { renderNavigationMarkup } from "../scripts/surfaces/navigation.js";
import { renderWorkspaceView } from "../scripts/surfaces/workspace.js";

test("renderNavigationMarkup builds the admin explore shell with notifications", () => {
  const markup = renderNavigationMarkup({
    page: "investigations",
    navKeys: {
      home: ["home"],
      explore: ["investigations", "map"],
      investigations: ["investigations"],
      map: ["map"],
      "get-involved": ["get-involved"],
      guide: ["guide"],
      submit: ["submit"],
      about: ["about"],
      merch: ["merch"],
      workspace: ["workspace"]
    },
    isLoggedIn: true,
    isAdmin: true,
    currentUser: { displayName: "Aux" },
    sessionUsername: "aux",
    notifications: [{ id: "1", href: "./admin.html", label: "Review", title: "Pending", detail: "1 waiting" }],
    notificationsLoading: false,
    profileMenuOpen: true,
    notificationsExpanded: true,
    deps: {
      countUnreadNotifications: (items) => items.length,
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || ""),
      safeAvatarUrl: () => ""
    }
  });

  assert.match(markup, />\s*Explore\s*</);
  assert.match(markup, />\s*Investigations\s*</);
  assert.match(markup, />\s*Map\s*</);
  assert.match(markup, /<a class="nav-link" href="\.\/editor\.html">Create Investigation<\/a>/);
  assert.match(markup, /Notifications/);
  assert.match(markup, /href="\.\/admin\.html\?tab=profile">Profile<\/a>/);
  assert.match(markup, /href="\.\/admin\.html\?tab=dashboard">Admin<\/a>/);
  assert.match(markup, />Admin</);
});

test("renderNavigationMarkup exposes the shell auth trigger when logged out", () => {
  const markup = renderNavigationMarkup({
    page: "home",
    navKeys: {
      home: ["home"],
      explore: ["investigations", "map", "graph", "wiki"],
      investigations: ["investigations"],
      map: ["map"],
      graph: ["graph"],
      wiki: ["wiki"],
      "get-involved": ["get-involved"],
      guide: ["guide"],
      submit: ["submit"],
      about: ["about"],
      merch: ["merch"],
      workspace: ["workspace"]
    },
    isLoggedIn: false
  });

  assert.match(markup, /data-auth-open/);
  assert.doesNotMatch(markup, /admin\.html\?tab=login/);
});

test("renderWorkspaceView keeps login and comments panes as separate surfaces", () => {
  const loginView = renderWorkspaceView({
    workspaceState: { session: null, activeTab: "login" },
    deps: {
      tabButtons: () => [{ id: "login", label: "Log in" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`,
      currentUserIsAdmin: () => false
    }
  });

  assert.equal(loginView.title, "Log in");
  assert.match(loginView.paneMarkup, /data-login-form/);

  const commentsView = renderWorkspaceView({
    workspaceState: {
      session: { username: "aux" },
      viewer: { pubkey: "admin" },
      activeTab: "comments",
      publicState: {
        commentsByAuthor: new Map([["admin", [{ id: "c1", author: "admin", markdown: "My comment", created_at: 1, post_slug: "post-a" }]]]),
        allComments: [{ id: "c1", author: "user", markdown: "Comment", created_at: 1 }],
        hiddenComments: []
      },
      commentFilters: { query: "", role: "", karma: "" }
    },
    deps: {
      tabButtons: () => [{ id: "comments", label: "Comments" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`,
      currentUserIsAdmin: () => true,
      currentWorkspaceGroup: () => "profile",
      filterWorkspaceComments: (comments) => comments,
      renderModerationComment: (comment) => `<article data-comment-id="${comment.id}">${comment.markdown}</article>`,
      renderOwnCommentRow: (comment) => `<article data-own-comment-id="${comment.id}">${comment.markdown}</article>`,
      renderSearchField: () => '<div data-search-field></div>',
      renderKarmaSelectOptions: () => '<option value="">All karma</option>',
      renderEntityModal: () => "",
      renderUserProfileModal: () => "",
      renderUserActionModal: () => "",
      renderCommentActionModal: () => "",
      renderSubmissionModal: () => ""
    }
  });

  assert.equal(commentsView.title, "Your account");
  assert.match(commentsView.paneMarkup, /Your comments/);
  assert.match(commentsView.paneMarkup, /data-own-comment-id="c1"/);
});
