import * as BufferLayout from "buffer-layout";
// native Typescript alternative: https://github.com/keichi/binary-parser

/**
 * Layout for a public key
 */
const publicKey = (property = "publicKey") => {
  return BufferLayout.blob(32, property);
};

/**
 * Layout for a 64bit unsigned value
 */
const uint64 = (property = "uint64") => {
  return BufferLayout.blob(8, property);
};

export const ESCROW_ACCOUNT_DATA_LAYOUT = BufferLayout.struct([
  BufferLayout.u8("isInitialized"),
  publicKey("initializerPubkey"),
  publicKey("initializerTempTokenAccountPubkey"),
  uint64("expectedAmount"),
]);

export interface EscrowLayout {
  isInitialized: number,
  initializerPubkey: Uint8Array,
  initializerTempTokenAccountPubkey: Uint8Array,
  expectedAmount: Uint8Array
}

