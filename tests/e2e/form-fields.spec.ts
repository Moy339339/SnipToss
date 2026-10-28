// Every form field has a name. A field with neither id nor name makes the browser record a DevTools issue
// (FormEmptyIdAndNameAttributesForInputError) each time it appears, even with autofill off and no DevTools attached;
// the issues are kept in the UI process, up to 1000. The note box is a new field every time it opens, so a long session filled that store

import { expect, test } from "./harness";
import { prepare, walkScreens } from "./screens";

test("every input, textarea and select on every UI screen (screens.ts) has a name or an id", async ({ app }) => {
  prepare(app, "zh-CN");
  await app.open();
  const missing = new Set<string>();
  await walkScreens(app, async (screen) => {
    const found = await app.page.evaluate(() =>
      [...document.querySelectorAll("input, textarea, select")]
        .filter((el) => !el.getAttribute("name") && !el.id)
        .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}">`),
    );
    for (const f of found) missing.add(`${screen}: ${f}`);
  });
  expect([...missing], [...missing].join("\n")).toEqual([]);
});
