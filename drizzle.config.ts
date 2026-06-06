import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./packages/engine/src/persistence/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH ?? "./data/opencode.db",
  },
});
