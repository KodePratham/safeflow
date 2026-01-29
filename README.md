# SafeFlow - Bitcoin-Native Programmable Payments

A cross-chain bridge and streaming vault that enables users to bridge USDC from Ethereum Sepolia to Stacks Testnet. Once converted to USDCx, funds are locked in a Clarity smart contract and "dripped" to recipients based on Bitcoin block height.

## Features

- **Cross-Chain Bridge**: Bridge USDC from Ethereum to Stacks via Circle's xReserve protocol
- **Streaming Payments**: Create linear payment streams based on Bitcoin block height
- **Secure Vault**: Funds locked in auditable Clarity smart contracts
- **Post-Conditions**: Frontend prevents over-spending with Stacks post-conditions
- **Stream Management**: Freeze, cancel, or claim payments from active streams

---

## 🔐 Why Stake/Lock Funds?

### The Problem with Traditional Payments

Traditional payment systems suffer from key issues:

| Issue | Traditional | SafeFlow Solution |
|-------|-------------|-------------------|
| **Trust** | Recipient trusts sender to pay | Funds pre-locked in smart contract |
| **Timing** | Manual or centralized scheduling | Automated via Bitcoin blocks |
| **Reversibility** | Sender can cancel anytime | Only unclaimed funds can be cancelled |
| **Transparency** | Opaque bank systems | Fully auditable on-chain |

### Why Locking Matters

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Without Staking (Traditional)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Employer ──────?──────▶ Employee                                      │
│      │                        │                                          │
│      │    "Trust me, I'll     │    "Will I get paid?"                   │
│      │     pay you later"     │                                          │
│      │                        │                                          │
│      └── Can disappear ───────┘                                          │
│          with funds                                                      │
│                                                                          │
│   ❌ No guarantee    ❌ Centralized    ❌ Requires trust                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    With Staking (SafeFlow)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Employer ────────▶ [Smart Contract Vault] ────────▶ Employee          │
│      │                       │                           │               │
│      │   Locks $1000        │  Drips $100/month         │  Claims when  │
│      │   upfront            │  automatically            │  vested       │
│      │                      │                           │               │
│      └── Cannot access ─────┴── Bitcoin-secured ────────┘               │
│          locked funds           timing                                   │
│                                                                          │
│   ✅ Guaranteed funds  ✅ Trustless  ✅ Bitcoin-finality timing         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Benefits of Staking/Locking

1. **Payment Guarantee**: Recipients know funds exist and are reserved for them
2. **Trustless Execution**: No intermediaries needed - code is law
3. **Predictable Cash Flow**: Recipients can plan around guaranteed future payments
4. **Dispute Prevention**: Clear on-chain record of commitments
5. **Bitcoin-Level Security**: Timing based on immutable Bitcoin block height

### Use Cases

| Scenario | Why Staking Helps |
|----------|-------------------|
| **Payroll** | Employees guaranteed salary, can't be "forgotten" |
| **Grants/Funding** | Grantees see locked funds, motivated to deliver |
| **Subscriptions** | Service providers guaranteed payment stream |
| **Vesting** | Token/equity vesting with transparent schedule |
| **Escrow** | Automatic release based on time, not trust |

---

## 🏗️ Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SafeFlow Architecture                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Ethereum Sepolia                    Stacks Testnet                    │
│   ┌─────────────┐                     ┌─────────────────────────────┐   │
│   │             │                     │                             │   │
│   │    USDC     │───────────────────▶│          USDCx              │   │
│   │   (ERC-20)  │   Circle xReserve  │        (SIP-010)            │   │
│   │             │                     │                             │   │
│   └─────────────┘                     └──────────────┬──────────────┘   │
│                                                      │                   │
│                                                      ▼                   │
│                                       ┌─────────────────────────────┐   │
│                                       │    SafeFlow Smart Contract  │   │
│                                       │    ┌─────────────────────┐  │   │
│                                       │    │   Streaming Vault   │  │   │
│                                       │    │                     │  │   │
│                                       │    │  • Lock USDCx       │  │   │
│                                       │    │  • Drip per block   │  │   │
│                                       │    │  • Claim vested     │  │   │
│                                       │    └─────────────────────┘  │   │
│                                       └──────────────┬──────────────┘   │
│                                                      │                   │
│                                                      ▼                   │
│                                       ┌─────────────────────────────┐   │
│                                       │       Next.js Frontend      │   │
│                                       │  • MetaMask (Ethereum)      │   │
│                                       │  • Leather/Xverse (Stacks)  │   │
│                                       │  • Bridge + Stream UI       │   │
│                                       └─────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🌉 Bridge Flow Diagram

### USDC → USDCx (Ethereum to Stacks)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Cross-Chain Bridge Flow                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   STEP 1: Approve                                                        │
│   ┌──────────┐         ┌──────────────┐                                 │
│   │   User   │────────▶│ USDC Contract│  approve(xReserve, amount)      │
│   │ (MetaMask)│        │   (Sepolia)  │                                 │
│   └──────────┘         └──────────────┘                                 │
│        │                                                                 │
│        ▼                                                                 │
│   STEP 2: Deposit                                                        │
│   ┌──────────┐         ┌──────────────┐                                 │
│   │   User   │────────▶│   xReserve   │  depositToRemote(               │
│   │ (MetaMask)│        │   Contract   │    domainId: 10003,             │
│   └──────────┘         └──────────────┘    recipient: bytes32,          │
│        │                      │            amount)                       │
│        │                      │                                          │
│        ▼                      ▼                                          │
│   STEP 3: Cross-Chain Processing (~10-30 min)                           │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │
│   │    Circle    │───▶│  Attestation │───▶│    Stacks    │             │
│   │   xReserve   │    │   Service    │    │   Network    │             │
│   └──────────────┘    └──────────────┘    └──────────────┘             │
│                                                  │                       │
│                                                  ▼                       │
│   STEP 4: USDCx Minted                                                   │
│                              ┌──────────────┐                           │
│                              │    USDCx     │  User receives USDCx      │
│                              │  (SIP-010)   │  on Stacks Testnet        │
│                              └──────────────┘                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 💸 Payment Stream Flow Diagram

### Creating and Claiming from a SafeFlow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SafeFlow Lifecycle                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   PHASE 1: CREATE STREAM                                                 │
│   ┌─────────┐                    ┌─────────────────┐                    │
│   │  Admin  │──── Lock USDCx ───▶│   SafeFlow      │                    │
│   │(Creator)│                    │   Contract      │                    │
│   └─────────┘                    │                 │                    │
│        │                         │  ┌───────────┐  │                    │
│        │  create-safeflow()      │  │  Vault    │  │                    │
│        │  • recipient            │  │           │  │                    │
│        │  • total-amount         │  │  $1000    │  │                    │
│        │  • drip-rate            │  │  locked   │  │                    │
│        │  • interval             │  └───────────┘  │                    │
│        │                         │                 │                    │
│                                  └────────┬────────┘                    │
│                                           │                              │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                           │                              │
│   PHASE 2: DRIPPING (Automatic)           │                              │
│                                           ▼                              │
│   Bitcoin Block 800,000          ┌─────────────────┐                    │
│        │                         │   Block Height   │                    │
│        │ Block 800,144           │   Calculation    │                    │
│        │ (+144 blocks = ~1 day)  │                  │                    │
│        ▼                         │  elapsed_blocks  │                    │
│   ┌─────────┐                    │  × drip_rate     │                    │
│   │ $100    │◀───────────────────│  = claimable    │                    │
│   │ vested  │                    │                  │                    │
│   └─────────┘                    └────────┬────────┘                    │
│                                           │                              │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                           │                              │
│   PHASE 3: CLAIM                          │                              │
│                                           ▼                              │
│   ┌───────────┐  claim()         ┌─────────────────┐                    │
│   │ Recipient │◀─────────────────│   SafeFlow      │                    │
│   │           │  Transfer $100   │   Contract      │                    │
│   └───────────┘                  └─────────────────┘                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📐 Linear Vesting Formula

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Vesting Calculation                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Formula:                                                               │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                                                                  │   │
│   │  claimable = (elapsed_blocks × drip_rate) - claimed_amount      │   │
│   │                                                                  │   │
│   │  Where:                                                          │   │
│   │    elapsed_blocks = current_block - last_claim_block            │   │
│   │    drip_rate = amount_per_period / blocks_per_period            │   │
│   │                                                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   Example: $1000 streamed over 30 days                                  │
│   ────────────────────────────────────────                              │
│                                                                          │
│   Timeline:                                                              │
│   Block: 800,000        800,720        801,440        804,320           │
│          │               │               │               │              │
│          │    5 days     │    5 days     │   20 days     │              │
│          ▼               ▼               ▼               ▼              │
│   Vested: $0           $166.67        $333.33        $1000.00           │
│                                                                          │
│   Claim at Block 800,720:                                               │
│   • elapsed = 720 blocks (5 days × 144 blocks/day)                      │
│   • drip_rate = $1000 / 4320 blocks ≈ $0.231 per block                 │
│   • claimable = 720 × $0.231 = $166.67                                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

---

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
