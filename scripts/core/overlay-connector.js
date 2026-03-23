export function createSiteOverlayConnector({
  resolveSecretKey = async () => "",
  connectStaticPageOverlay: connectStaticPageOverlayImpl = async () => null,
  connectStructuredUnitOverlay: connectStructuredUnitOverlayImpl = async () => null
} = {}) {
  async function withSigner(connect, options = {}) {
    const secretKeyHex = await resolveSecretKey();
    if (!secretKeyHex) return null;
    return connect({
      ...options,
      secretKeyHex
    });
  }

  return {
    connectStaticPageOverlay(options = {}) {
      return withSigner(connectStaticPageOverlayImpl, options);
    },
    connectStructuredUnitOverlay(options = {}) {
      return withSigner(connectStructuredUnitOverlayImpl, options);
    }
  };
}

export default createSiteOverlayConnector;
