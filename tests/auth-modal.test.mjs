import test from "node:test";
import assert from "node:assert/strict";

import { renderAuthModalMarkup, renderAuthStatusMarkup } from "../scripts/surfaces/auth-modal.js";

test("renderAuthModalMarkup renders the global auth modal with password minimum", () => {
  const status = renderAuthStatusMarkup({
    message: "Usernames are unique handles."
  });
  const markup = renderAuthModalMarkup({
    username: "aux",
    statusMarkup: status.markup,
    passwordMinLength: 8
  });

  assert.match(markup, /data-auth-modal/);
  assert.match(markup, /data-auth-form/);
  assert.match(markup, /data-auth-status/);
  assert.match(markup, /data-auth-submit/);
  assert.match(markup, /minlength="8"/);
  assert.match(markup, /value="aux"/);
});
