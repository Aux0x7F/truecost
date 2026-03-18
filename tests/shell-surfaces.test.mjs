import test from "node:test";
import assert from "node:assert/strict";

import { renderNavigationMarkup } from "../scripts/surfaces/navigation.js";
import { renderWorkspaceView } from "../scripts/surfaces/workspace.js";

test("renderNavigationMarkup builds the admin investigations shell with notifications", () => {
  const markup = renderNavigationMarkup({
    page: "investigations",
    navKeys: {
      home: ["home"],
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
    mapEnabled: true,
    deps: {
      countUnreadNotifications: (items) => items.length,
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || ""),
      safeAvatarUrl: () => ""
    }
  });

  assert.match(markup, /Create Investigation/);
  assert.match(markup, /Notifications/);
  assert.match(markup, />Admin</);
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
        commentsByAuthor: new Map(),
        allComments: [{ id: "c1", author: "user", markdown: "Comment", created_at: 1 }],
        hiddenComments: []
      },
      commentFilters: { query: "", role: "", karma: "" }
    },
    deps: {
      tabButtons: () => [{ id: "comments", label: "Comments" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`,
      currentUserIsAdmin: () => true,
      filterWorkspaceComments: (comments) => comments,
      renderModerationComment: (comment) => `<article data-comment-id="${comment.id}">${comment.markdown}</article>`,
      renderOwnCommentRow: () => "",
      renderSearchField: () => '<div data-search-field></div>',
      renderKarmaSelectOptions: () => '<option value="">All karma</option>',
      renderEntityModal: () => "",
      renderUserProfileModal: () => "",
      renderUserActionModal: () => "",
      renderCommentActionModal: () => "",
      renderSubmissionModal: () => ""
    }
  });

  assert.equal(commentsView.title, "Workspace");
  assert.match(commentsView.paneMarkup, /Review comments/);
  assert.match(commentsView.paneMarkup, /data-search-field/);
  assert.match(commentsView.paneMarkup, /data-comment-id="c1"/);
});
