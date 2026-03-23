export function createSiteSignerClient({
  state,
  ensureEventToolsLoaded = async () => {},
  getOrCreateGuestSession = async () => null
} = {}) {
  async function resolveSecretKey() {
    if (state?.session?.secretKeyHex) return state.session.secretKeyHex;
    if (state?.guestSession?.secretKeyHex) return state.guestSession.secretKeyHex;
    await ensureEventToolsLoaded();
    if (state) {
      state.guestSession = await getOrCreateGuestSession().catch(() => null);
      return state.guestSession?.secretKeyHex || "";
    }
    const guestSession = await getOrCreateGuestSession().catch(() => null);
    return guestSession?.secretKeyHex || "";
  }

  return {
    resolveSecretKey
  };
}

export default createSiteSignerClient;
