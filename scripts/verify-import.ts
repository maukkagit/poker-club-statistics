// One-shot verification: reads the live Sheet via the app's own pipeline
// and prints the leaderboard so we can eyeball it against the legacy XLSX.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import("../lib/sheets").then(async ({ computePlayerStats }) => {
  const stats = await computePlayerStats();
  console.log("Leaderboard (sorted by net_profit, desc):\n");
  console.log("  rank  player                          T   buy-ins   net €");
  console.log("  ----  ------------------------------  --  -------   --------");
  stats.forEach((s, i) => {
    const sign = s.net_profit >= 0 ? "+" : "";
    console.log(
      `  ${String(i + 1).padStart(2)}    ${s.name.padEnd(30)}  ${String(s.tournaments).padStart(2)}   ${String(s.total_buy_ins).padStart(5)}    ${sign}${s.net_profit.toFixed(2)}`,
    );
  });
  const grandTotal = stats.reduce((a, s) => a + s.net_profit, 0);
  console.log(`\n  Sum of all net profits: €${grandTotal.toFixed(2)} (should be ~0 for a zero-sum closed system)`);
  process.exit(0);
}).catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
