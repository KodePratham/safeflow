# SafeFlow - Bitcoin-Native Programmable Payments

A cross-chain bridge and streaming vault that enables users to bridge USDC from Ethereum Sepolia to Stacks Testnet. Once converted to USDCx, funds are locked in a Clarity smart contract and "dripped" to recipients based on Bitcoin block height.

## 🌟 Features

- **Cross-Chain Bridge**: Bridge USDC from Ethereum to Stacks via Circle's xReserve protocol
- **Streaming Payments**: Create linear payment streams based on Bitcoin block height
- **Secure Vault**: Funds locked in auditable Clarity smart contracts
- **Post-Conditions**: Frontend prevents over-spending with Stacks post-conditions

## 🏗️ Architecture

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   Ethereum      │       │  Circle         │       │   Stacks        │
│   Sepolia       │──────▶│  xReserve       │──────▶│   Testnet       │
│   (USDC)        │       │  Bridge         │       │   (USDCx)       │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                                            │
                                                            ▼
                                                    ┌─────────────────┐
                                                    │   SafeFlow      │
                                                    │   Smart Contract│
                                                    │   (Streaming)   │
                                                    └─────────────────┘
```

## 📁 Project Structure

```
safeflow/
├── contracts/
│   └── safeflow.clar          # Clarity streaming vault contract
├── src/
│   ├── components/
│   │   └── Dashboard.tsx      # Main Next.js dashboard
│   └── lib/
│       └── bridge-utils.ts    # Ethereum bridge utilities
├── Clarinet.toml              # Clarinet configuration
├── package.json               # Node.js dependencies
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- [Clarinet](https://docs.hiro.so/clarinet) for Clarity development
- MetaMask or compatible Ethereum wallet
- Leather or Xverse wallet for Stacks

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/safeflow.git
cd safeflow

# Install dependencies
npm install

# Run development server
npm run dev
```

### Clarity Contract Development

```bash
# Check contract syntax
clarinet check

# Run contract tests
clarinet test

# Open Clarinet console
clarinet console
```

## 📜 Smart Contract

### Key Functions

| Function | Description |
|----------|-------------|
| `start-stream` | Create a new payment stream with locked USDCx |
| `claim-drip` | Claim vested tokens based on current block height |
| `cancel-stream` | Cancel stream and refund remaining (sender only) |
| `get-claimable-amount` | Read-only: Calculate claimable amount |

### Streaming Math

The contract uses **linear vesting** based on Bitcoin block height:

```
claimable = (elapsed_blocks / total_blocks) × total_amount - claimed_amount
```

Where:
- `elapsed_blocks = current_block - start_block`
- `total_blocks = end_block - start_block`

## 🌉 Bridge Integration

### Circle xReserve

| Parameter | Value |
|-----------|-------|
| xReserve Address | `0x008888878f94C0d87defdf0B07f46B93C1934442` |
| Stacks Domain ID | `10003` |
| Network | Sepolia Testnet |

### Converting Addresses

The `stacksToHex32` function converts Stacks C32 addresses to 32-byte hex for Ethereum:

```typescript
import { stacksToHex32 } from '@/lib/bridge-utils';

const hex = stacksToHex32('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
// Returns: 0x00000000000000000000000000...
```

## 🔐 Security: Post-Conditions

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

## 🔧 Configuration

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

## 📊 API Reference

### Bridge Utils

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

## 🧪 Testing

```bash
# Run Clarity unit tests
clarinet test

# Run frontend tests
npm test
```

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Stacks Foundation](https://stacks.org) for the Clarity language
- [Circle](https://circle.com) for the xReserve bridge protocol
- [Hiro](https://hiro.so) for developer tooling
