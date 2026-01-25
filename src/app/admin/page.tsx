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

// Local/custom USDCx contract for SafeFlow (used for local testing)
const USDCX_CONTRACT = {
  address: process.env.NEXT_PUBLIC_USDCX_ADDRESS || 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  name: 'usdcx',
};

// Circle's official USDCx contracts on Stacks (from xReserve bridge)
// These are the real USDCx tokens minted when bridging via Circle xReserve
// Check: https://docs.stacks.co/learn/bridging/usdcx/contracts for latest addresses
const CIRCLE_USDCX_CONTRACTS = [
  // Circle's official USDCx on mainnet
  { address: 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE', name: 'usdcx' },
  // Common testnet deployers - Circle may deploy to any of these
  { address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM', name: 'usdcx' },
  { address: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG', name: 'usdcx' },
  { address: 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP', name: 'usdcx' },
  // User-configured Circle USDCx address from env
  ...(process.env.NEXT_PUBLIC_CIRCLE_USDCX_ADDRESS 
    ? [{ address: process.env.NEXT_PUBLIC_CIRCLE_USDCX_ADDRESS, name: 'usdcx' }] 
    : []),
];

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
    case 1: return 'text-green-500 border-green-500';
    case 2: return 'text-blue-500 border-blue-500';
    case 3: return 'text-red-500 border-red-500';
    default: return 'text-gray-500 border-gray-500';
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

  // Fetch USDCx balance on Stacks - checks multiple sources including Circle's official contract
  const fetchUsdcxBalance = useCallback(async () => {
    if (!user.address) return;
    
    let totalBalance = 0n;
    const foundBalances: { contract: string; balance: bigint }[] = [];
    
    // 1. First, try to fetch from Stacks API to get all fungible token holdings
    try {
      const apiUrl = `https://api.testnet.hiro.so/extended/v1/address/${user.address}/balances`;
      const response = await fetch(apiUrl);
      if (response.ok) {
        const data = await response.json();
        
        // Check for any USDCx tokens in the fungible_tokens
        if (data.fungible_tokens) {
          for (const [tokenId, tokenData] of Object.entries(data.fungible_tokens)) {
            // Look for USDCx tokens (could be usdcx, usdcx-token, etc.)
            const lowerTokenId = tokenId.toLowerCase();
            if (lowerTokenId.includes('usdcx') || lowerTokenId.includes('usdc')) {
              const tokenBalance = BigInt((tokenData as { balance: string }).balance || '0');
              if (tokenBalance > 0n) {
                foundBalances.push({ contract: tokenId, balance: tokenBalance });
                totalBalance += tokenBalance;
                console.log(`Found USDCx balance via API: ${tokenId} = ${tokenBalance}`);
              }
            }
          }
        }
      }
    } catch (apiErr) {
      console.log('API balance fetch failed, falling back to contract calls:', apiErr);
    }
    
    // 2. Also try direct contract calls to known USDCx contracts
    const contractsToTry = [
      USDCX_CONTRACT,
      ...CIRCLE_USDCX_CONTRACTS,
    ];
    
    // Dedupe contracts by address
    const seenAddresses = new Set<string>();
    const uniqueContracts = contractsToTry.filter(c => {
      const key = `${c.address}.${c.name}`;
      if (seenAddresses.has(key)) return false;
      seenAddresses.add(key);
      return true;
    });
    
    for (const contract of uniqueContracts) {
      // Skip if we already found this contract via API
      const contractId = `${contract.address}.${contract.name}`;
      if (foundBalances.some(fb => fb.contract.includes(contractId))) {
        continue;
      }
      
      try {
        const result = await callReadOnlyFunction({
          network,
          contractAddress: contract.address,
          contractName: contract.name,
          functionName: 'get-balance',
          functionArgs: [principalCV(user.address)],
          senderAddress: user.address,
        });
        
        const balanceValue = cvToValue(result);
        // balanceValue could be { value: "123456" } or just a number
        const balance = BigInt(balanceValue?.value || balanceValue || 0);
        
        if (balance > 0n) {
          foundBalances.push({ contract: contractId, balance });
          totalBalance += balance;
          console.log(`Found USDCx balance via contract call: ${contractId} = ${balance}`);
        }
      } catch (err) {
        // Contract might not exist or have different interface - that's ok
        console.log(`Contract ${contractId} not available:`, (err as Error).message);
      }
    }
    
    // Log summary
    if (foundBalances.length > 0) {
      console.log('USDCx balance summary:', foundBalances);
      console.log('Total USDCx balance:', totalBalance.toString());
    } else {
      console.log('No USDCx balance found in any known contracts');
    }
    
    setUsdcxBalance(totalBalance);
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
      setSuccess(`BRIDGE COMPLETE! RECEIVED ${formatUSDCx(increased)} USDCx`);
      
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
    <div className="min-h-screen flex flex-col bg-black text-white">
      <header className="border-b-2 border-gray-800 py-4 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-xl text-orange-500 uppercase tracking-widest">SafeFlow</Link>
          <div className="flex items-center gap-4">
            <Link href="/verify" className="text-gray-400 hover:text-orange-500 text-sm uppercase tracking-widest transition-none">Verify</Link>
            
            {evmWallet.isConnected ? (
              <span className="text-xs text-gray-400 border border-gray-800 px-3 py-1 font-mono uppercase">
                ETH: {evmWallet.address?.slice(0, 6)}...
              </span>
            ) : (
              <button onClick={connectEvmWallet} disabled={isLoading} className="text-xs text-gray-400 hover:text-orange-500 uppercase tracking-wider transition-none">
                Connect ETH
              </button>
            )}
            
            {user.isConnected ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 border border-gray-800 px-3 py-1 font-mono uppercase">
                  STX: {user.address?.slice(0, 6)}...
                </span>
                <button onClick={disconnectWallet} className="text-gray-400 hover:text-white transition-none">×</button>
              </div>
            ) : (
              <button onClick={connectWallet} className="btn-primary text-xs py-2">
                Connect Stacks
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-6">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl text-white mb-2 uppercase tracking-widest">Create & Manage</h2>
          <p className="text-gray-400 mb-8 font-mono text-sm">Bridge USDC to USDCx and create programmable payment streams.</p>

          {error && (
            <div className="mb-6 p-4 border-2 border-red-500 bg-black text-red-500 font-mono text-xs">
              ERROR: {error}
            </div>
          )}
          {success && (
            <div className="mb-6 p-4 border-2 border-green-500 bg-black text-green-500 font-mono text-xs">
              SUCCESS: {success}
            </div>
          )}

          <div className="flex gap-4 mb-8 border-b-2 border-gray-800">
            <button
              onClick={() => setActiveTab('bridge')}
              className={`pb-3 px-1 text-sm font-medium transition-none uppercase tracking-wider ${
                activeTab === 'bridge'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Bridge USDC
            </button>
            <button
              onClick={() => setActiveTab('create')}
              className={`pb-3 px-1 text-sm font-medium transition-none uppercase tracking-wider ${
                activeTab === 'create'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Create SafeFlow
            </button>
            <button
              onClick={() => setActiveTab('manage')}
              className={`pb-3 px-1 text-sm font-medium transition-none uppercase tracking-wider ${
                activeTab === 'manage'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Manage ({mySafeFlows.length})
            </button>
          </div>

          {activeTab === 'bridge' && (
            <div className="space-y-6">
              {/* USDCx Balance Display */}
              {user.isConnected && (
                <div className="card bg-black border-2 border-orange-500">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Your USDCx Balance on Stacks</p>
                      <p className="text-2xl font-mono text-orange-500">${formatUSDCx(usdcxBalance)} USDCx</p>
                    </div>
                    <button
                      onClick={fetchUsdcxBalance}
                      className="text-orange-500 hover:text-white p-2 transition-none"
                      title="Refresh balance"
                    >
                      REFRESH
                    </button>
                  </div>
                </div>
              )}

              {/* Pending Bridge Transactions */}
              {pendingBridgeTxs.filter(tx => tx.status === 'pending').length > 0 && (
                <div className="card border-2 border-yellow-500 bg-black">
                  <h4 className="font-bold text-yellow-500 mb-3 flex items-center gap-2 uppercase text-sm tracking-wider">
                    <span className="animate-pulse">[WAITING]</span> Pending Bridge
                  </h4>
                  <div className="space-y-2">
                    {pendingBridgeTxs.filter(tx => tx.status === 'pending').map(tx => {
                      const elapsed = Math.floor((Date.now() - tx.timestamp) / 60000);
                      return (
                        <div key={tx.txHash} className="flex items-center justify-between text-xs p-2 border border-gray-800 font-mono">
                          <div>
                            <p className="text-white">{tx.amount} USDC</p>
                            <p className="text-gray-500">{elapsed} min ago</p>
                          </div>
                          <div className="text-right">
                            <a
                              href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange-500 hover:text-white underline"
                            >
                              ETHERSCAN ↗
                            </a>
                            <p className="text-yellow-600 mt-1">~{Math.max(0, 15 - elapsed)}-{Math.max(0, 30 - elapsed)} min remaining</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-3 font-mono">
                    ℹ Your USDCx balance will update automatically when the bridge completes.
                  </p>
                </div>
              )}

              {/* Recently Completed Bridges */}
              {pendingBridgeTxs.filter(tx => tx.status === 'completed').length > 0 && (
                <div className="card border-2 border-green-500 bg-black">
                  <h4 className="font-bold text-green-500 mb-2 flex items-center gap-2 uppercase text-sm tracking-wider">
                    [DONE] Recently Completed
                  </h4>
                  <div className="space-y-1">
                    {pendingBridgeTxs.filter(tx => tx.status === 'completed').slice(0, 3).map(tx => (
                      <div key={tx.txHash} className="flex justify-between text-xs font-mono">
                        <span className="text-green-500">{tx.amount} USDC → USDCx</span>
                        <a
                          href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-500 underline"
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
                  <p className="text-xs text-gray-500 mb-1 uppercase">Ethereum Sepolia</p>
                  {evmWallet.isConnected ? (
                    <>
                      <p className="font-mono text-sm text-white mb-1">{evmWallet.address?.slice(0, 12)}...</p>
                      <p className="text-orange-500 font-mono">{parseFloat(evmWallet.usdcBalance).toFixed(2)} USDC</p>
                    </>
                  ) : (
                    <button onClick={connectEvmWallet} className="btn-secondary w-full mt-2 text-xs py-2">
                      CONNECT
                    </button>
                  )}
                </div>
                <div className="card">
                  <p className="text-xs text-gray-500 mb-1 uppercase">Stacks Testnet</p>
                  {user.isConnected ? (
                    <p className="font-mono text-sm text-white">{user.address?.slice(0, 12)}...</p>
                  ) : (
                    <button onClick={connectWallet} className="btn-primary w-full mt-2 text-xs py-2">
                      CONNECT
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Amount (USDC)</label>
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
                {isLoading ? 'PROCESSING...' : 'BRIDGE TO STACKS (USDCx)'}
              </button>
              
              <p className="text-xs text-gray-600 text-center font-mono">
                USDC will be converted to USDCx on Stacks via Circle xReserve. Takes ~10-30 minutes.
              </p>
            </div>
          )}

          {activeTab === 'create' && (
            <div className="space-y-6">
              {!user.isConnected && (
                <div className="p-4 border-2 border-yellow-500 bg-black text-yellow-500 font-mono text-xs">
                  Connect your Stacks wallet to create a SafeFlow.
                </div>
              )}

              {user.isConnected && (
                <div className="p-4 border-2 border-orange-500 bg-black">
                  <div className="flex justify-between items-center">
                    <span className="text-xs uppercase text-gray-400">Your USDCx Balance:</span>
                    <span className="font-mono text-orange-500 text-lg">${formatUSDCx(usdcxBalance)} USDCx</span>
                  </div>
                  {usdcxBalance === 0n && (
                    <p className="text-xs text-orange-700 mt-2 font-mono">
                      ⚠ You need USDCx to create a SafeFlow. <button onClick={() => setActiveTab('bridge')} className="underline font-bold uppercase">Bridge USDC first</button>
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Title *</label>
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
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Monthly payment for frontend development work..."
                  className="input min-h-[80px]"
                  maxLength={200}
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Recipient Address *</label>
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
                  <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Total Amount (USDCx) *</label>
                  <input
                    type="text"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="1000.00"
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Drip Per Period *</label>
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
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Drip Interval</label>
                <div className="flex gap-4">
                  <button
                    onClick={() => setDripInterval('daily')}
                    className={`flex-1 py-2 border-2 uppercase tracking-wide transition-none text-sm ${
                      dripInterval === 'daily'
                        ? 'border-orange-500 text-orange-500 bg-black'
                        : 'border-gray-800 text-gray-500 hover:border-gray-600'
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    onClick={() => setDripInterval('monthly')}
                    className={`flex-1 py-2 border-2 uppercase tracking-wide transition-none text-sm ${
                      dripInterval === 'monthly'
                        ? 'border-orange-500 text-orange-500 bg-black'
                        : 'border-gray-800 text-gray-500 hover:border-gray-600'
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
                {isLoading ? 'PROCESSING...' : 'CREATE SAFEFLOW'}
              </button>
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="space-y-6">
              {!user.isConnected ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 mb-4 uppercase text-sm">Connect your wallet to see your SafeFlows</p>
                  <button onClick={connectWallet} className="btn-primary">
                    Connect Wallet
                  </button>
                </div>
              ) : mySafeFlows.length === 0 ? (
                <div className="text-center py-12">
                  <h3 className="text-lg text-white mb-2 uppercase tracking-wide">No SafeFlows Yet</h3>
                  <p className="text-gray-500 mb-4 text-sm">Create your first SafeFlow to start streaming payments.</p>
                  <button onClick={() => setActiveTab('create')} className="btn-primary">
                    Create SafeFlow
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {mySafeFlows.map((sf) => (
                    <div
                      key={sf.id}
                      className={`card cursor-pointer transition-none ${
                        selectedSafeFlow?.id === sf.id ? 'border-orange-500' : 'hover:border-gray-600'
                      }`}
                      onClick={() => setSelectedSafeFlow(selectedSafeFlow?.id === sf.id ? null : sf)}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-white uppercase tracking-wider">{sf.title}</h4>
                        <span className={`px-2 py-0 border-2 text-xs uppercase tracking-widest font-bold ${getStatusColor(sf.status)}`}>
                          {getStatusText(sf.status)}
                        </span>
                      </div>
                      
                      <p className="text-xs text-gray-500 mb-3 truncate font-mono">
                        TO: {sf.recipient.slice(0, 12)}...{sf.recipient.slice(-8)}
                      </p>
                      
                      <div className="flex justify-between text-xs mb-1 uppercase tracking-wider">
                        <span className="text-gray-500">Progress</span>
                        <span className="text-white">
                          ${formatUSDCx(sf.claimedAmount)} / ${formatUSDCx(sf.totalAmount)}
                        </span>
                      </div>
                      
                      <div className="mt-2 h-4 bg-gray-900 border border-gray-700 p-0.5">
                        <div 
                          className="h-full bg-orange-500"
                          style={{ width: `${Number(sf.claimedAmount * 100n / sf.totalAmount)}%` }}
                        />
                      </div>

                      {selectedSafeFlow?.id === sf.id && (
                        <div className="mt-4 pt-4 border-t border-gray-800 border-dashed">
                          {sf.description && (
                            <p className="text-sm text-gray-400 mb-4 font-mono">{sf.description}</p>
                          )}
                          
                          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                            <div>
                              <p className="text-gray-500 text-xs uppercase">Remaining</p>
                              <p className="font-mono text-white">${formatUSDCx(sf.totalAmount - sf.claimedAmount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 text-xs uppercase">Rate</p>
                              <p className="font-mono text-white uppercase">{sf.dripInterval}</p>
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            {sf.status === 1 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); freezeSafeFlow(sf.id); }}
                                disabled={isLoading}
                                className="flex-1 py-2 px-4 border-2 border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-black transition-none uppercase tracking-wider text-xs font-bold"
                              >
                                Freeze
                              </button>
                            )}
                            {sf.status === 2 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); unfreezeSafeFlow(sf.id); }}
                                disabled={isLoading}
                                className="flex-1 py-2 px-4 border-2 border-green-500 text-green-500 hover:bg-green-500 hover:text-black transition-none uppercase tracking-wider text-xs font-bold"
                              >
                                Resume
                              </button>
                            )}
                            {sf.status !== 3 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); cancelSafeFlow(sf.id); }}
                                disabled={isLoading}
                                className="flex-1 py-2 px-4 border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-black transition-none uppercase tracking-wider text-xs font-bold"
                              >
                                Cancel
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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-black border-2 border-white p-6 max-w-md w-full mx-4 shadow-none">
            <div className="text-center">
              {bridgingModal.status === 'approving' && (
                <>
                  <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent animate-spin mx-auto mb-4" />
                  <h3 className="text-xl text-white uppercase tracking-widest mb-2">Approving USDC</h3>
                </>
              )}
              
              {bridgingModal.status === 'bridging' && (
                <>
                  <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent animate-spin mx-auto mb-4" />
                  <h3 className="text-xl text-white uppercase tracking-widest mb-2">Bridging USDC</h3>
                </>
              )}
              
              {bridgingModal.status === 'pending' && (
                <>
                  <div className="w-16 h-16 border-2 border-orange-500 flex items-center justify-center mx-auto mb-4">
                    <span className="text-xl font-mono text-orange-500">BRIDGE</span>
                  </div>
                  <h3 className="text-xl text-white uppercase tracking-widest mb-2">Bridge in Progress!</h3>
                </>
              )}
              
              {bridgingModal.status === 'success' && (
                <>
                  <div className="w-16 h-16 border-2 border-green-500 flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl text-green-500 font-bold">OK</span>
                  </div>
                  <h3 className="text-xl text-green-500 uppercase tracking-widest mb-2">Bridge Complete!</h3>
                </>
              )}
              
              {bridgingModal.status === 'error' && (
                <>
                  <div className="w-16 h-16 border-2 border-red-500 flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl text-red-500 font-bold">FAIL</span>
                  </div>
                  <h3 className="text-xl text-red-500 uppercase tracking-widest mb-2">Bridge Failed</h3>
                </>
              )}
              
              <p className="text-gray-400 mb-4 font-mono text-sm">{bridgingModal.message}</p>
              
              {bridgingModal.txHash && (
                <a 
                  href={`https://sepolia.etherscan.io/tx/${bridgingModal.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-500 hover:text-white underline text-sm block mb-4 font-mono"
                >
                  VIEW ON ETHERSCAN ↗
                </a>
              )}
              
              {bridgingModal.status === 'pending' && (
                <div className="bg-black border border-orange-500 p-4 mb-4 text-left">
                  <p className="text-sm text-orange-500 mb-2 font-mono">
                    <strong>ESTIMATED TIME:</strong> 15-30 minutes
                  </p>
                  <p className="text-sm text-orange-500 mb-2 font-mono">
                    <strong>WHAT HAPPENS NEXT:</strong>
                  </p>
                  <ol className="text-sm text-orange-500 list-decimal list-inside space-y-1 font-mono">
                    <li>Circle xReserve processes your deposit</li>
                    <li>Stacks attestation service verifies the transfer</li>
                    <li>USDCx is minted to your Stacks wallet</li>
                  </ol>
                  <p className="text-sm text-white mt-3 font-mono">
                    ✓ Stay on this page - your balance will update automatically!
                  </p>
                </div>
              )}
              
              <button
                onClick={() => setBridgingModal(prev => ({ ...prev, isOpen: false }))}
                className={`px-6 py-2 font-bold uppercase tracking-wider transition-none border-2 ${
                  bridgingModal.status === 'error' 
                    ? 'border-red-500 text-red-500 hover:bg-red-500 hover:text-black' 
                    : 'border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-black'
                }`}
              >
                {bridgingModal.status === 'pending' ? 'GOT IT' : 'CLOSE'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t-2 border-gray-800 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-xs text-gray-600 uppercase tracking-widest">
          SafeFlow — Programmable USDCx Payment Streams on Stacks
        </div>
      </footer>
    </div>
  );
}
