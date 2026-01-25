# Clarinet Setup Guide

Clarinet is a development environment for building, testing, and deploying Clarity smart contracts on the Stacks blockchain.

## Installation

### Windows

Using WinGet (recommended):
```powershell
winget install HiroSystems.Clarinet
```

Using Chocolatey:
```powershell
choco install clarinet
```

### macOS

Using Homebrew:
```bash
brew install clarinet
```

### Linux

Using the install script:
```bash
curl -L https://github.com/hirosystems/clarinet/releases/download/v2.4.0/clarinet-linux-x64.tar.gz | tar xz
sudo mv clarinet /usr/local/bin/
```

### Verify Installation

```bash
clarinet --version
```

---

## Project Structure

A typical Clarinet project has this structure:

```
my-project/
├── Clarinet.toml          # Project configuration
├── settings/
│   ├── Devnet.toml        # Local development settings
│   └── Testnet.toml       # Testnet deployment settings
├── contracts/
│   └── my-contract.clar   # Clarity smart contracts
└── tests/
    └── my-contract_test.ts # Contract tests
```

---

## Essential Commands

### Check Contracts

Validate your contracts for syntax and semantic errors:

```bash
clarinet check
```

### Interactive Console

Launch an interactive REPL to test your contracts:

```bash
clarinet console
```

In the console, you can:
```clarity
;; Call contract functions
(contract-call? .my-contract my-function arg1 arg2)

;; Check balances
(stx-get-balance 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)

;; Mint test tokens
(contract-call? .usdcx mint u1000000000 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)
```

### Run Tests

Execute your test suite:

```bash
clarinet test
```

### Local Development Network

Start a local devnet for testing:

```bash
clarinet devnet start
```

---

## Deploying to Testnet

### 1. Configure Testnet Settings

Edit `settings/Testnet.toml`:

```toml
[network]
name = "testnet"
stacks_node_rpc_address = "https://api.testnet.hiro.so"
deployment_fee_rate = 10

[accounts.deployer]
mnemonic = "your 24 word mnemonic phrase here"
derivation = "m/44'/5757'/0'/0/0"
```

### 2. Generate Deployment Plan

```bash
clarinet deployments generate --testnet
```

This creates a deployment plan in `deployments/`.

### 3. Deploy Contracts

```bash
clarinet deployments apply --testnet
```

Wait 10-20 minutes per contract for confirmation.

### 4. Monitor Deployment

Track your deployment at:
- https://explorer.stacks.co/?chain=testnet

---

## Clarinet.toml Configuration

```toml
[project]
name = "safeflow"
description = "Programmable payment streams on Stacks"
authors = []
telemetry = false

[project.requirements]
# External contract dependencies
[[project.requirements]]
contract_id = "ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.sip-010-trait-ft-standard"

# Contract definitions
[contracts.my-contract]
path = "contracts/my-contract.clar"
clarity_version = 2
epoch = 2.5
```

---

## Testing with Vitest

Clarinet uses Vitest for running tests. Example test file:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Cl } from '@stacks/transactions';

describe('SafeFlow Contract', () => {
  it('should create a new safeflow', () => {
    const result = simnet.callPublicFn(
      'safeflow',
      'create-safeflow',
      [
        Cl.contractPrincipal('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM', 'usdcx'),
        Cl.principal('ST1RECIPIENT...'),
        Cl.stringUtf8('My SafeFlow'),
        Cl.stringUtf8('Description'),
        Cl.uint(1000000000), // 1000 USDCx
        Cl.uint(100000000),  // 100 USDCx per period
        Cl.stringAscii('monthly'),
      ],
      'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM'
    );
    
    expect(result.result).toBeOk();
  });
});
```

Run tests:
```bash
clarinet test
```

---

## Getting Testnet Tokens

1. **STX Tokens**: https://explorer.stacks.co/sandbox/faucet?chain=testnet
2. **Sepolia ETH**: https://sepoliafaucet.com
3. **Sepolia USDC**: https://faucet.circle.com (select Sepolia)

---

## Common Issues

### "Contract not found"
- Wait for deployment confirmation on the explorer
- Verify the contract address in your .env file

### "Insufficient balance"
- Get more testnet tokens from faucets

### "Trait not found"
- Ensure trait contracts are deployed first
- Check the contract_id in requirements

---

## Resources

- [Clarinet Documentation](https://docs.hiro.so/clarinet)
- [Clarity Language Reference](https://docs.stacks.co/clarity)
- [Stacks API Documentation](https://docs.stacks.co/api)
- [Hiro Discord](https://discord.gg/hiro)
