import {
  buildPasswordReuseMessage,
  buildUsernameLoginMismatchMessage,
  createPasswordReuseError,
  isStaleSessionError,
  isUsernameConflictError,
  rotationReusesIdentityKey
} from "./account-integrity.js";

export const PASSWORD_MIN_LENGTH = 8;

export function buildPasswordLengthMessage(minimum = PASSWORD_MIN_LENGTH) {
  return `Passwords must be at least ${Number(minimum) || PASSWORD_MIN_LENGTH} characters.`;
}

function assertPasswordMinimumLength(password, minimum = PASSWORD_MIN_LENGTH) {
  if (String(password || "").length < minimum) {
    throw new Error(buildPasswordLengthMessage(minimum));
  }
}

export function translateLoginError(error, claimedUsername = "") {
  if (isUsernameConflictError(error) || isStaleSessionError(error)) {
    const mismatch = new Error(buildUsernameLoginMismatchMessage(claimedUsername));
    mismatch.code = "LOGIN_MISMATCH";
    mismatch.claimedUsername = String(claimedUsername || "").trim().toLowerCase();
    return mismatch;
  }
  return error instanceof Error ? error : new Error(String(error || "Login failed."));
}

export async function openAccountSession({
  username = "",
  password = "",
  loadPublicState,
  signInWithCredentials,
  saveSession,
  rebroadcastAccount,
  rememberCurrentAccountSession,
  assertNetworkSessionUsernameIntegrity,
  lookupUsers
} = {}) {
  const claimedUsername = String(username || "").trim().toLowerCase();
  assertPasswordMinimumLength(password);
  const publicState = typeof loadPublicState === "function"
    ? await loadPublicState()
    : null;
  const validateSession = async (session) => {
    await assertNetworkSessionUsernameIntegrity(publicState, session, {
      lookupUsers,
      requireLookup: true,
      action: "open this account"
    });
  };

  let session;
  try {
    session = await signInWithCredentials(username, password, {
      validateSession,
      persistSession: false
    });
  } catch (error) {
    throw translateLoginError(error, claimedUsername);
  }

  saveSession(session);
  rememberCurrentAccountSession(session);

  let warning = "";
  try {
    await rebroadcastAccount(session, {}, { validateSession });
  } catch (error) {
    warning = String(error?.message || error || "Signed in, but the account could not be refreshed on the network yet.");
  }

  return {
    session,
    publicState,
    warning
  };
}

export async function rotateAccountPassword({
  session,
  nextPassword = "",
  currentPublicState,
  loadPublicState,
  deriveSecretKeyHex,
  deriveIdentity,
  assertNetworkSessionUsernameIntegrity,
  lookupUsers,
  rotateAccountCredentials,
  saveSession,
  rememberAccountRotation,
  afterCommit = null
} = {}) {
  if (!session?.username || !session?.pubkey) throw new Error("Sign in before changing this password.");
  const trimmedPassword = String(nextPassword || "");
  if (!trimmedPassword.trim()) throw new Error("Enter a new password.");
  assertPasswordMinimumLength(trimmedPassword);

  const nextSecretKeyHex = await deriveSecretKeyHex(session.username, trimmedPassword);
  const nextIdentity = deriveIdentity(nextSecretKeyHex);
  const buildReuseError = () =>
    createPasswordReuseError({
      claimedUsername: session.username,
      message: buildPasswordReuseMessage({ claimedUsername: session.username })
    });

  if (nextIdentity.pubkey === String(session.pubkey || "").trim().toLowerCase()) {
    throw buildReuseError();
  }
  if (rotationReusesIdentityKey(currentPublicState, session, nextIdentity.pubkey)) {
    throw buildReuseError();
  }

  const publicState = typeof loadPublicState === "function"
    ? await loadPublicState()
    : currentPublicState;

  await assertNetworkSessionUsernameIntegrity(publicState, session, {
    lookupUsers,
    requireLookup: true,
    action: "rotate this account"
  });

  if (rotationReusesIdentityKey(publicState, session, nextIdentity.pubkey)) {
    throw buildReuseError();
  }

  const rotation = await rotateAccountCredentials(session, trimmedPassword, {
    persistSession: false,
    validateCurrentSession: async (currentSession) => {
      await assertNetworkSessionUsernameIntegrity(publicState, currentSession, {
        lookupUsers,
        requireLookup: true,
        action: "rotate this account"
      });
    }
  });

  saveSession(rotation.session);
  rememberAccountRotation(session, rotation.session);

  let warnings = [];
  if (typeof afterCommit === "function") {
    try {
      const afterCommitResult = await afterCommit({
        previousSession: session,
        rotation,
        publicState
      });
      if (Array.isArray(afterCommitResult?.warnings)) {
        warnings = afterCommitResult.warnings.map((warning) => String(warning || "").trim()).filter(Boolean);
      }
    } catch (error) {
      warnings = [String(error?.message || error || "Some account follow-up work is still catching up.")];
    }
  }

  return {
    ...rotation,
    publicState,
    warnings
  };
}
