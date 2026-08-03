import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, db } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  // schema.sql sits beside the source in dev and beside the build output in dist.
  const sql = await readFile(join(here, "schema.sql"), "utf8");
  await db().query(sql);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => console.log("schema applied"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
