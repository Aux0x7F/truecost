import test from "node:test";
import assert from "node:assert/strict";

import { createArchivePageFeature } from "../scripts/features/archive-page.js";

test("archive summary tiles render numeric counts instead of joined tag strings", () => {
  const feature = createArchivePageFeature({
    state: {},
    viewerController: { canEdit: () => false },
    postsStore: { current: () => [], refresh: async () => [] },
    getPublicState: async () => ({}),
    publicStateNeedsRepair: () => false,
    queueLeafletBoundsFit: () => {},
    renderError: () => {},
    renderLoadingState: () => ""
  });

  const markup = feature.renderArchiveSummaryMarkup(
    [
      { tags: ["placeholder", "case-file", "records-demo"] },
      { tags: ["records-demo", "facilities", "archive-demo"] }
    ],
    {
      approvedEntities: [
        { location: "Phoenix, Arizona", lat: 33.45, lng: -112.07 },
        { location: "Phoenix, Arizona" },
        { location: "Tulare County, CA" }
      ],
      drafts: []
    }
  );

  assert.match(markup, /<strong>5<\/strong><span>Archive tags<\/span>/);
  assert.doesNotMatch(markup, /placeholder,case-file,records-demo/);
});
