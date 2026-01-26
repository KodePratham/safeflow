# SafeFlow - Bitcoin-Native Programmable Payments

A cross-chain bridge and streaming vault that enables users to bridge USDC from Ethereum Sepolia to Stacks Testnet. Once converted to USDCx, funds are locked in a Clarity smart contract and "dripped" to recipients based on Bitcoin block height.

## Features

- Cross-Chain Bridge: Bridge USDC from Ethereum to Stacks via Circle's xReserve protocol
- Streaming Payments: Create linear payment streams based on Bitcoin block height
- Secure Vault: Funds locked in auditable Clarity smart contracts
- Post-Conditions: Frontend prevents over-spending with Stacks post-conditions
- Stream Management: Freeze, cancel, or claim payments from active streams

## Architecture

```
Ethereum Sepolia (USDC)
        |
        | xReserve Bridge
        |
        v
Circle Protocol
        |
        v
Stacks Testnet (USDCx)
        |
        v
SafeFlow Smart Contract (Streaming Vault)
        |
        v
Next.js Dashboard
```

## Project Structure

```
safeflow/
├── contracts/
│   ├── safeflow.clar                 # Main streaming vault contract
│   ├── dev-payments.clar             # Development payment contract
│   ├── usdcx.clar                    # USDCx token implementation
│   └── traits/
│       └── sip-010-trait.clar        # Token trait definition
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Application layout
│   │   ├── page.tsx                  # Home page
│   │   ├── admin/
│   │   │   └── page.tsx              # Admin dashboard
│   │   └── verify/
│   │       └── page.tsx              # Verification page
│   ├── components/                   # Reusable React components
│   ├── lib/
│   │   └── bridge-utils.ts           # Ethereum bridge utilities
│   └── types/
│       └── ethereum.d.ts             # Ethereum type definitions
├── tests/
│   ├── dev-payments_test.ts          # Dev payment contract tests
│   └── safeflow_test.ts              # SafeFlow contract tests
├── docs/
│   ├── CLARINET_SETUP.md             # Clarinet installation guide
│   └── XRESERVE.md                   # xReserve protocol details
├── deployments/
│   └── default.testnet-plan.yaml     # Testnet deployment plan
├── settings/
│   ├── Devnet.toml                   # Local development config
│   ├── Simnet.toml                   # Simulation config
│   └── Testnet.toml                  # Testnet config
├── Clarinet.toml                     # Clarinet project config
├── package.json                      # Node.js dependencies
├── tsconfig.json                     # TypeScript configuration
├── next.config.js                    # Next.js configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── postcss.config.js                 # PostCSS configuration
└── README.md                         # This file
```

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/safeflow.git
cd safeflow

# Install dependencies
npm install

# Run development server
npm run dev
```

## Clarity Contract Development

```bash
# Check contract syntax
clarinet check

# Run contract tests
clarinet test

# Open Clarinet console
clarinet console
```

## Smart Contract Overview

### Key Functions

| Function | Description |
|----------|-------------|
| `create-safeflow` | Create a new payment stream with locked USDCx (anyone can create) |
| `claim` | Claim vested tokens based on current block height |
| `freeze-safeflow` | Pause the stream (admin only) |
| `unfreeze-safeflow` | Resume a frozen stream (admin only) |
| `cancel-safeflow` | Cancel stream and refund remaining USDCx to admin |
| `update-drip-rate` | Modify the drip rate of an existing stream |
| `get-claimable-amount` | Read-only: Calculate claimable amount |
| `get-safeflow` | Read-only: Get SafeFlow details by ID |

### Stream Statuses

| Status | Value | Description |
|--------|-------|-------------|
| Active | 1 | Normal operation, dripping to recipient |
| Frozen | 2 | Paused, no dripping, can be resumed |
| Cancelled | 3 | Terminated, remaining USDCx returned to admin |

### Linear Vesting Formula

The contract uses Bitcoin block height-based linear vesting:

```
claimable = (elapsed_blocks / total_blocks) * total_amount - claimed_amount
```

Where:
- `elapsed_blocks = current_block - start_block`
- `total_blocks = end_block - start_block`

## Circle xReserve Bridge

### xReserve Configuration

| Parameter | Value |
|-----------|-------|
| xReserve Contract | `0x008888878f94C0d87defdf0B07f46B93C1934442` |
| Stacks Domain ID | `10003` |
| Network | Sepolia Testnet |

### Address Conversion

The `stacksToHex32` function converts Stacks C32 addresses to 32-byte hex format for Ethereum:

```typescript
import { stacksToHex32 } from '@/lib/bridge-utils';

const hex = stacksToHex32('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
// Returns: 0x00000000000000000000000000...
```

## Security: Post-Conditions

The frontend uses Stacks post-conditions to prevent unexpected token transfers:

```typescript
const postConditions = [
  makeStandardFungiblePostCondition(
    senderAddress,
    FungibleConditionCode.Equal,  // Exactly this amount
    amountMicro,
    createAssetInfo(USDCX_CONTRACT.address, USDCX_CONTRACT.name, 'usdcx')
  ),
];
```

## Configuration

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_STACKS_NETWORK=testnet
NEXT_PUBLIC_SAFEFLOW_CONTRACT=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.safeflow
NEXT_PUBLIC_USDCX_CONTRACT=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx
```

### Contract Addresses

| Contract | Address |
|----------|---------|
| SafeFlow | `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.safeflow` |
| USDCx | `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx` |
| SIP-010 Trait | `ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.sip-010-trait-ft-standard` |

## Bridge Utilities API

### Bridging USDC

```typescript
// Bridge USDC from Ethereum to Stacks
await bridgeUSDC(walletClient, {
  amount: '100.00',
  recipientStacksAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
});

// Format/parse utilities
formatUSDC(1000000n)  // "1"
parseUSDC("1.5")      // 1500000n
```

## Testing

```bash
# Run Clarity unit tests
clarinet test

# Run frontend tests
npm test
```

## Deployment

For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

Quick steps:
1. Configure environment in `.env.local`
2. Run `clarinet deployments generate --testnet`
3. Run `clarinet deployments apply --testnet`
4. Update contract addresses after deployment

For Clarinet setup instructions, see [docs/CLARINET_SETUP.md](docs/CLARINET_SETUP.md).

## License

MIT License - see LICENSE for details.

## Acknowledgments

- Stacks Foundation for the Clarity language
- Circle for the xReserve bridge protocol
- Hiro for developer tooling and Clarinet
