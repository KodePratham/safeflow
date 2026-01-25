/**
 * Bridge Utilities - USDC to USDCx bridging via Circle xReserve
 * Using official xReserve encoding format from Stacks documentation
 * Based on: https://docs.stacks.co/more-guides/bridging-usdcx
 */

import { parseUnits, pad, type Address, type Hex } from 'viem';

// Circle xReserve Contract on Ethereum Sepolia
export const XRESERVE_ADDRESS: Address = '0x008888878f94C0d87defdf0B07f46B93C1934442';

// USDC Contract on Sepolia
export const USDC_SEPOLIA_ADDRESS: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

// Stacks Domain ID for xReserve protocol
export const STACKS_DOMAIN_ID = 10003;

// USDC decimals
export const USDC_DECIMALS = 6;

// C32 alphabet used by Stacks addresses
const C32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Stacks address version bytes
const STACKS_TESTNET_P2PKH = 26;  // 0x1a - ST addresses
const STACKS_MAINNET_P2PKH = 22;  // 0x16 - SP addresses

/**
 * Decode a c32 string to bytes.
 * @param input - c32 encoded string (without prefix)
 * @returns Uint8Array of decoded bytes
 */
function c32Decode(input: string): Uint8Array {
  // Convert to uppercase and build bit string
  let bits = "";
  for (const char of input.toUpperCase()) {
    const index = C32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid c32 character: ${char}`);
    }
    bits += index.toString(2).padStart(5, "0");
  }

  // Trim leading zeros to align to 8-bit boundary
  while (bits.length % 8 !== 0 && bits.startsWith("0")) {
    bits = bits.slice(1);
  }
  // Pad if still not aligned
  while (bits.length % 8 !== 0) {
    bits = "0" + bits;
  }

  // Convert to bytes
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return new Uint8Array(bytes);
}

/**
 * Encode a Stacks address for xReserve remoteRecipient.
 * 
 * Per Circle xReserve docs, the format is:
 *   [1 byte version] + [20 byte hash160] = 21 bytes, left-padded to 32 bytes
 * 
 * @param stacksAddress - Full Stacks address (e.g., "ST1ABC...")
 * @returns 21 byte encoded address
 */
function encodeRecipient(stacksAddress: string): Uint8Array {
  const prefix = stacksAddress.slice(0, 2).toUpperCase();
  
  let version: number;
  if (prefix === "ST") {
    version = STACKS_TESTNET_P2PKH;
  } else if (prefix === "SP") {
    version = STACKS_MAINNET_P2PKH;
  } else {
    throw new Error(`Invalid Stacks address prefix: ${prefix}`);
  }

  // Decode the c32 body (everything after the prefix)
  const c32Body = stacksAddress.slice(2);
  const decoded = c32Decode(c32Body);

  // Decoded should be 24 bytes: 20-byte hash160 + 4-byte checksum
  if (decoded.length !== 24) {
    throw new Error(
      `Invalid decoded length: expected 24, got ${decoded.length}`
    );
  }

  // Extract the 20-byte hash160 (drop the 4-byte checksum)
  const hash160 = decoded.slice(0, 20);

  // Return version byte + hash160 (21 bytes total)
  const result = new Uint8Array(21);
  result[0] = version;
  result.set(hash160, 1);
  
  return result;
}

/**
 * Convert bytes to bytes32 (left-padded with zeros).
 * This matches the bytes32FromBytes helper in the official docs.
 * 
 * @param bytes - Input bytes (up to 32)
 * @returns bytes32 hex string
 */
function bytes32FromBytes(bytes: Uint8Array): Hex {
  if (bytes.length > 32) {
    throw new Error(`Input too long: ${bytes.length} bytes, max 32`);
  }
  return pad(`0x${Buffer.from(bytes).toString("hex")}`, {
    size: 32,
    dir: "left",  // Left-pad with zeros (standard bytes32)
  }) as Hex;
}

/**
 * Remote recipient coder - matches Circle docs API.
 */
const remoteRecipientCoder = {
  encode: encodeRecipient,
};

/**
 * Encode a Stacks address string into bytes32 for xReserve depositToRemote.
 * Convenience function that combines remoteRecipientCoder.encode + bytes32FromBytes.
 * 
 * @param stacksAddress - Full Stacks address (e.g., "ST1ABC...")
 * @returns bytes32 hex string for xReserve remoteRecipient parameter
 */
export function stacksToHex32(stacksAddress: string): Hex {
  if (!stacksAddress || stacksAddress.length < 2) {
    throw new Error('Invalid Stacks address');
  }

  const prefix = stacksAddress.toUpperCase().substring(0, 2);
  
  if (prefix !== 'ST' && prefix !== 'SP') {
    throw new Error(`Invalid Stacks address prefix: ${prefix}`);
  }

  return bytes32FromBytes(remoteRecipientCoder.encode(stacksAddress));
}

/**
 * Validates a Stacks address format
 */
export function isValidStacksAddress(address: string): boolean {
  try {
    if (!address || address.length < 39 || address.length > 41) {
      return false;
    }
    const prefix = address.toUpperCase().substring(0, 2);
    if (prefix !== 'ST' && prefix !== 'SP') {
      return false;
    }
    stacksToHex32(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse USDC amount to base units
 */
export function parseUSDC(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}
