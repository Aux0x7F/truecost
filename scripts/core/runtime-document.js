import { createDocumentController } from "../../vendor/nostr-site-support.esm.js";
import { getSiteRuntimeClient } from "./runtime-client.js";

export async function createSiteDocumentController({
  docId = "",
  kind = "page",
  initialDocument = null
} = {}) {
  const runtimeClient = await getSiteRuntimeClient();
  return createDocumentController({
    runtimeClient,
    docId,
    kind,
    initialDocument
  });
}

export default createSiteDocumentController;
