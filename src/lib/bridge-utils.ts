/**
 * Bridge Utilities - USDC to USDCx bridging via Circle xReserve
 */

import { parseUnits, type Address, type Hex } from 'viem';

// Circle xReserve Contract on Ethereum Sepolia
export const XRESERVE_ADDRESS: Address = '0x008888878f94C0d87defdf0B07f46B93C1934442';

// USDC Contract on Sepolia
export const USDC_SEPOLIA_ADDRESS: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

// Stacks Domain ID for xReserve protocol
export const STACKS_DOMAIN_ID = 10003;

// USDC decimals
export const USDC_DECIMALS = 6;

// C32 character set for Stacks addresses
const C32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Converts a Stacks address to 32-byte hex for xReserve
 */
export function stacksToHex32(stacksAddress: string): Hex {
  if (!stacksAddress || stacksAddress.length < 2) {
    throw new Error('Invalid Stacks address');
  }

  const normalized = stacksAddress.toUpperCase();
  const prefix = normalized.substring(0, 2);
  
  if (prefix !== 'ST' && prefix !== 'SP') {
    throw new Error(`Invalid Stacks address prefix: ${prefix}`);
  }

  const c32Chars = normalized.substring(1);
  const bytes = c32Decode(c32Chars);
  const addressBytes = bytes.slice(0, 21);
  
  const padded = new Uint8Array(32);
  padded.set(addressBytes, 32 - addressBytes.length);
  
  const hex = Array.from(padded)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `0x${hex}` as Hex;
}

function c32Decode(input: string): Uint8Array {
  const c32Map: Record<string, number> = {};
  for (let i = 0; i < C32_ALPHABET.length; i++) {
    c32Map[C32_ALPHABET[i]] = i;
  }
  
  const bits: number[] = [];
  for (const char of input) {
    const value = c32Map[char];
    if (value === undefined) {
      throw new Error(`Invalid C32 character: ${char}`);
    }
    for (let i = 4; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  }
  
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    bytes.push(byte);
  }
  
  return new Uint8Array(bytes);
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
