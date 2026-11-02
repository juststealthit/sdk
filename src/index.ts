/**
 * @juststealthit/sdk. Import a part directly to load only what it needs:
 *   @juststealthit/sdk/evm         direct on chain, five EVM chains
 *   @juststealthit/sdk/solana      through the API, plus Solana's public setup
 *   @juststealthit/sdk/multichain  through the API, from a server
 */
export * as evm from "./evm/index.js";
export * as solana from "./solana/index.js";
export * as multichain from "./multichain/index.js";
export * from "./shared/errors.js";
