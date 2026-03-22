import {
  assertNetworkSessionUsernameIntegrity,
  resolveNextAvailableUsername
} from "../core/account-integrity.js";
import {
  buildPasswordLengthMessage,
  PASSWORD_MIN_LENGTH
} from "../core/account-actions.js";
import { getSiteRuntimeClient } from "../core/runtime-client.js";
import { lookupUsers } from "../core/nostr.js";
import { renderAuthModalMarkup, renderAuthStatusMarkup } from "../surfaces/auth-modal.js";

export function createSiteAuthModalFeature({
  sessionChangedEventName = "truecost:session-changed",
  onSignedIn = null
} = {}) {
  const authState = {
    open: false,
    pending: false,
    username: "",
    statusState: "",
    statusMarkup: defaultStatusMarkup()
  };
  let bindings = null;

  function defaultStatusMarkup() {
    return renderAuthStatusMarkup({
      message: `Usernames are unique handles. ${buildPasswordLengthMessage(
        PASSWORD_MIN_LENGTH
      )} This site uses your username and password to reopen the same account.`
    });
  }

  function ensureRoot() {
    let root = document.querySelector("[data-shell-auth-root]");
    if (root instanceof HTMLElement) return root;
    root = document.createElement("div");
    root.setAttribute("data-shell-auth-root", "");
    document.body.append(root);
    return root;
  }

  function currentRoot() {
    return ensureRoot();
  }

  function currentForm() {
    return currentRoot().querySelector("[data-auth-form]");
  }

  function currentStatus() {
    return currentRoot().querySelector("[data-auth-status]");
  }

  function currentSubmitButton() {
    return currentRoot().querySelector("[data-auth-submit]");
  }

  function render() {
    const root = currentRoot();
    root.innerHTML = authState.open
      ? renderAuthModalMarkup({
          username: authState.username,
          statusMarkup: authState.statusMarkup,
          statusState: authState.statusState,
          passwordMinLength: PASSWORD_MIN_LENGTH,
          pending: authState.pending
        })
      : "";
  }

  function focusUsername() {
    const usernameInput = currentForm()?.querySelector?.('[name="username"]');
    if (!(usernameInput instanceof HTMLInputElement)) return;
    usernameInput.focus();
    try {
      usernameInput.setSelectionRange(usernameInput.value.length, usernameInput.value.length);
    } catch {
      // Ignore selection failures on unsupported inputs.
    }
  }

  function close() {
    authState.open = false;
    authState.pending = false;
    authState.statusState = "";
    authState.statusMarkup = defaultStatusMarkup().markup;
    render();
  }

  function open(username = "") {
    authState.open = true;
    authState.pending = false;
    authState.username = String(username || "").trim().toLowerCase();
    authState.statusState = "";
    authState.statusMarkup = defaultStatusMarkup().markup;
    render();
    focusUsername();
  }

  function setPending(pending) {
    authState.pending = pending;
    const submit = currentSubmitButton();
    if (!(submit instanceof HTMLButtonElement)) return;
    submit.disabled = pending;
    submit.dataset.busy = pending ? "yes" : "no";
    submit.innerHTML = pending
      ? `<span class="loading-spinner" aria-hidden="true"></span><span>Opening account...</span>`
      : "Create/Login";
  }

  function setStatus({ markup = "", state = "" } = {}) {
    authState.statusMarkup = markup;
    authState.statusState = state;
    const status = currentStatus();
    if (!(status instanceof HTMLElement)) return;
    status.innerHTML = markup;
    if (state) {
      status.dataset.state = state;
    } else {
      delete status.dataset.state;
    }
  }

  async function appendNextAvailableUsername() {
    const form = currentForm();
    const input = form?.querySelector?.('[name="username"]');
    if (!(input instanceof HTMLInputElement)) return;
    const requestedUsername = String(input.value || "").trim().toLowerCase();
    if (!requestedUsername) return;
    setStatus(renderAuthStatusMarkup({
      message: "Checking the next available username...",
      state: "pending"
    }));
    const runtimeClient = await getSiteRuntimeClient();
    const publicState = await runtimeClient.getProjection("publicState", {}, {
      preferFresh: false,
      reason: "auth-modal-next-username"
    }).then((projection) => projection?.value ?? projection);
    const nextCandidate = await resolveNextAvailableUsername(publicState, requestedUsername, {
      lookupUsers
    });
    if (!nextCandidate?.username) {
      setStatus(
        renderAuthStatusMarkup({
          message: "Could not find a nearby available username yet. Try again.",
          state: "error"
        })
      );
      return;
    }
    input.value = nextCandidate.username;
    authState.username = nextCandidate.username;
    setStatus(
      renderAuthStatusMarkup({
        message: nextCandidate.verified
          ? `Try @${nextCandidate.username}.`
          : `Try @${nextCandidate.username}. It will be verified again when you submit.`,
        state: nextCandidate.verified ? "success" : "warning"
      })
    );
    input.focus();
  }

  async function handleSubmit(form) {
    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    authState.username = username;
    setPending(true);
    setStatus(
      renderAuthStatusMarkup({
        message: "Opening account...",
        state: "pending"
      })
    );
    try {
      const runtimeClient = await getSiteRuntimeClient();
      const login = await runtimeClient.signIn({ username, password });
      const warningMessage = String(login?.warning || "").trim();
      if (warningMessage) {
        setStatus(
          renderAuthStatusMarkup({
            message: `Signed in as @${login.session.username}. ${warningMessage}`,
            state: "warning"
          })
        );
      }
      onSignedIn?.(login);
      close();
    } catch (error) {
      if (String(error?.code || "").trim().toUpperCase() === "LOGIN_MISMATCH") {
        setStatus(
          renderAuthStatusMarkup({
            message: String(error?.message || "Login failed."),
            state: "error",
            actionLabel: "Append the next available number",
            actionAttributes: {
              "data-auth-append-next": "yes"
            }
          })
        );
      } else {
        setStatus(
          renderAuthStatusMarkup({
            message: String(error?.message || error || "Login failed."),
            state: "error"
          })
        );
      }
    } finally {
      setPending(false);
    }
  }

  function mount() {
    if (bindings) return;
    bindings = new AbortController();
    const { signal } = bindings;
    ensureRoot();

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("[data-auth-open]")) {
          event.preventDefault();
          open();
          return;
        }
        if (target.closest("[data-auth-close]") || target.matches("[data-auth-backdrop]")) {
          event.preventDefault();
          close();
          return;
        }
        if (target.closest("[data-auth-append-next]")) {
          event.preventDefault();
          void appendNextAvailableUsername();
        }
      },
      { signal }
    );

    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.matches("[data-auth-form]")) return;
        event.preventDefault();
        void handleSubmit(form);
      },
      { signal }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || !authState.open) return;
        event.preventDefault();
        close();
      },
      { signal }
    );

    window.addEventListener(
      sessionChangedEventName,
      () => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        close();
      },
      { signal }
    );
  }

  function destroy() {
    bindings?.abort();
    bindings = null;
    close();
  }

  return {
    close,
    destroy,
    mount,
    open,
    render
  };
}

export default createSiteAuthModalFeature;
