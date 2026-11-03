// The Feed: the latest launches, graduations, burns and posts, and the fee board.
import { createStealthClient } from "@juststealthit/sdk";
import { isFeedEvent } from "@juststealthit/sdk/api";
import { formatUsd } from "@juststealthit/sdk/utils";

const stealth = createStealthClient();

for (const item of await stealth.feed.iterate({ filter: "all", limit: 20 }).take(25)) {
  if (isFeedEvent(item)) console.log(new Date(item.at).toISOString(), item.event.kind.padEnd(12), item.event.chain.padEnd(10), item.event.symbol ?? "", item.event.usd ? formatUsd(item.event.usd) : "");
  else console.log(new Date(item.at).toISOString(), "post".padEnd(12), item.author.displayName ?? `#${item.author.id}`, item.text.slice(0, 60));
}

const board = await stealth.feed.fees(7);
console.log(`\nFees paid out in 7 days: ${formatUsd(board.totalUsd)}`);
for (const t of board.types) console.log(` ${t.type.padEnd(10)} ${formatUsd(t.usd).padStart(8)} in ${t.payouts} payouts`);
