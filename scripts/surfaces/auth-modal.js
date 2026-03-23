import { escapeAttribute, escapeHtml } from "../core/text-utils.js";

export function renderAuthStatusMarkup({
  message = "",
  state = "",
  actionLabel = "",
  actionAttributes = {}
} = {}) {
  const messageMarkup = `<div>${escapeHtml(message)}</div>`;
  if (!actionLabel) return { state, markup: messageMarkup };
  const actionMarkup = Object.entries(actionAttributes)
    .map(([key, value]) => ` ${escapeAttribute(key)}="${escapeAttribute(value)}"`)
    .join("");
  return {
    state,
    markup: `
      ${messageMarkup}
      <div class="status-box__actions">
        <button class="status-box__inline-action" type="button"${actionMarkup}>${escapeHtml(actionLabel)}</button>
      </div>
    `
  };
}

export function renderAuthModalMarkup({
  username = "",
  statusMarkup = "",
  statusState = "",
  passwordMinLength = 8,
  pending = false
} = {}) {
  return `
    <div class="modal-backdrop" data-auth-backdrop>
      <section class="modal-card" data-auth-modal aria-label="Create or log in">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Account</div>
            <h2>Create or log in</h2>
          </div>
          <button class="button-ghost" type="button" data-auth-close>Close</button>
        </div>
        <p class="muted-text">Use the same username and password each time to reopen the same account.</p>
        <form class="tip-form" data-auth-form>
          <label>
            <span>Username</span>
            <input name="username" type="text" maxlength="40" value="${escapeAttribute(username)}" placeholder="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" maxlength="120" minlength="${escapeAttribute(passwordMinLength)}" placeholder="••••••••" autocomplete="current-password" required>
          </label>
          <div class="button-row">
            <button class="button" type="submit" data-auth-submit ${pending ? "disabled" : ""}>${
              pending
                ? `<span class="loading-spinner" aria-hidden="true"></span><span>Opening account...</span>`
                : "Create/Login"
            }</button>
          </div>
          <div class="status-box" data-auth-status${statusState ? ` data-state="${escapeAttribute(statusState)}"` : ""}>${statusMarkup}</div>
        </form>
      </section>
    </div>
  `;
}
