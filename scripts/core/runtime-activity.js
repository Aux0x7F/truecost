import { getSiteRuntimeClient } from "./runtime-client.js";

export function createSiteActivityClient({
  site,
  resolveSecretKey = async () => "",
  getRuntimeClient = () => getSiteRuntimeClient(),
  getPage = () => document.body.dataset.page || "site"
} = {}) {
  async function publishVisitPulse() {
    try {
      const secretKeyHex = await resolveSecretKey();
      if (!secretKeyHex || !site?.nostr?.kinds?.visitPulse) return;
      const runtimeClient = await getRuntimeClient();
      await runtimeClient.callAction("activity.recordVisitPulse", {
        day: new Date().toISOString().slice(0, 10),
        page: getPage(),
        secretKeyHex
      });
    } catch {
      return;
    }
  }

  return {
    publishVisitPulse
  };
}

export default createSiteActivityClient;
