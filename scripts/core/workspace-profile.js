import { clonePublicState } from "./public-state.js";

function normalizePubkey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSocialLinks(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

export function applyOptimisticWorkspaceProfileUpdate(publicState, session = null, profile = {}) {
  const cleanPubkey = normalizePubkey(session?.pubkey);
  if (!cleanPubkey) return publicState;

  const nextState = clonePublicState(publicState) || {};
  const claimedUsername = normalizeUsername(session?.username);
  const displayName = String(profile?.displayName || "").trim();
  const bio = String(profile?.bio || "").trim();
  const avatarUrl = String(profile?.avatarUrl || "").trim();
  const avatarBlob = profile?.avatarBlob || null;
  const socialLinks = normalizeSocialLinks(profile?.socialLinks);

  const applyProfile = (user = {}) => ({
    ...user,
    pubkey: cleanPubkey,
    username: String(user?.username || claimedUsername).trim(),
    claimedUsername: String(user?.claimedUsername || claimedUsername).trim(),
    displayName,
    bio,
    avatarUrl,
    avatarBlob,
    socialLinks
  });

  const users = Array.isArray(nextState.users) ? nextState.users.slice() : [];
  const existingIndex = users.findIndex((user) => normalizePubkey(user?.pubkey) === cleanPubkey);
  if (existingIndex >= 0) {
    users[existingIndex] = applyProfile(users[existingIndex]);
  } else {
    users.push(
      applyProfile({
        pubkey: cleanPubkey,
        username: claimedUsername,
        claimedUsername,
        displayName,
        bio,
        avatarUrl,
        avatarBlob,
        socialLinks,
        commentCount: 0,
        submissionCount: 0,
        isAdmin: false
      })
    );
  }
  nextState.users = users;
  return nextState;
}
