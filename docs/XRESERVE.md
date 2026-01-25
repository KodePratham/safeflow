# Circle xReserve & USDCx Guide

## What is xReserve?

**xReserve** is Circle's cross-chain reserve protocol that enables the bridging of USDC to different blockchain networks. It provides cryptographic attestations for deposits and minting, ensuring that every USDCx token on Stacks is backed 1:1 by USDC.

## What is USDCx?

**USDCx** is a 1:1 USDC-backed stablecoin issued through Circle xReserve and native to Stacks. It exists as a SIP-010 compliant fungible token on the Stacks blockchain.

### Key Benefits

- **1:1 Backed**: Every USDCx is backed by real USDC held in reserve
- **Native Token**: Operates as a first-class token on Stacks (not a wrapped asset)
- **No Third-Party Bridges**: Direct integration with Circle's infrastructure
- **Audited**: Security audited for production use

---

## How xReserve Works

### Deposit Flow (USDC → USDCx)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Ethereum   │     │   Circle    │     │   Stacks    │
│   (USDC)    │────▶│  xReserve   │────▶│  (USDCx)    │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. User approves xReserve to spend USDC on Ethereum
2. User calls `depositToRemote()` on the xReserve contract
3. Circle's attestation service detects the deposit
4. Equivalent USDCx is minted on Stacks to the recipient

### Withdrawal Flow (USDCx → USDC)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Stacks    │     │   Circle    │     │  Ethereum   │
│  (USDCx)    │────▶│  xReserve   │────▶│   (USDC)    │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. User calls `burn()` on the USDCx contract on Stacks
2. Stacks attestation service sends burn intent to Circle
3. xReserve verifies the burn and issues withdrawal attestation
4. USDC is released to the user's Ethereum wallet

---

## Contract Addresses

### Ethereum Sepolia (Testnet)

| Contract | Address |
|----------|---------|
| xReserve | `0x008888878f94C0d87defdf0B07f46B93C1934442` |
| USDC     | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

### Stacks Testnet

| Contract | Address |
|----------|---------|
| USDCx    | `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx-v1` |

### Constants

| Name | Value | Description |
|------|-------|-------------|
| Stacks Domain ID | `10003` | Used in xReserve for Stacks network |
| Ethereum Domain ID | `0` | Native domain for Ethereum |
| USDC Decimals | `6` | Both USDC and USDCx use 6 decimals |

---

## Bridging Code Example

### Deposit (Ethereum → Stacks)

```typescript
import { createWalletClient, parseUnits, http } from 'viem';
import { sepolia } from 'viem/chains';

const XRESERVE_ADDRESS = '0x008888878f94C0d87defdf0B07f46B93C1934442';
const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const STACKS_DOMAIN = 10003;

// 1. Approve xReserve to spend USDC
await walletClient.writeContract({
  address: USDC_ADDRESS,
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [XRESERVE_ADDRESS, parseUnits('100', 6)],
});

// 2. Deposit to Stacks
await walletClient.writeContract({
  address: XRESERVE_ADDRESS,
  abi: XRESERVE_ABI,
  functionName: 'depositToRemote',
  args: [
    parseUnits('100', 6),    // amount
    STACKS_DOMAIN,           // remoteDomain (Stacks = 10003)
    recipientBytes32,        // Stacks address as bytes32
    USDC_ADDRESS,           // localToken
    0n,                      // maxFee
    '0x',                    // hookData
  ],
});
```

### Withdrawal (Stacks → Ethereum)

```typescript
import { makeContractCall, Cl, Pc, broadcastTransaction } from '@stacks/transactions';

const amount = 4800000; // 4.8 USDCx (6 decimals)

const transaction = await makeContractCall({
  contractName: 'usdcx-v1',
  contractAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  functionName: 'burn',
  functionArgs: [
    Cl.uint(amount),
    Cl.uint(0), // Ethereum domain
    Cl.bufferFromHex(ethereumRecipientPadded), // 32-byte padded ETH address
  ],
  network: 'testnet',
  postConditions: [/* ... */],
  senderKey: STACKS_PRIVATE_KEY,
});

await broadcastTransaction({ transaction, network: 'testnet' });
```

---

## Stacks Address Encoding

Stacks addresses need to be encoded as 32-byte hex for xReserve. Here's a helper:

```typescript
const C32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function stacksToHex32(stacksAddress: string): `0x${string}` {
  const normalized = stacksAddress.toUpperCase();
  const c32Chars = normalized.substring(1); // Remove 'S' prefix
  
  // Decode C32 to bytes
  const bits: number[] = [];
  for (const char of c32Chars) {
    const value = C32_ALPHABET.indexOf(char);
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
  
  // Pad to 32 bytes
  const padded = new Uint8Array(32);
  padded.set(new Uint8Array(bytes).slice(0, 21), 32 - 21);
  
  return `0x${Array.from(padded).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}
```

---

## Timing & Fees

| Metric | Value |
|--------|-------|
| Deposit Time | ~10-30 minutes |
| Withdrawal Time | ~10-30 minutes |
| Bridge Fee | Variable (set maxFee appropriately) |
| Minimum Amount | No strict minimum |

**Important**: Up to 50 burn intents per request (max 10 per batch, max 5 batches). Submitting more may cause failed processing.

---

## Getting Testnet Tokens

1. **Sepolia ETH** (for gas):
   - https://sepoliafaucet.com
   - https://cloud.google.com/application/web3/faucet/ethereum/sepolia

2. **Sepolia USDC**:
   - https://faucet.circle.com (select Sepolia network)

3. **Stacks Testnet STX**:
   - https://explorer.stacks.co/sandbox/faucet?chain=testnet

---

## Troubleshooting

### Bridge Transaction Pending Too Long

- Deposits typically take 10-30 minutes
- Check Sepolia Etherscan for transaction confirmation
- Monitor the Stacks explorer for USDCx mint

### USDCx Not Received

- Verify you used the correct Stacks domain ID (10003)
- Check if the Stacks address encoding is correct
- Wait additional time; attestation can be delayed

### Insufficient Balance Errors

- Ensure you have enough ETH for gas on Sepolia
- Verify USDC balance and approval amount
- Check USDCx balance before withdrawal

---

## Resources

- [USDCx Documentation](https://docs.stacks.co/learn/bridging/usdcx)
- [Bridging Guide](https://docs.stacks.co/more-guides/bridging-usdcx)
- [Circle xReserve Docs](https://developers.circle.com/xreserve)
- [USDCx Contracts Reference](https://docs.stacks.co/learn/bridging/usdcx/contracts)
- [Circle Bridge App](https://docs.stacks.co/learn/bridging/usdcx/bridge-app)

---

## Security

USDCx on Stacks has been audited. The audit report is available at:
- [USDCX Final Audit PDF](https://docs.stacks.co/learn/bridging/usdcx)

Always verify contract addresses before sending transactions.
