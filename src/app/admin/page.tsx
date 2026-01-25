'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AppConfig,
  UserSession,
  showConnect,
  openContractCall,
} from '@stacks/connect';
import {
  uintCV,
  principalCV,
  contractPrincipalCV,
  stringAsciiCV,
  stringUtf8CV,
  PostConditionMode,
  makeStandardFungiblePostCondition,
  FungibleConditionCode,
  createAssetInfo,
  cvToValue,
  callReadOnlyFunction,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  type Address,
} from 'viem';
import { sepolia } from 'viem/chains';
import {
  XRESERVE_ADDRESS,
  USDC_SEPOLIA_ADDRESS,
  STACKS_DOMAIN_ID,
  stacksToHex32,
  isValidStacksAddress,
} from '@/lib/bridge-utils';
import Link from 'next/link';

const DEVPAYMENTS_CONTRACT = {
  address: process.env.NEXT_PUBLIC_DEVPAYMENTS_ADDRESS || 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  name: 'dev-payments',
};

const USDCX_CONTRACT = {
  address: process.env.NEXT_PUBLIC_USDCX_ADDRESS || 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  name: 'usdcx',
};

const network = new StacksTestnet();
const appConfig = new AppConfig(['store_write', 'publish_data']);
const userSession = new UserSession({ appConfig });

const USDC_DECIMALS = 6;

const xReserveAbi = [
  {
    name: 'depositToRemote',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'recipient', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'messageId', type: 'bytes32' }],
  },
] as const;

const erc20Abi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function formatUSDCx(microAmount: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const whole = microAmount / divisor;
  const fraction = microAmount % divisor;
  if (fraction === 0n) return whole.toLocaleString();
  const fractionStr = fraction.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fractionStr}`;
}

function parseUSDCx(amount: string): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return BigInt(whole + paddedFraction);
}

export default function AdminPage() {
  const [user, setUser] = useState<{ address: string | null; isConnected: boolean }>({
    address: null,
    isConnected: false,
  });

  const [evmWallet, setEvmWallet] = useState<{
    address: Address | null;
    isConnected: boolean;
    usdcBalance: string;
  }>({
    address: null,
    isConnected: false,
    usdcBalance: '0',
  });

  const [recipientAddress, setRecipientAddress] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [dripAmount, setDripAmount] = useState('');
  const [dripInterval, setDripInterval] = useState<'daily' | 'monthly'>('monthly');
  const [description, setDescription] = useState('');
  const [bridgeAmount, setBridgeAmount] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'bridge' | 'create'>('bridge');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (userSession.isUserSignedIn()) {
      const userData = userSession.loadUserData();
      setUser({ address: userData.profile.stxAddress.testnet, isConnected: true });
    }
  }, []);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!user.address) return;
      try {
        const result = await callReadOnlyFunction({
          network,
          contractAddress: DEVPAYMENTS_CONTRACT.address,
          contractName: DEVPAYMENTS_CONTRACT.name,
          functionName: 'get-admin',
          functionArgs: [],
          senderAddress: user.address,
        });
        const adminAddress = cvToValue(result);
        setIsAdmin(user.address === adminAddress);
      } catch (err) {
        console.error('Failed to check admin:', err);
      }
    };
    checkAdmin();
  }, [user.address]);

  const connectWallet = useCallback(() => {
    showConnect({
      appDetails: { name: 'SafeFlow', icon: '/logo.png' },
      redirectTo: '/admin',
      onFinish: () => {
        const userData = userSession.loadUserData();
        setUser({ address: userData.profile.stxAddress.testnet, isConnected: true });
      },
      userSession,
    });
  }, []);

  const disconnectWallet = useCallback(() => {
    userSession.signUserOut('/admin');
    setUser({ address: null, isConnected: false });
    setIsAdmin(false);
  }, []);

  const fetchUsdcBalance = useCallback(async (address: Address) => {
    try {
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http('https://rpc.sepolia.org'),
      });
      const balance = await publicClient.readContract({
        address: USDC_SEPOLIA_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });
      setEvmWallet(prev => ({ ...prev, usdcBalance: formatUnits(balance, 6) }));
    } catch (err) {
      console.error('Failed to fetch balance:', err);
    }
  }, []);

  const connectEvmWallet = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('MetaMask not installed');
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as Address[];
      const chainId = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      
      if (parseInt(chainId, 16) !== 11155111) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }],
        });
      }
      
      setEvmWallet({ address: accounts[0], isConnected: true, usdcBalance: '0' });
      await fetchUsdcBalance(accounts[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsLoading(false);
    }
  }, [fetchUsdcBalance]);

  const bridgeUSDC = async () => {
    if (!evmWallet.isConnected || !evmWallet.address || !user.address) {
      setError('Connect both wallets first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const amountInBaseUnits = parseUnits(bridgeAmount, 6);
      const recipientHex32 = stacksToHex32(user.address);

      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum!),
      });

      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http('https://rpc.sepolia.org'),
      });

      const allowance = await publicClient.readContract({
        address: USDC_SEPOLIA_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [evmWallet.address, XRESERVE_ADDRESS],
      });

      if (allowance < amountInBaseUnits) {
        setSuccess('Approving USDC...');
        const approvalHash = await walletClient.writeContract({
          account: evmWallet.address,
          address: USDC_SEPOLIA_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [XRESERVE_ADDRESS, amountInBaseUnits],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }

      const txHash = await walletClient.writeContract({
        account: evmWallet.address,
        address: XRESERVE_ADDRESS,
        abi: xReserveAbi,
        functionName: 'depositToRemote',
        args: [STACKS_DOMAIN_ID, recipientHex32, amountInBaseUnits],
      });

      setSuccess(`Bridge initiated. TX: ${txHash.slice(0, 18)}... USDCx arrives in ~15 minutes.`);
      setBridgeAmount('');
      await fetchUsdcBalance(evmWallet.address);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bridge failed');
    } finally {
      setIsLoading(false);
    }
  };

  const createPayment = async () => {
    if (!user.address || !isAdmin) {
      setError('Admin access required');
      return;
    }

    if (!isValidStacksAddress(recipientAddress)) {
      setError('Invalid recipient address');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const totalMicro = parseUSDCx(totalAmount);
      const dripMicro = parseUSDCx(dripAmount);

      const postConditions = [
        makeStandardFungiblePostCondition(
          user.address,
          FungibleConditionCode.Equal,
          totalMicro,
          createAssetInfo(USDCX_CONTRACT.address, USDCX_CONTRACT.name, 'usdcx')
        ),
      ];

      await openContractCall({
        network,
        contractAddress: DEVPAYMENTS_CONTRACT.address,
        contractName: DEVPAYMENTS_CONTRACT.name,
        functionName: 'create-payment',
        functionArgs: [
          contractPrincipalCV(USDCX_CONTRACT.address, USDCX_CONTRACT.name),
          principalCV(recipientAddress),
          uintCV(totalMicro),
          uintCV(dripMicro),
          stringAsciiCV(dripInterval),
          stringUtf8CV(description || 'Developer Payment'),
        ],
        postConditionMode: PostConditionMode.Deny,
        postConditions,
        onFinish: (data) => {
          setSuccess(`Payment created. TX: ${data.txId}`);
          setRecipientAddress('');
          setTotalAmount('');
          setDripAmount('');
          setDescription('');
        },
        onCancel: () => setError('Transaction cancelled'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create payment');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-200 py-4 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-xl font-bold text-orange-500">SafeFlow</Link>
          <div className="flex items-center gap-4">
            <Link href="/verify" className="text-gray-600 hover:text-orange-500">Verify</Link>
            
            {evmWallet.isConnected ? (
              <span className="text-sm text-gray-600 border border-gray-200 px-3 py-1 rounded">
                ETH: {evmWallet.address?.slice(0, 6)}...
              </span>
            ) : (
              <button onClick={connectEvmWallet} disabled={isLoading} className="text-sm text-gray-600 hover:text-orange-500">
                Connect Ethereum
              </button>
            )}
            
            {user.isConnected ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 border border-gray-200 px-3 py-1 rounded">
                  STX: {user.address?.slice(0, 6)}...
                  {isAdmin && <span className="ml-1 text-orange-500">(Admin)</span>}
                </span>
                <button onClick={disconnectWallet} className="text-gray-400 hover:text-gray-600">x</button>
              </div>
            ) : (
              <button onClick={connectWallet} className="btn-primary text-sm py-2">
                Connect Stacks
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-6">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin</h2>
          <p className="text-gray-600 mb-8">Bridge USDC and create developer payments.</p>

          {error && (
            <div className="mb-6 p-4 border border-red-200 bg-red-50 rounded-lg text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-6 p-4 border border-green-200 bg-green-50 rounded-lg text-green-700">
              {success}
            </div>
          )}

          <div className="flex gap-4 mb-8 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('bridge')}
              className={`pb-3 px-1 text-sm font-medium transition-colors ${
                activeTab === 'bridge'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Bridge USDC
            </button>
            <button
              onClick={() => setActiveTab('create')}
              className={`pb-3 px-1 text-sm font-medium transition-colors ${
                activeTab === 'create'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Create Payment
            </button>
          </div>

          {activeTab === 'bridge' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="card">
                  <p className="text-sm text-gray-500 mb-1">Ethereum Sepolia</p>
                  {evmWallet.isConnected ? (
                    <>
                      <p className="font-mono text-sm">{evmWallet.address?.slice(0, 12)}...</p>
                      <p className="text-orange-500">{parseFloat(evmWallet.usdcBalance).toFixed(2)} USDC</p>
                    </>
                  ) : (
                    <button onClick={connectEvmWallet} className="btn-secondary w-full mt-2 text-sm py-2">
                      Connect
                    </button>
                  )}
                </div>
                <div className="card">
                  <p className="text-sm text-gray-500 mb-1">Stacks Testnet</p>
                  {user.isConnected ? (
                    <p className="font-mono text-sm">{user.address?.slice(0, 12)}...</p>
                  ) : (
                    <button onClick={connectWallet} className="btn-primary w-full mt-2 text-sm py-2">
                      Connect
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-2">Amount (USDC)</label>
                <input
                  type="text"
                  value={bridgeAmount}
                  onChange={(e) => setBridgeAmount(e.target.value)}
                  placeholder="100.00"
                  className="input"
                />
              </div>

              <button
                onClick={bridgeUSDC}
                disabled={!evmWallet.isConnected || !user.isConnected || isLoading || !bridgeAmount}
                className="btn-primary w-full"
              >
                {isLoading ? 'Processing...' : 'Bridge to Stacks'}
              </button>
            </div>
          )}

          {activeTab === 'create' && (
            <div className="space-y-6">
              {!isAdmin && user.isConnected && (
                <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg text-yellow-700">
                  Only the contract admin can create payments.
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-600 mb-2">Recipient Address</label>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  placeholder="ST..."
                  className="input font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-2">Total Amount (USDCx)</label>
                  <input
                    type="text"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="1000.00"
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-2">Drip Amount</label>
                  <input
                    type="text"
                    value={dripAmount}
                    onChange={(e) => setDripAmount(e.target.value)}
                    placeholder="100.00"
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-2">Interval</label>
                <div className="flex gap-4">
                  <button
                    onClick={() => setDripInterval('daily')}
                    className={`flex-1 py-2 rounded-lg border transition-colors ${
                      dripInterval === 'daily'
                        ? 'border-orange-500 text-orange-500 bg-orange-50'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    onClick={() => setDripInterval('monthly')}
                    className={`flex-1 py-2 rounded-lg border transition-colors ${
                      dripInterval === 'monthly'
                        ? 'border-orange-500 text-orange-500 bg-orange-50'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    Monthly
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-2">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Payment for Project X"
                  className="input"
                />
              </div>

              <button
                onClick={createPayment}
                disabled={!isAdmin || isLoading || !recipientAddress || !totalAmount || !dripAmount}
                className="btn-primary w-full"
              >
                {isLoading ? 'Processing...' : 'Create Payment'}
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-gray-200 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          SafeFlow — USDCx on Stacks
        </div>
      </footer>
    </div>
  );
}
