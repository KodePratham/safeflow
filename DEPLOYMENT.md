# SafeFlow Deployment Guide

## Prerequisites

1. Install Clarinet
   ```powershell
   winget install HiroSystems.Clarinet
   ```

2. Get Test Tokens
   - Sepolia ETH: https://sepoliafaucet.com
   - Sepolia USDC: https://faucet.circle.com (select Sepolia)
   - Stacks Testnet STX: https://explorer.stacks.co/sandbox/faucet?chain=testnet

3. Install a Stacks wallet (Leather or Xverse)

---

## Step 1: Configure Environment

Create `.env.local`:

```env
STACKS_DEPLOYER_MNEMONIC="your 24 word mnemonic"
NEXT_PUBLIC_DEVPAYMENTS_ADDRESS=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
NEXT_PUBLIC_USDCX_ADDRESS=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
```

Edit `settings/Testnet.toml`:

```toml
[network]
name = "testnet"
stacks_node_rpc_address = "https://api.testnet.hiro.so"
deployment_fee_rate = 10

[accounts.deployer]
mnemonic = "your 24 word mnemonic"
derivation = "m/44'/5757'/0'/0/0"
```

---

## Step 2: Verify Contracts

Check for errors:

```powershell
clarinet check
```

Run tests locally:

```powershell
clarinet console
```

In console:

```clarity
(contract-call? .usdcx mint u1000000000 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)
(contract-call? .usdcx get-balance 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)
(contract-call? .dev-payments get-stats)
```

---

## Step 3: Deploy to Testnet

Generate deployment plan:

```powershell
clarinet deployments generate --testnet
```

Deploy contracts:

```powershell
clarinet deployments apply --testnet
```

Wait 10-20 minutes per contract. Monitor at:
https://explorer.stacks.co/?chain=testnet

---

## Step 4: Update Addresses

After deployment, update `.env.local` with your deployer address:

```env
NEXT_PUBLIC_DEVPAYMENTS_ADDRESS=ST<your_address>
NEXT_PUBLIC_USDCX_ADDRESS=ST<your_address>
```

Contract addresses are: `<deployer_address>.<contract_name>`

Example: `ST1ABC123XYZ.dev-payments`

---

## Step 5: Run Frontend

Install dependencies:

```powershell
bun install
```

Start server:

```powershell
bun dev
```

Access:
- Home: http://localhost:3000
- Admin: http://localhost:3000/admin
- Verify: http://localhost:3000/verify

---

## Step 6: Bridge USDC

1. Open Admin page
2. Connect MetaMask (Sepolia network)
3. Connect Stacks wallet
4. Enter USDC amount
5. Click Bridge to Stacks
6. Approve and confirm transactions
7. Wait 10-30 minutes for USDCx

---

## Step 7: Create Payment

1. Go to Admin > Create Payment tab
2. Enter recipient Stacks address
3. Enter total amount
4. Enter drip amount per period
5. Select daily or monthly
6. Add description
7. Confirm transaction

---

## Step 8: Claim Payment

1. Go to Verify page
2. Enter recipient address or connect wallet
3. View payment details
4. Click Claim (if connected as recipient)
5. Confirm transaction

---

## Reference

| Network | Contract | Address |
|---------|----------|---------|
| Sepolia | xReserve | 0x008888878f94C0d87defdf0B07f46B93C1934442 |
| Sepolia | USDC | 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 |
| Stacks | Domain ID | 10003 |

---

## Troubleshooting

**Contract not found**: Wait for deployment confirmation on explorer.

**Insufficient balance**: Get more testnet tokens from faucets.

**Bridge not working**: Ensure Sepolia network selected. Wait up to 30 minutes.

**Unauthorized in admin**: Only deployer wallet is admin.

---

## Resources

- Stacks Docs: https://docs.stacks.co
- Clarinet Docs: https://docs.hiro.so/clarinet
- Circle xReserve: https://developers.circle.com
