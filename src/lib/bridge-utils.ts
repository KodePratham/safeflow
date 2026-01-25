/**
 * Bridge Utilities - USDC to USDCx bridging via Circle xReserve
 * Using official xReserve encoding format from Stacks documentation
 */

import { parseUnits, type Address, type Hex } from 'viem';
import { c32addressDecode } from 'c32check';

// Circle xReserve Contract on Ethereum Sepolia
export const XRESERVE_ADDRESS: Address = '0x008888878f94C0d87defdf0B07f46B93C1934442';

// USDC Contract on Sepolia
export const USDC_SEPOLIA_ADDRESS: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

// Stacks Domain ID for xReserve protocol
export const STACKS_DOMAIN_ID = 10003;

// USDC decimals
export const USDC_DECIMALS = 6;

/**
 * Encode Stacks address to bytes for xReserve remoteRecipient
 * Uses official c32check library for proper decoding
 */
function encodeStacksAddress(stacksAddress: string): Uint8Array {
  const [version, hashBytes] = c32addressDecode(stacksAddress);
  
  // Version byte (1 byte) + hash160 (20 bytes) = 21 bytes total
  const result = new Uint8Array(21);
  result[0] = version;
  
  // Convert hex string to bytes
  for (let i = 0; i < 20; i++) {
    result[i + 1] = parseInt(hashBytes.slice(i * 2, i * 2 + 2), 16);
  }
  
  return result;
}

/**
 * Convert bytes to bytes32 format (left-padded with zeros)
 */
function bytes32FromBytes(bytes: Uint8Array): Hex {
  const padded = new Uint8Array(32);
  // Put the address bytes at the END (right-aligned, left-padded with zeros)
  padded.set(bytes, 32 - bytes.length);
  
  const hex = Array.from(padded)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `0x${hex}` as Hex;
}

/**
 * Converts a Stacks address to 32-byte hex for xReserve depositToRemote
 * This is the official encoding format used by Circle xReserve
 */
export function stacksToHex32(stacksAddress: string): Hex {
  if (!stacksAddress || stacksAddress.length < 2) {
    throw new Error('Invalid Stacks address');
  }

  const prefix = stacksAddress.toUpperCase().substring(0, 2);
  
  if (prefix !== 'ST' && prefix !== 'SP') {
    throw new Error(`Invalid Stacks address prefix: ${prefix}`);
  }

  const addressBytes = encodeStacksAddress(stacksAddress);
  return bytes32FromBytes(addressBytes);
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
