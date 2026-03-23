export function createWorkspaceAccountController({
  site,
  state,
  publicStateStore,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    applyOptimisticIdentityRotation: (publicState) => publicState,
    applyOptimisticWorkspaceProfileUpdate: (publicState) => publicState,
    assertNetworkSessionUsernameIntegrity: async () => ({}),
    buildPasswordLengthMessage: () => "",
    buildSiteKeyShare: () => null,
    buildUsernameLoginMismatchMessage: (username) =>
      `@${String(username || "").trim()} already exists and your password did not match.`,
    deriveIdentity: () => null,
    deriveSecretKeyHex: async () => "",
    escapeAttribute: (value) => String(value ?? ""),
    escapeHtml: (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;"),
    findSiteKeyShare: (shares, sitePubkey) =>
      (Array.isArray(shares) ? shares : []).find((share) => share?.sitePubkey === sitePubkey) || null,
    lookupUsers: async () => [],
    mergeSiteKeyShares: (primary, secondary) => [
      ...(Array.isArray(primary) ? primary : []),
      ...(Array.isArray(secondary) ? secondary : [])
    ],
    normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
    openAccountSession: async () => {
      throw new Error("openAccountSession is not configured.");
    },
    signIn: null,
    PASSWORD_MIN_LENGTH: 8,
    persistCachedSiteKeyShares: () => {},
    publishAdminKeyShare: async () => {},
    rebroadcastAccount: async () => {},
    rememberAccountRotation: () => {},
    rememberCurrentAccountSession: () => {},
    resolveNextAvailableUsername: async () => null,
    rotateAccountCredentials: async () => {
      throw new Error("rotateAccountCredentials is not configured.");
    },
    rotatePasswordRequest: null,
    rotateAccountPassword: async () => {
      throw new Error("rotateAccountPassword is not configured.");
    },
    saveSession: () => {},
    signInWithCredentials: async () => {
      throw new Error("signInWithCredentials is not configured.");
    },
    uploadPublicBlob: async () => {
      throw new Error("uploadPublicBlob is not configured.");
    },
    ...deps
  };

  const hooks = {
    currentUser: () => null,
    currentUserIsAdmin: () => false,
    notifySessionChanged: () => {},
    refreshWorkspace: async () => {},
    renderWorkspace: () => {},
    resolveWorkspaceSitePubkey: () => "",
    syncWorkspace: async () => {},
    ...callbacks
  };

  function setStatusMarkup(status, { state: statusState = "", html = "", text = "" } = {}) {
    if (!(status instanceof HTMLElement)) return;
    if (statusState) {
      status.dataset.state = statusState;
    } else {
      delete status.dataset.state;
    }
    status.innerHTML = html || runtime.escapeHtml(text || "");
  }

  function renderStatusActionMarkup(message, { actionLabel = "", actionAttributes = {} } = {}) {
    const messageMarkup = `<div>${runtime.escapeHtml(message)}</div>`;
    if (!actionLabel) return messageMarkup;
    return `
      ${messageMarkup}
      <div class="status-box__actions">
        <button class="status-box__inline-action" type="button"${Object.entries(actionAttributes)
          .map(([key, value]) => ` ${runtime.escapeAttribute(key)}="${runtime.escapeAttribute(value)}"`)
          .join("")}>${runtime.escapeHtml(actionLabel)}</button>
      </div>
    `;
  }

  function renderDefaultLoginStatusMarkup() {
    return runtime.escapeHtml(
      `Usernames are unique handles. ${runtime.buildPasswordLengthMessage(
        runtime.PASSWORD_MIN_LENGTH
      )} This site uses your username and password to reopen the same account.`
    );
  }

  function renderLoginUsernameMismatchMarkup(username) {
    return renderStatusActionMarkup(runtime.buildUsernameLoginMismatchMessage(username), {
      actionLabel: "Append the next available number",
      actionAttributes: {
        "data-append-next-available-username": "login"
      }
    });
  }

  function setLoginPending(button, pending) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = pending;
    button.dataset.busy = pending ? "yes" : "no";
    button.innerHTML = pending
      ? `<span class="loading-spinner" aria-hidden="true"></span><span>Opening account...</span>`
      : "Create/Login";
  }

  async function handleLogin(form) {
    const status = form.querySelector("[data-workspace-status]");
    const submitButton = form.querySelector("[data-login-submit]");
    try {
      setLoginPending(submitButton, true);
      if (status) {
        status.textContent = "Opening account...";
        status.dataset.state = "pending";
      }
      const formData = new FormData(form);
      const login = typeof runtime.signIn === "function"
        ? await runtime.signIn({
            username: formData.get("username"),
            password: formData.get("password")
          })
        : await runtime.openAccountSession({
            username: formData.get("username"),
            password: formData.get("password"),
            loadPublicState: async () =>
              ((await publicStateStore
                .hydrate({
                  force: true,
                  reason: "login-username-check",
                  requestRepair: false
                })
                .catch(() => ({ value: state.publicState }))).value || state.publicState),
            signInWithCredentials: runtime.signInWithCredentials,
            saveSession: runtime.saveSession,
            rebroadcastAccount: runtime.rebroadcastAccount,
            rememberCurrentAccountSession: runtime.rememberCurrentAccountSession,
            assertNetworkSessionUsernameIntegrity: runtime.assertNetworkSessionUsernameIntegrity,
            lookupUsers: runtime.lookupUsers
          });
      const session = login.session;
      if (status) {
        status.textContent = login.warning
          ? `Signed in as @${session.username}. ${login.warning}`
          : `Signed in as @${session.username}.`;
        status.dataset.state = login.warning ? "warning" : "success";
      }
      hooks.notifySessionChanged();
      await hooks.refreshWorkspace(true);
    } catch (error) {
      if (status) {
        if (String(error?.code || "").trim().toUpperCase() === "LOGIN_MISMATCH") {
          setStatusMarkup(status, {
            state: "error",
            html: renderLoginUsernameMismatchMarkup(
              error?.claimedUsername ||
                runtime.normalizeUsername(form.querySelector('[name="username"]')?.value || "")
            )
          });
        } else {
          status.textContent = String(error?.message || error || "Login failed.");
          status.dataset.state = "error";
        }
      }
    } finally {
      setLoginPending(submitButton, false);
    }
  }

  async function handleProfileSave(form) {
    const status = form.querySelector("[data-workspace-status]");
    try {
      const formData = new FormData(form);
      const publicState =
        (await publicStateStore
          .hydrate({
            force: true,
            reason: "profile-username-check",
            requestRepair: false
          })
          .catch(() => ({ value: state.publicState }))).value || state.publicState;
      await runtime.assertNetworkSessionUsernameIntegrity(publicState, state.session, {
        lookupUsers: runtime.lookupUsers,
        requireLookup: true,
        action: "update this profile"
      });
      const current = hooks.currentUser();
      let avatarUrl = String(current?.avatarUrl || "").trim();
      let avatarBlob = current?.avatarBlob || null;
      const profilePayload = {
        displayName: current?.displayName || "",
        avatarUrl,
        avatarBlob,
        bio: formData.get("bio"),
        socialLinks: String(formData.get("socialLinks") || "")
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      };
      const avatarFile = formData.get("avatarFile");
      if (avatarFile instanceof File && avatarFile.size > 0) {
        const upload = await runtime.uploadPublicBlob(state.session.secretKeyHex, avatarFile, {
          purpose: "avatar"
        });
        avatarUrl = upload.url;
        avatarBlob = upload;
        profilePayload.avatarUrl = avatarUrl;
        profilePayload.avatarBlob = avatarBlob;
      }
      await runtime.rebroadcastAccount(state.session, profilePayload, {
        validateSession: async (session) => {
          await runtime.assertNetworkSessionUsernameIntegrity(publicState, session, {
            lookupUsers: runtime.lookupUsers,
            requireLookup: true,
            action: "update this profile"
          });
        }
      });
      publicStateStore.remember(
        runtime.applyOptimisticWorkspaceProfileUpdate(state.publicState, state.session, profilePayload),
        { notify: true, reason: "profile-save" }
      );
      hooks.notifySessionChanged();
      if (status) {
        status.textContent = "Profile updated.";
        status.dataset.state = "success";
      }
      window.setTimeout(() => {
        void hooks.syncWorkspace(true);
      }, 1400);
    } catch (error) {
      if (status) {
        status.textContent = String(error?.message || error || "Profile save failed.");
        status.dataset.state = "error";
      }
    }
  }

  function renderPasswordRotationModal() {
    if (!state.passwordRotationModal || !state.session) return "";
    const statusMessage = String(state.passwordRotationModal.status || "").trim();
    const statusState = String(state.passwordRotationModal.state || "").trim();
    return `
      <div class="modal-backdrop">
        <section class="modal-card">
          <div class="workspace-list__row">
            <div>
              <div class="eyebrow">Password</div>
              <h2>Change password</h2>
            </div>
            <button class="button-ghost" type="button" data-modal-close>Close</button>
          </div>
          <p class="muted-text">This rotates the account key for @${runtime.escapeHtml(
            state.session.username
          )} and keeps the same username.</p>
          <form class="tip-form" data-password-rotation-form>
            <label>
              <span>New password</span>
              <input name="password" type="password" maxlength="120" minlength="${
                runtime.PASSWORD_MIN_LENGTH
              }" autocomplete="new-password" placeholder="••••••••" required>
            </label>
            <label>
              <span>Confirm new password</span>
              <input name="confirmPassword" type="password" maxlength="120" minlength="${
                runtime.PASSWORD_MIN_LENGTH
              }" autocomplete="new-password" placeholder="••••••••" required>
            </label>
            <div class="button-row">
              <button class="button" type="submit" data-password-rotation-submit>${
                state.passwordRotationModal.pending ? "Changing..." : "Change password"
              }</button>
            </div>
            <div class="status-box"${
              statusState ? ` data-state="${runtime.escapeAttribute(statusState)}"` : ""
            }>${runtime.escapeHtml(
              statusMessage ||
                `Use a password you can keep. ${runtime.buildPasswordLengthMessage(
                  runtime.PASSWORD_MIN_LENGTH
                )} This account handle stays the same.`
            )}</div>
          </form>
        </section>
      </div>
    `;
  }

  function renderLoginStatusPreview(form) {
    const status = form?.querySelector?.("[data-workspace-status]");
    if (!(status instanceof HTMLElement)) return;
    setStatusMarkup(status, {
      html: renderDefaultLoginStatusMarkup()
    });
  }

  async function handleAppendNextAvailableUsername(button) {
    const form = button.closest("form");
    const input = form?.querySelector?.('[name="username"]');
    if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) return;
    const status = form.querySelector("[data-workspace-status]");
    const requestedUsername = runtime.normalizeUsername(input.value || "");
    if (!(status instanceof HTMLElement) || !requestedUsername) return;
    setStatusMarkup(status, {
      state: "pending",
      text: "Checking the next available username..."
    });
    const nextCandidate = await runtime.resolveNextAvailableUsername(state.publicState, requestedUsername, {
      lookupUsers: null
    });
    if (!nextCandidate?.username) {
      setStatusMarkup(status, {
        state: "error",
        text: "Could not find a nearby available username yet. Try again."
      });
      return;
    }
    input.value = nextCandidate.username;
    input.focus();
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch {
      // Ignore selection errors on unsupported input modes.
    }
    setStatusMarkup(status, {
      state: nextCandidate.verified ? "success" : "warning",
      text: nextCandidate.verified
        ? `Try @${nextCandidate.username}.`
        : `Try @${nextCandidate.username}. It will be verified again when you submit.`
    });
  }

  async function handlePasswordRotation(form) {
    const status = form.querySelector(".status-box");
    const submitButton = form.querySelector("[data-password-rotation-submit]");
    try {
      const formData = new FormData(form);
      const password = String(formData.get("password") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");
      if (!password.trim()) throw new Error("Enter a new password.");
      if (password !== confirmPassword) throw new Error("Passwords did not match.");
      state.passwordRotationModal = {
        ...(state.passwordRotationModal || {}),
        pending: true,
        status: "Changing password...",
        state: "pending"
      };
      if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
      if (status instanceof HTMLElement) {
        status.textContent = "Changing password...";
        status.dataset.state = "pending";
      }
      const current = hooks.currentUser();
      const profilePayload = {
        displayName: current?.displayName || "",
        avatarUrl: current?.avatarUrl || "",
        avatarBlob: current?.avatarBlob || null,
        bio: current?.bio || "",
        socialLinks: Array.isArray(current?.socialLinks) ? current.socialLinks : []
      };
      const rotation = typeof runtime.rotatePasswordRequest === "function"
        ? await runtime.rotatePasswordRequest({
            session: state.session,
            nextPassword: password,
            profilePayload,
            isAdmin: hooks.currentUserIsAdmin(),
            siteKeyShare: state.siteKeyShare,
            workspaceSitePubkey: hooks.resolveWorkspaceSitePubkey(state.publicState)
          })
        : await runtime.rotateAccountPassword({
            session: state.session,
            nextPassword: password,
            currentPublicState: state.publicState,
            loadPublicState: async () =>
              ((await publicStateStore
                .hydrate({
                  force: true,
                  reason: "password-rotation-check",
                  requestRepair: false
                })
                .catch(() => ({ value: state.publicState }))).value || state.publicState),
            deriveSecretKeyHex: runtime.deriveSecretKeyHex,
            deriveIdentity: runtime.deriveIdentity,
            assertNetworkSessionUsernameIntegrity: runtime.assertNetworkSessionUsernameIntegrity,
            lookupUsers: runtime.lookupUsers,
            rotateAccountCredentials: runtime.rotateAccountCredentials,
            saveSession: runtime.saveSession,
            rememberAccountRotation: runtime.rememberAccountRotation,
            afterCommit: async ({ previousSession, rotation: committedRotation, publicState }) => {
              const warnings = [];
              const optimisticRotatedState = runtime.applyOptimisticIdentityRotation(
                state.publicState,
                previousSession.pubkey,
                committedRotation.session.pubkey
              );
              state.publicState = publicStateStore.remember(optimisticRotatedState, {
                notify: true,
                reason: "password-rotation"
              });
              if (hooks.currentUserIsAdmin() && state.siteKeyShare?.siteSecretKeyHex) {
                try {
                  await runtime.publishAdminKeyShare(
                    previousSession.secretKeyHex,
                    committedRotation.session.pubkey,
                    state.siteKeyShare.siteSecretKeyHex
                  );
                  const optimisticShare = runtime.buildSiteKeyShare(state.siteKeyShare.siteSecretKeyHex, {
                    sender_pubkey: previousSession.pubkey,
                    shared_at: new Date().toISOString()
                  });
                  if (optimisticShare) {
                    state.siteKeyShares = runtime.mergeSiteKeyShares([optimisticShare], state.siteKeyShares);
                    runtime.persistCachedSiteKeyShares({
                      storageNamespace: site?.nostr?.storageNamespace,
                      viewerPubkey: committedRotation.session.pubkey,
                      shares: state.siteKeyShares
                    });
                  }
                } catch (error) {
                  warnings.push(
                    String(error?.message || error || "The inbox key share could not be refreshed yet.")
                  );
                }
              }
              try {
                await runtime.rebroadcastAccount(committedRotation.session, profilePayload);
              } catch (error) {
                warnings.push(
                  String(error?.message || error || "The account profile could not be refreshed on the network yet.")
                );
              }
              state.siteKeyShare = runtime.findSiteKeyShare(
                state.siteKeyShares,
                hooks.resolveWorkspaceSitePubkey(publicState)
              );
              return { warnings };
            }
          });
      const optimisticRotatedState = runtime.applyOptimisticIdentityRotation(
        state.publicState,
        state.session?.pubkey,
        rotation.session?.pubkey
      );
      state.publicState = publicStateStore.remember(optimisticRotatedState, {
        notify: true,
        reason: "password-rotation"
      });
      state.session = rotation.session;
      state.viewer = { pubkey: rotation.session.pubkey };
      hooks.notifySessionChanged();
      state.passwordRotationModal = {
        pending: false,
        status: rotation.warnings?.length
          ? `Password updated. ${rotation.warnings.join(" ")}`
          : "Password updated. Refreshing account state...",
        state: rotation.warnings?.length ? "warning" : "success"
      };
      hooks.renderWorkspace();
      window.setTimeout(() => {
        state.passwordRotationModal = null;
        hooks.renderWorkspace();
        void hooks.syncWorkspace(true);
      }, 900);
    } catch (error) {
      state.passwordRotationModal = {
        ...(state.passwordRotationModal || {}),
        pending: false,
        status: String(error?.message || error || "Password change failed."),
        state: "error"
      };
      if (status instanceof HTMLElement) {
        status.textContent = String(error?.message || error || "Password change failed.");
        status.dataset.state = "error";
      }
    } finally {
      if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
    }
  }

  return {
    handleAppendNextAvailableUsername,
    handleLogin,
    handlePasswordRotation,
    handleProfileSave,
    passwordMinLength: runtime.PASSWORD_MIN_LENGTH,
    renderDefaultLoginStatusMarkup,
    renderLoginStatusPreview,
    renderPasswordRotationModal
  };
}
