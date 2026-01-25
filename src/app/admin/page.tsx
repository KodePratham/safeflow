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

const SAFEFLOW_CONTRACT = {
  address: process.env.NEXT_PUBLIC_SAFEFLOW_ADDRESS || 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  name: 'safeflow',
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
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'value', type: 'uint256' },
      { name: 'remoteDomain', type: 'uint32' },
      { name: 'remoteRecipient', type: 'bytes32' },
      { name: 'localToken', type: 'address' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
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

interface SafeFlowData {
  id: number;
  admin: string;
  recipient: string;
  title: string;
  description: string;
  totalAmount: bigint;
  claimedAmount: bigint;
  dripRate: bigint;
  dripInterval: string;
  startBlock: number;
  lastClaimBlock: number;
  status: number;
  createdAt: number;
}

// Pending bridge transaction tracking
interface PendingBridgeTx {
  txHash: string;
  amount: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  stacksRecipient: string;
}

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

function getStatusText(status: number): string {
  switch (status) {
    case 1: return 'Active';
    case 2: return 'Frozen';
    case 3: return 'Cancelled';
    default: return 'Unknown';
  }
}

function getStatusColor(status: number): string {
  switch (status) {
    case 1: return 'bg-green-50 text-green-700 border-green-200';
    case 2: return 'bg-blue-50 text-blue-700 border-blue-200';
    case 3: return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-gray-100 text-gray-600 border-gray-200';
  }
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

  // USDCx balance on Stacks
  const [usdcxBalance, setUsdcxBalance] = useState<bigint>(0n);
  const [previousUsdcxBalance, setPreviousUsdcxBalance] = useState<bigint>(0n);
  
  // Pending bridge transactions
  const [pendingBridgeTxs, setPendingBridgeTxs] = useState<PendingBridgeTx[]>([]);
  const BRIDGE_TX_KEY = 'safeflow_pending_bridges';

  // Create SafeFlow form
  const [recipientAddress, setRecipientAddress] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [dripAmount, setDripAmount] = useState('');
  const [dripInterval, setDripInterval] = useState<'daily' | 'monthly'>('monthly');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bridgeAmount, setBridgeAmount] = useState('');

  // SafeFlows list
  const [mySafeFlows, setMySafeFlows] = useState<SafeFlowData[]>([]);
  const [selectedSafeFlow, setSelectedSafeFlow] = useState<SafeFlowData | null>(null);

  // Bridging modal state
  const [bridgingModal, setBridgingModal] = useState<{
    isOpen: boolean;
    status: 'approving' | 'bridging' | 'pending' | 'success' | 'error';
    txHash: string | null;
    message: string;
  }>({
    isOpen: false,
    status: 'approving',
    txHash: null,
    message: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'bridge' | 'create' | 'manage'>('bridge');

  useEffect(() => {
    if (userSession.isUserSignedIn()) {
      const userData = userSession.loadUserData();
      setUser({ address: userData.profile.stxAddress.testnet, isConnected: true });
    }
  }, []);

  // Fetch user's SafeFlows
  const fetchMySafeFlows = useCallback(async () => {
    if (!user.address) return;
    
    try {
      const countResult = await callReadOnlyFunction({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'get-admin-safeflow-count',
        functionArgs: [principalCV(user.address)],
        senderAddress: user.address,
      });
      
      const count = Number(cvToValue(countResult));
      const safeflows: SafeFlowData[] = [];
      
      for (let i = 0; i < count; i++) {
        const idResult = await callReadOnlyFunction({
          network,
          contractAddress: SAFEFLOW_CONTRACT.address,
          contractName: SAFEFLOW_CONTRACT.name,
          functionName: 'get-admin-safeflow-id',
          functionArgs: [principalCV(user.address), uintCV(i)],
          senderAddress: user.address,
        });
        
        const idData = cvToValue(idResult);
        if (!idData) continue;
        
        const sfId = Number(idData.id);
        
        const sfResult = await callReadOnlyFunction({
          network,
          contractAddress: SAFEFLOW_CONTRACT.address,
          contractName: SAFEFLOW_CONTRACT.name,
          functionName: 'get-safeflow',
          functionArgs: [uintCV(sfId)],
          senderAddress: user.address,
        });
        
        const sf = cvToValue(sfResult);
        if (!sf) continue;
        
        safeflows.push({
          id: sfId,
          admin: sf.admin,
          recipient: sf.recipient,
          title: sf.title,
          description: sf.description,
          totalAmount: BigInt(sf['total-amount']),
          claimedAmount: BigInt(sf['claimed-amount']),
          dripRate: BigInt(sf['drip-rate']),
          dripInterval: sf['drip-interval'],
          startBlock: Number(sf['start-block']),
          lastClaimBlock: Number(sf['last-claim-block']),
          status: Number(sf.status),
          createdAt: Number(sf['created-at']),
        });
      }
      
      setMySafeFlows(safeflows);
    } catch (err) {
      console.error('Failed to fetch SafeFlows:', err);
    }
  }, [user.address]);

  // Fetch USDCx balance on Stacks
  const fetchUsdcxBalance = useCallback(async () => {
    if (!user.address) return;
    
    try {
      const result = await callReadOnlyFunction({
        network,
        contractAddress: USDCX_CONTRACT.address,
        contractName: USDCX_CONTRACT.name,
        functionName: 'get-balance',
        functionArgs: [principalCV(user.address)],
        senderAddress: user.address,
      });
      
      const balanceValue = cvToValue(result);
      // balanceValue is { value: "123456" } format
      const balance = BigInt(balanceValue.value || balanceValue || 0);
      setUsdcxBalance(balance);
    } catch (err) {
      console.error('Failed to fetch USDCx balance:', err);
      setUsdcxBalance(0n);
    }
  }, [user.address]);

  // Load pending bridge transactions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(BRIDGE_TX_KEY);
      if (stored) {
        const txs = JSON.parse(stored) as PendingBridgeTx[];
        // Filter out transactions older than 2 hours
        const recent = txs.filter(tx => Date.now() - tx.timestamp < 2 * 60 * 60 * 1000);
        setPendingBridgeTxs(recent);
        if (recent.length !== txs.length) {
          localStorage.setItem(BRIDGE_TX_KEY, JSON.stringify(recent));
        }
      }
    } catch {
      console.error('Failed to load pending bridge transactions');
    }
  }, []);

  // Save pending bridge transactions to localStorage
  const savePendingBridgeTxs = useCallback((txs: PendingBridgeTx[]) => {
    setPendingBridgeTxs(txs);
    localStorage.setItem(BRIDGE_TX_KEY, JSON.stringify(txs));
  }, []);

  // Auto-refresh USDCx balance every 30 seconds when there are pending bridges
  useEffect(() => {
    if (!user.address) return;
    
    fetchMySafeFlows();
    fetchUsdcxBalance();
    
    // If there are pending bridges, poll more frequently
    const hasPending = pendingBridgeTxs.some(tx => tx.status === 'pending');
    const interval = hasPending ? 30000 : 60000; // 30s if pending, 60s otherwise
    
    const timer = setInterval(() => {
      fetchUsdcxBalance();
    }, interval);
    
    return () => clearInterval(timer);
  }, [user.address, fetchMySafeFlows, fetchUsdcxBalance, pendingBridgeTxs]);

  // Check if balance increased (bridge completed)
  useEffect(() => {
    if (usdcxBalance > previousUsdcxBalance && previousUsdcxBalance > 0n) {
      // Balance increased - likely bridge completed
      const increased = usdcxBalance - previousUsdcxBalance;
      setSuccess(`🎉 Bridge complete! Received ${formatUSDCx(increased)} USDCx`);
      
      // Mark pending transactions as completed
      const updated = pendingBridgeTxs.map(tx => 
        tx.status === 'pending' ? { ...tx, status: 'completed' as const } : tx
      );
      savePendingBridgeTxs(updated);
    }
    setPreviousUsdcxBalance(usdcxBalance);
  }, [usdcxBalance, previousUsdcxBalance, pendingBridgeTxs, savePendingBridgeTxs]);

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
    setMySafeFlows([]);
  }, []);

  const fetchUsdcBalance = useCallback(async (address: Address) => {
    try {
      // Try multiple RPC endpoints for reliability
      const rpcEndpoints = [
        'https://ethereum-sepolia-rpc.publicnode.com',
        'https://rpc.sepolia.org',
        'https://sepolia.drpc.org',
      ];
      
      let balance: bigint | null = null;
      
      for (const rpc of rpcEndpoints) {
        try {
          const publicClient = createPublicClient({
            chain: sepolia,
            transport: http(rpc),
          });
          balance = await publicClient.readContract({
            address: USDC_SEPOLIA_ADDRESS,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          });
          break; // Success, exit loop
        } catch {
          continue; // Try next RPC
        }
      }
      
      if (balance !== null) {
        setEvmWallet(prev => ({ ...prev, usdcBalance: formatUnits(balance!, 6) }));
      }
    } catch (err) {
      console.error('Failed to fetch USDC balance:', err);
      setEvmWallet(prev => ({ ...prev, usdcBalance: '0' }));
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

  // Helper to create a reliable public client with fallback RPCs
  const getPublicClient = useCallback(() => {
    // Use multiple RPCs with shorter timeout
    const rpcEndpoints = [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org',
      'https://1rpc.io/sepolia',
    ];
    
    return createPublicClient({
      chain: sepolia,
      transport: http(rpcEndpoints[0], { timeout: 30_000 }),
    });
  }, []);

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

      // Check allowance - try multiple RPCs
      let allowance: bigint = 0n;
      const rpcEndpoints = [
        'https://ethereum-sepolia-rpc.publicnode.com',
        'https://sepolia.drpc.org', 
        'https://1rpc.io/sepolia',
      ];
      
      for (const rpc of rpcEndpoints) {
        try {
          const publicClient = createPublicClient({
            chain: sepolia,
            transport: http(rpc, { timeout: 15_000 }),
          });
          allowance = await publicClient.readContract({
            address: USDC_SEPOLIA_ADDRESS,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [evmWallet.address, XRESERVE_ADDRESS],
          });
          break;
        } catch {
          console.log(`RPC ${rpc} failed, trying next...`);
          continue;
        }
      }

      if (allowance < amountInBaseUnits) {
        setBridgingModal({
          isOpen: true,
          status: 'approving',
          txHash: null,
          message: 'Please approve USDC spending in MetaMask...',
        });
        
        const approvalHash = await walletClient.writeContract({
          account: evmWallet.address,
          address: USDC_SEPOLIA_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [XRESERVE_ADDRESS, amountInBaseUnits],
          gas: 100_000n, // Explicit gas limit
        });
        
        setBridgingModal(prev => ({ ...prev, message: 'Waiting for approval confirmation...' }));
        
        // Wait for receipt using a working RPC
        for (const rpc of rpcEndpoints) {
          try {
            const publicClient = createPublicClient({
              chain: sepolia,
              transport: http(rpc, { timeout: 60_000 }),
            });
            await publicClient.waitForTransactionReceipt({ hash: approvalHash });
            break;
          } catch {
            continue;
          }
        }
      }

      setBridgingModal({
        isOpen: true,
        status: 'bridging',
        txHash: null,
        message: 'Please confirm bridge transaction in MetaMask...',
      });
      
      const txHash = await walletClient.writeContract({
        account: evmWallet.address,
        address: XRESERVE_ADDRESS,
        abi: xReserveAbi,
        functionName: 'depositToRemote',
        args: [
          amountInBaseUnits,        // value: amount of USDC
          STACKS_DOMAIN_ID,         // remoteDomain: Stacks = 10003
          recipientHex32,           // remoteRecipient: Stacks address as bytes32
          USDC_SEPOLIA_ADDRESS,     // localToken: USDC contract address
          0n,                       // maxFee: no fee cap
          '0x' as `0x${string}`,    // hookData: empty bytes
        ],
        gas: 300_000n, // Explicit gas limit for xReserve
      });

      // Save pending bridge transaction for tracking
      const newPendingTx: PendingBridgeTx = {
        txHash: txHash,
        amount: bridgeAmount,
        timestamp: Date.now(),
        status: 'pending',
        stacksRecipient: user.address,
      };
      savePendingBridgeTxs([newPendingTx, ...pendingBridgeTxs.filter(tx => tx.txHash !== txHash)]);

      setBridgingModal({
        isOpen: true,
        status: 'pending',
        txHash: txHash,
        message: 'Bridge transaction submitted! USDCx will arrive in ~15-30 minutes.',
      });
      
      setSuccess(`Bridge initiated! TX: ${txHash.slice(0, 10)}...`);
      setBridgeAmount('');
      await fetchUsdcBalance(evmWallet.address);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge failed';
      let errorMessage = message;
      
      if (message.includes('rejected') || message.includes('denied')) {
        errorMessage = 'Transaction rejected by user';
      } else if (message.includes('insufficient')) {
        errorMessage = 'Insufficient USDC balance';
      } else if (message.includes('gas')) {
        errorMessage = 'Gas estimation failed. Please try again.';
      }
      
      setBridgingModal({
        isOpen: true,
        status: 'error',
        txHash: null,
        message: errorMessage,
      });
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const createSafeFlow = async () => {
    if (!user.address) {
      setError('Please connect your wallet');
      return;
    }

    if (!isValidStacksAddress(recipientAddress)) {
      setError('Invalid recipient address');
      return;
    }

    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }

    // Validate USDCx balance
    const totalMicroCheck = parseUSDCx(totalAmount);
    if (totalMicroCheck > usdcxBalance) {
      setError(`Insufficient USDCx balance. You have ${formatUSDCx(usdcxBalance)} USDCx but trying to allocate ${totalAmount} USDCx. Bridge more USDC first.`);
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
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'create-safeflow',
        functionArgs: [
          contractPrincipalCV(USDCX_CONTRACT.address, USDCX_CONTRACT.name),
          principalCV(recipientAddress),
          stringUtf8CV(title),
          stringUtf8CV(description || 'No description'),
          uintCV(totalMicro),
          uintCV(dripMicro),
          stringAsciiCV(dripInterval),
        ],
        postConditionMode: PostConditionMode.Deny,
        postConditions,
        onFinish: (data) => {
          setSuccess(`SafeFlow created! TX: ${data.txId}`);
          setRecipientAddress('');
          setTotalAmount('');
          setDripAmount('');
          setTitle('');
          setDescription('');
          fetchMySafeFlows();
          fetchUsdcxBalance(); // Refresh USDCx balance after creation
        },
        onCancel: () => setError('Transaction cancelled'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create SafeFlow');
    } finally {
      setIsLoading(false);
    }
  };

  const freezeSafeFlow = async (id: number) => {
    if (!user.address) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await openContractCall({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'freeze-safeflow',
        functionArgs: [uintCV(id)],
        postConditionMode: PostConditionMode.Allow,
        onFinish: (data) => {
          setSuccess(`SafeFlow frozen. TX: ${data.txId}`);
          fetchMySafeFlows();
          setSelectedSafeFlow(null);
        },
        onCancel: () => setError('Transaction cancelled'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to freeze SafeFlow');
    } finally {
      setIsLoading(false);
    }
  };

  const unfreezeSafeFlow = async (id: number) => {
    if (!user.address) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await openContractCall({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'unfreeze-safeflow',
        functionArgs: [uintCV(id)],
        postConditionMode: PostConditionMode.Allow,
        onFinish: (data) => {
          setSuccess(`SafeFlow resumed. TX: ${data.txId}`);
          fetchMySafeFlows();
          setSelectedSafeFlow(null);
        },
        onCancel: () => setError('Transaction cancelled'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume SafeFlow');
    } finally {
      setIsLoading(false);
    }
  };

  const cancelSafeFlow = async (id: number) => {
    if (!user.address) return;

    if (!confirm('Are you sure you want to cancel this SafeFlow? Remaining USDCx will be returned to your wallet.')) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await openContractCall({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'cancel-safeflow',
        functionArgs: [
          contractPrincipalCV(USDCX_CONTRACT.address, USDCX_CONTRACT.name),
          uintCV(id),
        ],
        postConditionMode: PostConditionMode.Allow,
        onFinish: (data) => {
          setSuccess(`SafeFlow cancelled. Remaining USDCx returned. TX: ${data.txId}`);
          fetchMySafeFlows();
          setSelectedSafeFlow(null);
        },
        onCancel: () => setError('Transaction cancelled'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel SafeFlow');
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
                </span>
                <button onClick={disconnectWallet} className="text-gray-400 hover:text-gray-600">×</button>
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
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Create & Manage SafeFlows</h2>
          <p className="text-gray-600 mb-8">Bridge USDC to USDCx and create programmable payment streams.</p>

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
              Create SafeFlow
            </button>
            <button
              onClick={() => setActiveTab('manage')}
              className={`pb-3 px-1 text-sm font-medium transition-colors ${
                activeTab === 'manage'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Manage ({mySafeFlows.length})
            </button>
          </div>

          {activeTab === 'bridge' && (
            <div className="space-y-6">
              {/* USDCx Balance Display */}
              {user.isConnected && (
                <div className="card bg-gradient-to-r from-orange-50 to-orange-100 border-orange-200">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-gray-600">Your USDCx Balance on Stacks</p>
                      <p className="text-2xl font-bold text-orange-600">${formatUSDCx(usdcxBalance)} USDCx</p>
                    </div>
                    <button
                      onClick={fetchUsdcxBalance}
                      className="text-orange-500 hover:text-orange-600 p-2"
                      title="Refresh balance"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              )}

              {/* Pending Bridge Transactions */}
              {pendingBridgeTxs.filter(tx => tx.status === 'pending').length > 0 && (
                <div className="card border-yellow-200 bg-yellow-50">
                  <h4 className="font-bold text-yellow-800 mb-3 flex items-center gap-2">
                    <span className="animate-pulse">⏳</span> Pending Bridge Transactions
                  </h4>
                  <div className="space-y-2">
                    {pendingBridgeTxs.filter(tx => tx.status === 'pending').map(tx => {
                      const elapsed = Math.floor((Date.now() - tx.timestamp) / 60000);
                      return (
                        <div key={tx.txHash} className="flex items-center justify-between text-sm p-2 bg-white rounded border border-yellow-100">
                          <div>
                            <p className="font-medium">{tx.amount} USDC</p>
                            <p className="text-xs text-gray-500">{elapsed} min ago</p>
                          </div>
                          <div className="text-right">
                            <a
                              href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange-500 hover:text-orange-600 text-xs underline"
                            >
                              View on Etherscan ↗
                            </a>
                            <p className="text-xs text-yellow-600 mt-1">~{Math.max(0, 15 - elapsed)}-{Math.max(0, 30 - elapsed)} min remaining</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-yellow-700 mt-3">
                    💡 Your USDCx balance will update automatically when the bridge completes.
                  </p>
                </div>
              )}

              {/* Recently Completed Bridges */}
              {pendingBridgeTxs.filter(tx => tx.status === 'completed').length > 0 && (
                <div className="card border-green-200 bg-green-50">
                  <h4 className="font-bold text-green-800 mb-2 flex items-center gap-2">
                    ✅ Recently Completed
                  </h4>
                  <div className="space-y-1">
                    {pendingBridgeTxs.filter(tx => tx.status === 'completed').slice(0, 3).map(tx => (
                      <div key={tx.txHash} className="flex justify-between text-sm">
                        <span className="text-green-700">{tx.amount} USDC → USDCx</span>
                        <a
                          href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-600 text-xs underline"
                        >
                          tx ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                {isLoading ? 'Processing...' : 'Bridge to Stacks (USDCx)'}
              </button>
              
              <p className="text-sm text-gray-500 text-center">
                USDC will be converted to USDCx on Stacks via Circle xReserve. Takes ~10-30 minutes.
              </p>
            </div>
          )}

          {activeTab === 'create' && (
            <div className="space-y-6">
              {!user.isConnected && (
                <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg text-yellow-700">
                  Connect your Stacks wallet to create a SafeFlow.
                </div>
              )}

              {user.isConnected && (
                <div className="p-4 border border-orange-200 bg-orange-50 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Your USDCx Balance:</span>
                    <span className="font-bold text-orange-600 text-lg">${formatUSDCx(usdcxBalance)} USDCx</span>
                  </div>
                  {usdcxBalance === 0n && (
                    <p className="text-sm text-orange-700 mt-2">
                      You need USDCx to create a SafeFlow. <button onClick={() => setActiveTab('bridge')} className="underline font-medium">Bridge USDC first →</button>
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-600 mb-2">Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Developer Salary Q1"
                  className="input"
                  maxLength={50}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Monthly payment for frontend development work..."
                  className="input min-h-[80px]"
                  maxLength={200}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-2">Recipient Address *</label>
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
                  <label className="block text-sm text-gray-600 mb-2">Total Amount (USDCx) *</label>
                  <input
                    type="text"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="1000.00"
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-2">Drip Per Period *</label>
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
                <label className="block text-sm text-gray-600 mb-2">Drip Interval</label>
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

              <button
                onClick={createSafeFlow}
                disabled={!user.isConnected || isLoading || !recipientAddress || !totalAmount || !dripAmount || !title}
                className="btn-primary w-full"
              >
                {isLoading ? 'Processing...' : 'Create SafeFlow'}
              </button>
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="space-y-6">
              {!user.isConnected ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 mb-4">Connect your wallet to see your SafeFlows</p>
                  <button onClick={connectWallet} className="btn-primary">
                    Connect Wallet
                  </button>
                </div>
              ) : mySafeFlows.length === 0 ? (
                <div className="text-center py-12">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">No SafeFlows Yet</h3>
                  <p className="text-gray-500 mb-4">Create your first SafeFlow to start streaming payments.</p>
                  <button onClick={() => setActiveTab('create')} className="btn-primary">
                    Create SafeFlow
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {mySafeFlows.map((sf) => (
                    <div
                      key={sf.id}
                      className={`card cursor-pointer transition-colors ${
                        selectedSafeFlow?.id === sf.id ? 'ring-2 ring-orange-500' : ''
                      }`}
                      onClick={() => setSelectedSafeFlow(selectedSafeFlow?.id === sf.id ? null : sf)}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-gray-900">{sf.title}</h4>
                        <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(sf.status)}`}>
                          {getStatusText(sf.status)}
                        </span>
                      </div>
                      
                      <p className="text-sm text-gray-500 mb-3 truncate">
                        To: {sf.recipient.slice(0, 12)}...{sf.recipient.slice(-8)}
                      </p>
                      
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Progress</span>
                        <span className="text-gray-900">
                          ${formatUSDCx(sf.claimedAmount)} / ${formatUSDCx(sf.totalAmount)}
                        </span>
                      </div>
                      
                      <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-orange-500"
                          style={{ width: `${Number(sf.claimedAmount * 100n / sf.totalAmount)}%` }}
                        />
                      </div>

                      {selectedSafeFlow?.id === sf.id && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          {sf.description && (
                            <p className="text-sm text-gray-600 mb-4">{sf.description}</p>
                          )}
                          
                          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                            <div>
                              <p className="text-gray-400">Remaining</p>
                              <p className="font-mono">${formatUSDCx(sf.totalAmount - sf.claimedAmount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-400">Rate</p>
                              <p className="font-mono">{sf.dripInterval}</p>
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            {sf.status === 1 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); freezeSafeFlow(sf.id); }}
                                disabled={isLoading}
                                className="flex-1 py-2 px-4 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors text-sm"
                              >
                                Freeze
                              </button>
                            )}
                            {sf.status === 2 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); unfreezeSafeFlow(sf.id); }}
                                disabled={isLoading}
                                className="flex-1 py-2 px-4 rounded-lg border border-green-200 text-green-600 hover:bg-green-50 transition-colors text-sm"
                              >
                                Resume
                              </button>
                            )}
                            {sf.status !== 3 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); cancelSafeFlow(sf.id); }}
                                disabled={isLoading}
                                className="flex-1 py-2 px-4 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors text-sm"
                              >
                                Cancel & Return USDCx
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bridging Modal */}
      {bridgingModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="text-center">
              {bridgingModal.status === 'approving' && (
                <>
                  <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Approving USDC</h3>
                </>
              )}
              
              {bridgingModal.status === 'bridging' && (
                <>
                  <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Bridging USDC</h3>
                </>
              )}
              
              {bridgingModal.status === 'pending' && (
                <>
                  <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">🌉</span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Bridge in Progress!</h3>
                </>
              )}
              
              {bridgingModal.status === 'success' && (
                <>
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">✓</span>
                  </div>
                  <h3 className="text-xl font-bold text-green-600 mb-2">Bridge Complete!</h3>
                </>
              )}
              
              {bridgingModal.status === 'error' && (
                <>
                  <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">✕</span>
                  </div>
                  <h3 className="text-xl font-bold text-red-600 mb-2">Bridge Failed</h3>
                </>
              )}
              
              <p className="text-gray-600 mb-4">{bridgingModal.message}</p>
              
              {bridgingModal.txHash && (
                <a 
                  href={`https://sepolia.etherscan.io/tx/${bridgingModal.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-500 hover:text-orange-600 underline text-sm block mb-4"
                >
                  View on Etherscan ↗
                </a>
              )}
              
              {bridgingModal.status === 'pending' && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4 text-left">
                  <p className="text-sm text-orange-700 mb-2">
                    <strong>⏱ Estimated time:</strong> 15-30 minutes
                  </p>
                  <p className="text-sm text-orange-700 mb-2">
                    <strong>📍 What happens next:</strong>
                  </p>
                  <ol className="text-sm text-orange-700 list-decimal list-inside space-y-1">
                    <li>Circle xReserve processes your deposit</li>
                    <li>Stacks attestation service verifies the transfer</li>
                    <li>USDCx is minted to your Stacks wallet</li>
                  </ol>
                  <p className="text-sm text-orange-600 mt-3">
                    💡 Stay on this page - your balance will update automatically!
                  </p>
                </div>
              )}
              
              <button
                onClick={() => setBridgingModal(prev => ({ ...prev, isOpen: false }))}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  bridgingModal.status === 'error' 
                    ? 'bg-red-500 text-white hover:bg-red-600' 
                    : 'bg-orange-500 text-white hover:bg-orange-600'
                }`}
              >
                {bridgingModal.status === 'pending' ? 'Got it!' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-gray-200 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          SafeFlow — Programmable USDCx Payment Streams on Stacks
        </div>
      </footer>
    </div>
  );
}
