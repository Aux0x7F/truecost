import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupLocalSiteServiceWorker,
  isLocalDevelopmentHost
} from "../scripts/core/service-worker.js";

test("isLocalDevelopmentHost recognizes localhost variants", () => {
  assert.equal(isLocalDevelopmentHost("localhost"), true);
  assert.equal(isLocalDevelopmentHost("127.0.0.1"), true);
  assert.equal(isLocalDevelopmentHost("::1"), true);
  assert.equal(isLocalDevelopmentHost("app.localhost"), true);
  assert.equal(isLocalDevelopmentHost("example.com"), false);
});

test("cleanupLocalSiteServiceWorker unregisters service workers and clears truecost caches", async () => {
  let unregisterCalls = 0;
  const deleted = [];
  const result = await cleanupLocalSiteServiceWorker({
    serviceWorker: {
      async getRegistrations() {
        return [
          {
            async unregister() {
              unregisterCalls += 1;
              return true;
            }
          },
          {
            async unregister() {
              unregisterCalls += 1;
              return true;
            }
          }
        ];
      }
    },
    cachesApi: {
      async keys() {
        return ["truecost-precache-old", "truecost-runtime-old", "unrelated-cache"];
      },
      async delete(key) {
        deleted.push(key);
        return true;
      }
    }
  });

  assert.equal(unregisterCalls, 2);
  assert.deepEqual(deleted.sort(), ["truecost-precache-old", "truecost-runtime-old"]);
  assert.deepEqual(result, {
    unregistered: 2,
    clearedCaches: 2
  });
});
