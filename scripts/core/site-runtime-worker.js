import { attachSharedRuntimeWorker } from "../../vendor/nostr-site-support.esm.js";
import { createSiteRuntimeHost } from "./site-runtime-host.js";

const host = createSiteRuntimeHost();

attachSharedRuntimeWorker(host);

