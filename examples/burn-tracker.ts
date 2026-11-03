// The $STEALTH buy back and burn: supply burned, the next run, and the latest burns.
import { createStealthClient } from "@juststealthit/sdk";
import { formatDuration, formatTokens } from "@juststealthit/sdk/utils";

const stealth = createStealthClient();
const [overview, next] = await Promise.all([stealth.sol.burn.overview(), stealth.sol.burn.next()]);

if (overview.status === "not_configured") {
  console.log("The burn isn't running yet.");
  process.exit(0);
}
console.log(`${overview.symbol}: ${formatTokens(overview.burned)} burned (${overview.burnedPct?.toFixed(3)}% of supply), status ${overview.status}`);
if (next.nextAt) console.log("Next burn in", formatDuration((next.nextAt - next.now) / 1000));

for (const e of await stealth.sol.burn.iterateEvents(25).take(10)) console.log(new Date(e.time).toISOString(), formatTokens(e.amount), e.solscan);
