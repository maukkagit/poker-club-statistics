// Bootstraps the Google Sheet with the required tabs and header rows.
// Usage: npm run init-sheet
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import("../lib/sheets").then(({ ensureSchema }) => ensureSchema()).then(() => {
  console.log("✓ Sheet schema ensured.");
  process.exit(0);
}).catch(err => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
