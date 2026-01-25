# SafeFlow - Technical Deep Dive

## 🌉 How the USDCx Bridge Works

SafeFlow enables cross-chain bridging of USDC from Ethereum to Stacks, where it becomes USDCx - a bridged representation of USDC on the Stacks blockchain. This document explains the complete technical architecture.

---

## Table of Contents

1. [Overview](#overview)
2. [Circle xReserve Protocol](#circle-xreserve-protocol)
3. [Bridge Flow (Deposit)](#bridge-flow-deposit)
4. [Withdrawal Flow](#withdrawal-flow)
5. [Address Conversion (C32 → Hex32)](#address-conversion-c32--hex32)
6. [Smart Contract Architecture](#smart-contract-architecture)
7. [Streaming Payments Math](#streaming-payments-math)
8. [Security Considerations](#security-considerations)
9. [Contract Addresses](#contract-addresses)

---

## Overview

SafeFlow is a Bitcoin-native programmable payments platform that combines:

1. **Cross-Chain Bridging**: Move USDC from Ethereum to Stacks via Circle's xReserve
2. **Streaming Vault**: Lock USDCx in a Clarity smart contract that "drips" payments based on Bitcoin block height
3. **Post-Condition Safety**: Frontend protection that prevents unexpected token transfers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SafeFlow Architecture                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐   │
│  │   Ethereum   │    │    Circle    │    │         Stacks           │   │
│  │   Sepolia    │───▶│   xReserve   │───▶│        Testnet           │   │
│  │    (USDC)    │    │   Protocol   │    │        (USDCx)           │   │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘   │
│         │                   │                       │                    │
│         │                   │                       ▼                    │
│         │                   │            ┌──────────────────────┐       │
│         │                   │            │   SafeFlow Contract  │       │
│         │                   │            │   (Streaming Vault)  │       │
│         │                   │            └──────────────────────┘       │
│         │                   │                       │                    │
│         ▼                   ▼                       ▼                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     Next.js Frontend                             │    │
│  │  • MetaMask Integration (EVM)                                   │    │
│  │  • Leather/Xverse Integration (Stacks)                          │    │
│  │  • Bridge UI + Stream Management                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Circle xReserve Protocol

### What is xReserve?

Circle's xReserve is a cross-chain messaging and asset transfer protocol that enables USDC to move between different blockchain networks. For Stacks, this creates **USDCx** - a bridged representation backed 1:1 by USDC locked on Ethereum.

### Key Components

| Component | Address (Sepolia) | Description |
|-----------|-------------------|-------------|
| xReserve Contract | `0x008888878f94C0d87defdf0B07f46B93C1934442` | Main bridge contract |
| USDC Token | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Sepolia USDC |
| Stacks Domain ID | `10003` | xReserve identifier for Stacks |

### How xReserve Works

1. **Deposit**: User locks USDC on Ethereum by calling `depositToRemote()`
2. **Attestation**: Circle's attestation service validates the deposit
3. **Minting**: USDCx is minted on Stacks to the recipient address
4. **Withdrawal**: Reverse process - burn USDCx on Stacks, release USDC on Ethereum

---

## Bridge Flow (Deposit)

### Step-by-Step Process

```
User (Ethereum)                xReserve                 Stacks
      │                            │                       │
      │  1. approve(xReserve, amt) │                       │
      │──────────────────────────▶ │                       │
      │                            │                       │
      │  2. depositToRemote(       │                       │
      │     domainId: 10003,       │                       │
      │     recipient: bytes32,   │                       │
      │     amount: uint256)       │                       │
      │──────────────────────────▶ │                       │
      │                            │                       │
      │                            │  3. Cross-chain msg   │
      │                            │─────────────────────▶ │
      │                            │                       │
      │                            │  4. Attestation       │
      │                            │◀─────────────────────│
      │                            │                       │
      │                            │  5. Mint USDCx        │
      │                            │─────────────────────▶ │
      │                            │                       │
      ▼                            ▼                       ▼
  USDC Locked                 Message Sent           USDCx Minted
```

### Code Example: Initiating a Bridge

```typescript
import { parseUnits } from 'viem';
import { stacksToHex32 } from '@/lib/bridge-utils';

// 1. Approve xReserve to spend USDC
await walletClient.writeContract({
  address: USDC_SEPOLIA_ADDRESS,
  abi: erc20Abi,
  functionName: 'approve',
  args: [XRESERVE_ADDRESS, parseUnits('100', 6)], // 100 USDC
});

// 2. Convert Stacks address to bytes32
const recipientHex32 = stacksToHex32('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');

// 3. Call depositToRemote
await walletClient.writeContract({
  address: XRESERVE_ADDRESS,
  abi: xReserveAbi,
  functionName: 'depositToRemote',
  args: [
    10003,           // Stacks domain ID
    recipientHex32,  // Recipient as bytes32
    parseUnits('100', 6), // Amount in base units
  ],
});
```

### Timing

- **Transaction Confirmation**: ~15 seconds (Ethereum)
- **Cross-Chain Processing**: ~10-30 minutes
- **USDCx Availability**: After attestation completes

---

## Withdrawal Flow

To move USDCx back to Ethereum as USDC:

1. **Burn USDCx**: Call `burn()` on the USDCx contract on Stacks
2. **Wait for Finality**: Stacks block must be confirmed on Bitcoin
3. **Generate Proof**: Obtain merkle proof from Stacks node
4. **Claim on Ethereum**: Submit proof to xReserve to unlock USDC

```clarity
;; In USDCx contract
(define-public (burn (amount uint) (sender principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    (ft-burn? usdcx amount sender)
  )
)
```

---

## Address Conversion (C32 → Hex32)

### The Problem

Ethereum smart contracts expect addresses as 32-byte hex values, but Stacks uses C32-encoded addresses (similar to Base32). We need to convert between formats.

### Stacks Address Format

```
ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
│  └──────────────────────────────────────┘
│                    │
Version              C32-encoded data (hash160 + checksum)
(ST=testnet, SP=mainnet)
```

### Conversion Algorithm

```typescript
function stacksToHex32(stacksAddress: string): Hex {
  // 1. Validate prefix (ST or SP)
  const prefix = stacksAddress.toUpperCase().substring(0, 2);
  
  // 2. Decode C32 characters to bytes
  const c32Chars = stacksAddress.substring(1); // Skip 'S'
  const bytes = c32Decode(c32Chars);
  
  // 3. Extract version byte + hash160 (21 bytes)
  const addressBytes = bytes.slice(0, 21);
  
  // 4. Left-pad to 32 bytes
  const padded = new Uint8Array(32);
  padded.set(addressBytes, 32 - addressBytes.length);
  
  // 5. Convert to hex
  return '0x' + bytesToHex(padded);
}
```

### C32 Character Set

```
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

Note: Missing characters I, L, O, U to avoid confusion with 1, l, 0, u.

---

## Smart Contract Architecture

### SafeFlow Clarity Contract

The core streaming vault is implemented in Clarity on Stacks:

```clarity
;; Stream data structure
(define-map streams
  { sender: principal, recipient: principal }
  {
    total-amount: uint,      ;; Total USDCx locked
    claimed-amount: uint,    ;; Already claimed
    start-block: uint,       ;; Bitcoin block when started
    end-block: uint,         ;; Bitcoin block when ends
    is-active: bool          ;; Stream status
  }
)
```

### Key Functions

| Function | Description |
|----------|-------------|
| `start-stream` | Lock USDCx and create a new payment stream |
| `claim-drip` | Claim vested tokens (called by recipient) |
| `cancel-stream` | Cancel stream and refund remaining (sender only) |
| `get-claimable-amount` | Calculate currently claimable amount |

### Why Bitcoin Block Height?

Stacks uses `burn-block-height` (Bitcoin block height) for timing because:

1. **Trustless Timing**: Bitcoin blocks are the ultimate source of truth
2. **Predictable**: ~10 minutes per block
3. **No Manipulation**: Cannot be gamed by miners
4. **Settlement Finality**: Bitcoin-level security

---

## Streaming Payments Math

### Linear Vesting Formula

```
claimable = (elapsed_blocks / total_blocks) × total_amount - claimed_amount

Where:
  elapsed_blocks = current_block - start_block
  total_blocks = end_block - start_block
```

### Example

```
Stream: 100 USDCx over 144 blocks (~1 day)
Start Block: 800,000
End Block: 800,144

At Block 800,072 (50% elapsed):
  elapsed = 72
  total = 144
  vested = (72/144) × 100 = 50 USDCx
  
If already claimed 20 USDCx:
  claimable = 50 - 20 = 30 USDCx
```

### Clarity Implementation

```clarity
(define-read-only (get-claimable-amount (sender principal) (recipient principal))
  (match (get-stream sender recipient)
    stream
      (let
        (
          (current-block burn-block-height)
          (elapsed (- current-block (get start-block stream)))
          (total-blocks (- (get end-block stream) (get start-block stream)))
          (vested (/ (* (get total-amount stream) elapsed) total-blocks))
          (claimable (- vested (get claimed-amount stream)))
        )
        (ok claimable)
      )
    (ok u0)
  )
)
```

---

## Security Considerations

### Post-Conditions (Frontend Safety)

Stacks has a unique feature called **post-conditions** that protect users:

```typescript
// Ensure EXACTLY the specified amount is transferred
const postConditions = [
  makeStandardFungiblePostCondition(
    userAddress,
    FungibleConditionCode.Equal,
    amountMicro,
    createAssetInfo(USDCX_CONTRACT.address, USDCX_CONTRACT.name, 'usdcx')
  ),
];

// Transaction will FAIL if it tries to transfer more
await openContractCall({
  postConditionMode: PostConditionMode.Deny,
  postConditions,
  // ...
});
```

### Bridge Security

1. **USDC Backing**: All USDCx is 1:1 backed by USDC locked on Ethereum
2. **Attestation**: Circle validates all cross-chain transfers
3. **Bitcoin Finality**: Stacks inherits Bitcoin's security model

### Smart Contract Safety

1. **No Admin Keys**: Contract cannot be upgraded or funds extracted
2. **Sender Control**: Only stream sender can cancel
3. **Recipient Rights**: Recipient can claim at any time
4. **Overflow Protection**: Clarity has built-in overflow checks

---

## Contract Addresses

### Testnet

| Contract | Network | Address |
|----------|---------|---------|
| xReserve | Sepolia | `0x008888878f94C0d87defdf0B07f46B93C1934442` |
| USDC | Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| SafeFlow | Stacks Testnet | `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.safeflow` |
| USDCx | Stacks Testnet | `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx` |

### Domain IDs

| Network | xReserve Domain ID |
|---------|-------------------|
| Stacks Testnet | `10003` |
| Ethereum Sepolia | `0` (origin) |

---

## Getting Test Tokens

### Sepolia ETH (for gas)
- [Sepolia Faucet](https://sepoliafaucet.com/)
- [Alchemy Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)

### Sepolia USDC
- [Circle Faucet](https://faucet.circle.com/) - Select Sepolia

### Stacks Testnet STX (for gas)
- [Stacks Faucet](https://explorer.stacks.co/sandbox/faucet?chain=testnet)

---

## Useful Links

- [Stacks Documentation](https://docs.stacks.co)
- [Clarity Language Reference](https://docs.stacks.co/clarity)
- [Hiro Platform](https://platform.hiro.so)
- [Stacks Explorer (Testnet)](https://explorer.stacks.co/?chain=testnet)
- [Sepolia Etherscan](https://sepolia.etherscan.io)

---

## Summary

SafeFlow demonstrates the power of combining:

1. **Circle xReserve**: Secure cross-chain USDC bridging
2. **Stacks Clarity**: Safe, predictable smart contracts
3. **Bitcoin Finality**: Trustless timing via burn-block-height
4. **Post-Conditions**: Frontend safety guarantees

This architecture enables truly **Bitcoin-native programmable payments** with stablecoin liquidity from Ethereum.
