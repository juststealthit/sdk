// Every trade on the launchpad's Solana coins as it happens, plus new launches. Ctrl-C to stop.
// Node 22+ has a global WebSocket. On Node 20, `npm i ws` and pass `{ stream: { WebSocket } }`.
import { createStealthClient } from "@juststealthit/sdk";
import { formatUsd, shortAddress } from "@juststealthit/sdk/utils";

const stealth = createStealthClient();
const live = stealth.live();

live.trades(null, ({ trade, token }) => {
  const side = trade.side === "buy" ? "BUY " : "SELL";
  console.log(side, token.symbol.padEnd(10), formatUsd(trade.valueUsd).padStart(8), shortAddress(trade.trader), trade.sniperTaxed ? "(sniper fee)" : "");
});
live.launches(({ token }) => console.log("NEW ", token.symbol, token.name, token.address));
live.onStateChange((s) => console.log(`[stream ${s}]`));
live.onReconnect(() => console.log("[reconnected: messages sent while down were missed]"));

process.on("SIGINT", () => {
  stealth.close();
  process.exit(0);
});
