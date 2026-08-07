import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

/* Secrets live in the repo-root .env, shared with the worker and the migration
   script. Next only auto-loads .env from its own package directory, so without
   this the dashboard starts fine and then fails at the first query with
   "DATABASE_URL is not set". Loading here rather than via node --env-file
   because Next re-spawns itself through NODE_OPTIONS, which rejects that flag. */
loadEnv({ path: "../../.env", quiet: true });

/**
 * `@lead/core` is a workspace package shipped as TypeScript-compiled ESM, and the
 * dashboard imports its query layer directly to read runs and leads. Next has to
 * be told to transpile it rather than treat it as a prebuilt external.
 */
const config: NextConfig = {
  transpilePackages: ["@lead/core"],
  // pg is a native-ish driver; bundling it into the server build breaks it.
  serverExternalPackages: ["pg"],
};

export default config;
