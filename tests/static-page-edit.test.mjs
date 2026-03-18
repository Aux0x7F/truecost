import test from "node:test";
import assert from "node:assert/strict";

import {
  cloneStaticEditContent,
  hasMeaningfulStaticEditValue,
  mergeStaticEditContent,
  staticEditContentMatches
} from "../scripts/surfaces/static-page-edit.js";

test("mergeStaticEditContent keeps fallback values when the incoming markup is empty", () => {
  const merged = mergeStaticEditContent(
    {
      "home.hero.title": "<strong>Fresh</strong>",
      "home.hero.lede": "<p><br></p>"
    },
    {
      "home.hero.title": "Old",
      "home.hero.lede": "Fallback lede"
    }
  );

  assert.equal(merged["home.hero.title"], "<strong>Fresh</strong>");
  assert.equal(merged["home.hero.lede"], "Fallback lede");
});

test("hasMeaningfulStaticEditValue ignores empty html wrappers", () => {
  assert.equal(hasMeaningfulStaticEditValue("<p><br></p>"), false);
  assert.equal(hasMeaningfulStaticEditValue("<p>&nbsp;</p>"), false);
  assert.equal(hasMeaningfulStaticEditValue("<p>Actual text</p>"), true);
});

test("cloneStaticEditContent and staticEditContentMatches operate on deep cloned snapshots", () => {
  const snapshot = { "home.hero.title": "<strong>Title</strong>" };
  const cloned = cloneStaticEditContent(snapshot);

  assert.equal(staticEditContentMatches(snapshot, cloned), true);
  cloned["home.hero.title"] = "<strong>Changed</strong>";
  assert.equal(staticEditContentMatches(snapshot, cloned), false);
});
