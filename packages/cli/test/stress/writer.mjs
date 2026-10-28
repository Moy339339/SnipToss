// The writer for the stress test (stress.test.ts starts several of these processes at once): adds count replies in a row to the same note,
// each through the path an agent's write-back takes (updateAnnotation)
import { updateAnnotation } from "../../dist/fs-store.js";

const [root, id, tag, count] = process.argv.slice(2);
for (let k = 0; k < Number(count); k++) {
  const r = await updateAnnotation(root, id, (a) => {
    a.replies.push({ author: tag, body: `${tag}-${k}`, at: new Date().toISOString() });
  });
  if (r.result !== "ok") {
    console.error(`${tag}-${k}: ${r.result}`);
    process.exit(1);
  }
}
