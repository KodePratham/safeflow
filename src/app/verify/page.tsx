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
  PostConditionMode,
  cvToValue,
  callReadOnlyFunction,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
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
const BLOCKS_PER_DAY = 144;
const BLOCKS_PER_MONTH = 4320;

interface SafeFlowInfo {
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
  claimable: bigint;
  remaining: bigint;
  progress: number;
}

function formatUSDCx(microAmount: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const whole = microAmount / divisor;
  const fraction = microAmount % divisor;
  if (fraction === 0n) return whole.toLocaleString();
  const fractionStr = fraction.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fractionStr}`;
}

// Helper to extract primitive value from cvToValue nested structures
// cvToValue can return {value: X} or just X, or {type: ..., value: X}
function extractValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && 'value' in (val as Record<string, unknown>)) {
    return extractValue((val as Record<string, unknown>).value);
  }
  return val;
}

function isValidStacksAddress(address: string): boolean {
  if (!address || address.length < 39 || address.length > 41) return false;
  const prefix = address.toUpperCase().substring(0, 2);
  return prefix === 'ST' || prefix === 'SP';
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

export default function VerifyPage() {
  const [user, setUser] = useState<{ address: string | null; isConnected: boolean }>({
    address: null,
    isConnected: false,
  });

  const [searchAddress, setSearchAddress] = useState('');
  const [searchId, setSearchId] = useState(''); // New: search by SafeFlow ID
  const [safeflows, setSafeflows] = useState<SafeFlowInfo[]>([]);
  const [searchedAddress, setSearchedAddress] = useState('');
  const [selectedSafeFlow, setSelectedSafeFlow] = useState<SafeFlowInfo | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number>(0);

  useEffect(() => {
    if (userSession.isUserSignedIn()) {
      const userData = userSession.loadUserData();
      setUser({ address: userData.profile.stxAddress.testnet, isConnected: true });
      setSearchAddress(userData.profile.stxAddress.testnet);
    }
  }, []);

  useEffect(() => {
    const fetchBlockHeight = async () => {
      try {
        const response = await fetch('https://api.testnet.hiro.so/v2/info');
        const data = await response.json();
        setCurrentBlock(data.burn_block_height);
      } catch (err) {
        console.error('Failed to fetch block height:', err);
      }
    };
    fetchBlockHeight();
    const interval = setInterval(fetchBlockHeight, 60000);
    return () => clearInterval(interval);
  }, []);

  const connectWallet = useCallback(() => {
    showConnect({
      appDetails: { name: 'SafeFlow', icon: '/logo.png' },
      redirectTo: '/verify',
      onFinish: () => {
        const userData = userSession.loadUserData();
        const address = userData.profile.stxAddress.testnet;
        setUser({ address, isConnected: true });
        setSearchAddress(address);
      },
      userSession,
    });
  }, []);

  const disconnectWallet = useCallback(() => {
    userSession.signUserOut('/verify');
    setUser({ address: null, isConnected: false });
  }, []);

  // Search SafeFlow by ID directly
  const searchSafeFlowById = async () => {
    if (!searchId || isNaN(Number(searchId))) {
      setError('Please enter a valid SafeFlow ID (number)');
      return;
    }

    setIsSearching(true);
    setError(null);
    setSafeflows([]);
    setSelectedSafeFlow(null);

    try {
      const sfId = Number(searchId);
      console.log('Searching for SafeFlow ID:', sfId);
      console.log('Contract:', SAFEFLOW_CONTRACT.address + '.' + SAFEFLOW_CONTRACT.name);

      const sfResult = await callReadOnlyFunction({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'get-safeflow',
        functionArgs: [uintCV(sfId)],
        senderAddress: user.address || SAFEFLOW_CONTRACT.address,
      });

      const sfRaw = cvToValue(sfResult);
      console.log('SafeFlow result:', sfRaw);

      if (!sfRaw) {
        setError(`SafeFlow #${sfId} not found`);
        setIsSearching(false);
        return;
      }
      
      // cvToValue returns {type: '(tuple ...)', value: {...}} for optionals
      // Unwrap to get the actual tuple data
      const sf = (typeof sfRaw === 'object' && sfRaw !== null && 'value' in sfRaw && typeof (sfRaw as Record<string, unknown>).value === 'object')
        ? (sfRaw as Record<string, unknown>).value as Record<string, unknown>
        : sfRaw as Record<string, unknown>;
      console.log('Unwrapped SafeFlow data:', sf);

      const claimableResult = await callReadOnlyFunction({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'get-claimable-amount',
        functionArgs: [uintCV(sfId)],
        senderAddress: user.address || SAFEFLOW_CONTRACT.address,
      });

      const claimableValue = cvToValue(claimableResult);

      const progressResult = await callReadOnlyFunction({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'get-safeflow-progress',
        functionArgs: [uintCV(sfId)],
        senderAddress: user.address || SAFEFLOW_CONTRACT.address,
      });

      const progressValue = cvToValue(progressResult);

      // Handle both kebab-case and camelCase field names from cvToValue
      // Use extractValue to unwrap nested {value: X} structures
      const totalAmountRaw = sf['total-amount'] ?? sf.totalAmount ?? sf.total_amount;
      const claimedAmountRaw = sf['claimed-amount'] ?? sf.claimedAmount ?? sf.claimed_amount;
      const dripRateRaw = sf['drip-rate'] ?? sf.dripRate ?? sf.drip_rate;
      const dripIntervalRaw = sf['drip-interval'] ?? sf.dripInterval ?? sf.drip_interval;
      const startBlockRaw = sf['start-block'] ?? sf.startBlock ?? sf.start_block;
      const lastClaimBlockRaw = sf['last-claim-block'] ?? sf.lastClaimBlock ?? sf.last_claim_block;
      
      const totalAmount = extractValue(totalAmountRaw);
      const claimedAmount = extractValue(claimedAmountRaw);
      const dripRate = extractValue(dripRateRaw);
      const dripInterval = extractValue(dripIntervalRaw);
      const startBlock = extractValue(startBlockRaw);
      const lastClaimBlock = extractValue(lastClaimBlockRaw);
      const status = extractValue(sf.status);
      const claimable = extractValue(claimableValue);
      const progress = extractValue(progressValue);

      const foundSafeflow: SafeFlowInfo = {
        id: sfId,
        admin: String(extractValue(sf.admin)),
        recipient: String(extractValue(sf.recipient)),
        title: String(extractValue(sf.title) || ''),
        description: String(extractValue(sf.description) || ''),
        totalAmount: BigInt((totalAmount as number | bigint) || 0),
        claimedAmount: BigInt((claimedAmount as number | bigint) || 0),
        dripRate: BigInt((dripRate as number | bigint) || 0),
        dripInterval: String(dripInterval || 'daily'),
        startBlock: Number(startBlock || 0),
        lastClaimBlock: Number(lastClaimBlock || 0),
        status: Number(status || 1),
        claimable: BigInt((claimable as number | bigint) || 0),
        remaining: BigInt((totalAmount as number | bigint) || 0) - BigInt((claimedAmount as number | bigint) || 0),
        progress: Number(progress || 0),
      };

      setSafeflows([foundSafeflow]);
      setSearchedAddress(sf.recipient);
    } catch (err) {
      console.error('Search by ID error:', err);
      setError(`Failed to fetch SafeFlow #${searchId}. It may not exist.`);
    } finally {
      setIsSearching(false);
    }
  };

  const searchSafeFlows = async (address?: string) => {
    const targetAddress = address || searchAddress;
    
    if (!isValidStacksAddress(targetAddress)) {
      setError('Please enter a valid Stacks address');
      return;
    }

    setIsSearching(true);
    setError(null);
    setSafeflows([]);
    setSelectedSafeFlow(null);

    console.log('Searching SafeFlows for recipient:', targetAddress);
    console.log('Contract:', SAFEFLOW_CONTRACT.address + '.' + SAFEFLOW_CONTRACT.name);

    const foundSafeflows: SafeFlowInfo[] = [];
    const foundIds = new Set<number>();
    
    // Helper to add SafeFlow if not already present
    const addSafeFlow = async (sfId: number) => {
      if (foundIds.has(sfId)) return;
      
      try {
        const sfResult = await callReadOnlyFunction({
          network,
          contractAddress: SAFEFLOW_CONTRACT.address,
          contractName: SAFEFLOW_CONTRACT.name,
          functionName: 'get-safeflow',
          functionArgs: [uintCV(sfId)],
          senderAddress: targetAddress,
        });

        const sfRaw = cvToValue(sfResult);
        if (!sfRaw) return;
        
        // cvToValue returns {type: '(tuple ...)', value: {...}} for optionals
        // Unwrap to get the actual tuple data
        const sf = (typeof sfRaw === 'object' && sfRaw !== null && 'value' in sfRaw && typeof (sfRaw as Record<string, unknown>).value === 'object')
          ? (sfRaw as Record<string, unknown>).value as Record<string, unknown>
          : sfRaw as Record<string, unknown>;
        
        // Verify this SafeFlow is for our target recipient
        // Extract recipient value from potential nested structure
        const recipientVal = String(extractValue(sf.recipient));
        if (recipientVal !== targetAddress) return;

        const claimableResult = await callReadOnlyFunction({
          network,
          contractAddress: SAFEFLOW_CONTRACT.address,
          contractName: SAFEFLOW_CONTRACT.name,
          functionName: 'get-claimable-amount',
          functionArgs: [uintCV(sfId)],
          senderAddress: targetAddress,
        });

        const claimableValue = cvToValue(claimableResult);

        const progressResult = await callReadOnlyFunction({
          network,
          contractAddress: SAFEFLOW_CONTRACT.address,
          contractName: SAFEFLOW_CONTRACT.name,
          functionName: 'get-safeflow-progress',
          functionArgs: [uintCV(sfId)],
          senderAddress: targetAddress,
        });

        const progressValue = cvToValue(progressResult);

        // Handle both kebab-case and camelCase field names from cvToValue
        // Use extractValue to unwrap nested {value: X} structures
        const totalAmountRaw = sf['total-amount'] ?? sf.totalAmount ?? sf.total_amount;
        const claimedAmountRaw = sf['claimed-amount'] ?? sf.claimedAmount ?? sf.claimed_amount;
        const dripRateRaw = sf['drip-rate'] ?? sf.dripRate ?? sf.drip_rate;
        const dripIntervalRaw = sf['drip-interval'] ?? sf.dripInterval ?? sf.drip_interval;
        const startBlockRaw = sf['start-block'] ?? sf.startBlock ?? sf.start_block;
        const lastClaimBlockRaw = sf['last-claim-block'] ?? sf.lastClaimBlock ?? sf.last_claim_block;
        
        const totalAmount = extractValue(totalAmountRaw);
        const claimedAmount = extractValue(claimedAmountRaw);
        const dripRate = extractValue(dripRateRaw);
        const dripInterval = extractValue(dripIntervalRaw);
        const startBlock = extractValue(startBlockRaw);
        const lastClaimBlock = extractValue(lastClaimBlockRaw);
        const status = extractValue(sf.status);
        const claimable = extractValue(claimableValue);
        const progress = extractValue(progressValue);
        
        if (totalAmount === undefined || totalAmount === null) {
          console.error('Could not find totalAmount field in SafeFlow data');
          return;
        }
        
        foundIds.add(sfId);
        foundSafeflows.push({
          id: sfId,
          admin: String(extractValue(sf.admin)),
          recipient: recipientVal,
          title: String(extractValue(sf.title) || ''),
          description: String(extractValue(sf.description) || ''),
          totalAmount: BigInt(totalAmount as number | bigint),
          claimedAmount: BigInt((claimedAmount as number | bigint) || 0),
          dripRate: BigInt((dripRate as number | bigint) || 0),
          dripInterval: String(dripInterval || 'daily'),
          startBlock: Number(startBlock || 0),
          lastClaimBlock: Number(lastClaimBlock || 0),
          status: Number(status || 1),
          claimable: BigInt((claimable as number | bigint) || 0),
          remaining: BigInt(totalAmount as number | bigint) - BigInt((claimedAmount as number | bigint) || 0),
          progress: Number(progress || 0),
        });
      } catch (err) {
        console.error('Error fetching SafeFlow', sfId, ':', err);
      }
    };

    try {
      // Method 1: Search via Stacks API for transactions where this address was the recipient
      console.log('Searching via Stacks API...');
      try {
        const apiUrl = `https://api.testnet.hiro.so/extended/v1/address/${SAFEFLOW_CONTRACT.address}.${SAFEFLOW_CONTRACT.name}/transactions?limit=100`;
        const response = await fetch(apiUrl);
        if (response.ok) {
          const data = await response.json();
          const createTxs = data.results?.filter((tx: { tx_type: string; contract_call?: { function_name: string }; tx_status: string }) => 
            tx.tx_type === 'contract_call' &&
            tx.contract_call?.function_name === 'create-safeflow' &&
            tx.tx_status === 'success'
          ) || [];
          
          console.log('Found create-safeflow transactions via API:', createTxs.length);
          
          for (const tx of createTxs) {
            try {
              const result = tx.tx_result;
              if (result && result.repr) {
                // Check if this SafeFlow's recipient matches our target
                const recipientMatch = result.repr.match(/recipient '([^']+)/);
                if (recipientMatch && recipientMatch[1] === targetAddress) {
                  const idMatch = result.repr.match(/id u(\d+)/);
                  if (idMatch) {
                    const sfId = Number(idMatch[1]);
                    console.log('Found SafeFlow ID from API:', sfId);
                    await addSafeFlow(sfId);
                  }
                }
              }
            } catch (txErr) {
              console.error('Failed to parse tx result:', txErr);
            }
          }
        }
      } catch (apiErr) {
        console.error('API search failed:', apiErr);
      }

      // Method 2: Also try contract read-only calls
      try {
        const countResult = await callReadOnlyFunction({
          network,
          contractAddress: SAFEFLOW_CONTRACT.address,
          contractName: SAFEFLOW_CONTRACT.name,
          functionName: 'get-recipient-safeflow-count',
          functionArgs: [principalCV(targetAddress)],
          senderAddress: targetAddress,
        });

        const countValue = cvToValue(countResult);
        const count = Number(countValue);
        console.log('Recipient SafeFlow count from contract:', count);

        if (count > 0) {
          for (let i = 0; i < count; i++) {
            try {
              const idResult = await callReadOnlyFunction({
                network,
                contractAddress: SAFEFLOW_CONTRACT.address,
                contractName: SAFEFLOW_CONTRACT.name,
                functionName: 'get-recipient-safeflow-id',
                functionArgs: [principalCV(targetAddress), uintCV(i)],
                senderAddress: targetAddress,
              });

              const idData = cvToValue(idResult);
              console.log('Recipient SafeFlow ID at index', i, ':', idData);
              if (idData === null || idData === undefined) continue;

              // Parse the ID - cvToValue returns {type: ..., value: {id: ...}} structure
              let sfId: number = NaN;
              console.log('Raw idData type:', typeof idData, 'value:', JSON.stringify(idData));
              
              if (typeof idData === 'number') {
                sfId = idData;
              } else if (typeof idData === 'bigint') {
                sfId = Number(idData);
              } else if (typeof idData === 'object' && idData !== null) {
                // Structure is: {type: '(tuple (id uint))', value: {id: 0n or {value: 0n}}}
                if ('value' in idData && typeof idData.value === 'object' && idData.value !== null) {
                  const innerValue = idData.value;
                  if ('id' in innerValue) {
                    const idVal = innerValue.id;
                    if (typeof idVal === 'number') {
                      sfId = idVal;
                    } else if (typeof idVal === 'bigint') {
                      sfId = Number(idVal);
                    } else if (typeof idVal === 'object' && idVal !== null && 'value' in idVal) {
                      sfId = Number(idVal.value);
                    }
                  }
                } else if ('id' in idData) {
                  const idVal = idData.id;
                  if (typeof idVal === 'number') {
                    sfId = idVal;
                  } else if (typeof idVal === 'bigint') {
                    sfId = Number(idVal);
                  } else if (typeof idVal === 'object' && idVal !== null) {
                    sfId = Number(idVal.value ?? idVal);
                  }
                }
              }
              console.log('Parsed SafeFlow ID:', sfId);
              
              if (isNaN(sfId)) {
                console.error('Could not parse SafeFlow ID from:', idData);
                continue;
              }
              
              await addSafeFlow(sfId);
            } catch (indexErr) {
              console.error('Error fetching SafeFlow at index', i, ':', indexErr);
            }
          }
        }
      } catch (contractErr) {
        console.error('Contract call failed:', contractErr);
      }

      // Sort by ID descending (newest first)
      foundSafeflows.sort((a, b) => b.id - a.id);
      
      setSafeflows(foundSafeflows);
      setSearchedAddress(targetAddress);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to fetch SafeFlow information. Check console for details.');
    } finally {
      setIsSearching(false);
    }
  };

  const claimFromSafeFlow = async (id: number) => {
    if (!user.isConnected || !user.address) {
      setError('Please connect your wallet to claim');
      return;
    }

    const sf = safeflows.find(s => s.id === id);
    if (!sf) return;

    if (user.address !== sf.recipient) {
      setError('You can only claim SafeFlows where you are the recipient');
      return;
    }

    if (sf.claimable <= 0n) {
      setError('No funds available to claim');
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
        functionName: 'claim',
        functionArgs: [
          contractPrincipalCV(USDCX_CONTRACT.address, USDCX_CONTRACT.name),
          uintCV(id),
        ],
        postConditionMode: PostConditionMode.Allow,
        onFinish: (data) => {
          setSuccess(`Claim successful! TX: ${data.txId}`);
          searchSafeFlows(user.address!);
        },
        onCancel: () => setError('Transaction cancelled'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user.isConnected && user.address && searchAddress === user.address) {
      searchSafeFlows(user.address);
    }
  }, [user.address]);

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <header className="border-b-2 border-gray-800 py-4 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-xl text-orange-500 uppercase tracking-widest">SafeFlow</Link>
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-400 hover:text-orange-500 uppercase text-sm tracking-widest transition-none">Admin</Link>
            
            {currentBlock > 0 && (
              <span className="text-sm text-gray-500 hidden sm:block font-mono">
                BLOCK #{currentBlock.toLocaleString()}
              </span>
            )}
            
            {user.isConnected ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 border border-gray-800 px-3 py-1 font-mono uppercase">
                  {user.address?.slice(0, 6)}...{user.address?.slice(-4)}
                </span>
                <button onClick={disconnectWallet} className="text-gray-400 hover:text-white transition-none">×</button>
              </div>
            ) : (
              <button onClick={connectWallet} className="btn-primary text-xs py-2">
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-6">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl text-white mb-2 uppercase tracking-widest">View & Claim SafeFlows</h2>
          <p className="text-gray-400 mb-8 font-mono text-sm">Enter an address to view payment streams.</p>

          {error && (
            <div className="mb-6 p-4 border-2 border-red-500 bg-black text-red-500 font-mono text-sm">
              ERROR: {error}
            </div>
          )}
          {success && (
            <div className="mb-6 p-4 border-2 border-green-500 bg-black text-green-500 font-mono text-sm">
              SUCCESS: {success}
            </div>
          )}

          <div className="card mb-8">
            <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider">Search by Recipient Address</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                placeholder="ST..."
                className="input flex-1 font-mono text-sm uppercase"
              />
              <button
                onClick={() => searchSafeFlows()}
                disabled={isSearching}
                className="btn-primary px-6"
              >
                {isSearching ? '...' : 'SEARCH'}
              </button>
            </div>

            {user.isConnected && user.address !== searchAddress && (
              <button
                onClick={() => { setSearchAddress(user.address!); searchSafeFlows(user.address!); }}
                className="mt-3 text-xs text-orange-500 hover:text-white uppercase tracking-wider"
              >
                {'>'}Use connected wallet
              </button>
            )}

            <div className="border-t border-gray-800 my-4" />
            
            <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider">Or Search by SafeFlow ID</p>
            <div className="flex gap-2">
              <input
                type="number"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                placeholder="0"
                className="input flex-1 font-mono text-sm"
                min="0"
              />
              <button
                onClick={searchSafeFlowById}
                disabled={isSearching}
                className="btn-primary px-6"
              >
                {isSearching ? '...' : 'LOOKUP'}
              </button>
            </div>
          </div>

          {safeflows.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg text-white uppercase tracking-widest border-b border-gray-800 pb-2 mb-4">
                {safeflows.length} SafeFlow{safeflows.length > 1 ? 's' : ''} Found
              </h3>
              
              {safeflows.map((sf) => (
                <div
                  key={sf.id}
                  className={`card cursor-pointer transition-none hover:border-orange-500 ${
                    selectedSafeFlow?.id === sf.id ? 'border-orange-500' : 'border-gray-800'
                  }`}
                  onClick={() => setSelectedSafeFlow(selectedSafeFlow?.id === sf.id ? null : sf)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-white uppercase tracking-wider text-lg">{sf.title}</h4>
                    <span className={`px-2 py-0 border-2 text-xs uppercase tracking-widest font-bold ${getStatusColor(sf.status)}`}>
                      {getStatusText(sf.status)}
                    </span>
                  </div>

                  {sf.description && (
                    <p className="text-sm text-gray-400 mb-3 font-mono">{sf.description}</p>
                  )}

                  <div className="mb-4">
                    <div className="flex justify-between text-xs mb-1 uppercase tracking-wider">
                      <span className="text-gray-500">Progress</span>
                      <span className="text-white">{sf.progress}%</span>
                    </div>
                    <div className="h-4 bg-gray-900 border border-gray-700 p-0.5">
                      <div 
                        className="h-full bg-orange-500"
                        style={{ width: `${sf.progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="border border-gray-800 p-2">
                      <p className="text-gray-500 text-xs mb-1 uppercase">Total</p>
                      <p className="text-white font-mono bg-black">${formatUSDCx(sf.totalAmount)}</p>
                    </div>
                    <div className="border border-gray-800 p-2">
                      <p className="text-gray-500 text-xs mb-1 uppercase">Claimed</p>
                      <p className="text-green-500 font-mono bg-black">${formatUSDCx(sf.claimedAmount)}</p>
                    </div>
                  </div>

                  {selectedSafeFlow?.id === sf.id && (
                    <div className="pt-4 border-t border-gray-800 border-dashed">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="border border-gray-800 p-2">
                          <p className="text-gray-500 text-xs mb-1 uppercase">Remaining</p>
                          <p className="text-white font-mono">${formatUSDCx(sf.remaining)}</p>
                        </div>
                        <div className="border border-gray-800 p-2">
                          <p className="text-gray-500 text-xs mb-1 uppercase">Rate</p>
                          <p className="text-white font-mono">
                            ${formatUSDCx(sf.dripRate * BigInt(sf.dripInterval === 'daily' ? BLOCKS_PER_DAY : BLOCKS_PER_MONTH))}/{sf.dripInterval === 'daily' ? 'day' : 'mo'}
                          </p>
                        </div>
                      </div>

                      <div className="mb-4 p-2 border border-gray-800 text-sm">
                        <p className="text-gray-500 text-xs mb-1 uppercase">From</p>
                        <p className="font-mono text-gray-400 break-all text-xs">{sf.admin}</p>
                      </div>

                      <div className="border-t border-gray-800 pt-4">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <p className="text-gray-500 text-xs uppercase">Available to Claim</p>
                            <p className="text-2xl text-orange-500 font-mono tracking-tighter">${formatUSDCx(sf.claimable)}</p>
                          </div>
                        </div>

                        {sf.status === 1 && sf.claimable > 0n ? (
                          <>
                            {user.isConnected && user.address === sf.recipient ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); claimFromSafeFlow(sf.id); }}
                                disabled={isLoading}
                                className="btn-primary w-full"
                              >
                                {isLoading ? 'Processing...' : 'CLAIM USDCX'}
                              </button>
                            ) : (
                              <div className="text-center">
                                <p className="text-gray-500 mb-3 text-xs uppercase">Connect wallet to claim</p>
                                <button onClick={connectWallet} className="btn-primary">
                                  Connect Wallet
                                </button>
                              </div>
                            )}
                          </>
                        ) : sf.status === 2 ? (
                          <p className="text-center text-blue-500 py-2 text-sm uppercase">
                            SafeFlow Frozen
                          </p>
                        ) : sf.status === 3 ? (
                          <p className="text-center text-red-500 py-2 text-sm uppercase">
                            SafeFlow Cancelled
                          </p>
                        ) : (
                          <p className="text-center text-gray-500 py-2 text-sm uppercase">
                            No funds available yet
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-4 border-t border-gray-800 grid grid-cols-3 gap-4 text-xs font-mono text-gray-500">
                        <div>
                          <p className="uppercase text-gray-600 font-sans text-[10px]">Start Block</p>
                          <p>{sf.startBlock.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="uppercase text-gray-600 font-sans text-[10px]">Last Claim</p>
                          <p>{sf.lastClaimBlock.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="uppercase text-gray-600 font-sans text-[10px]">Current</p>
                          <p className="text-orange-500">{currentBlock.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {searchedAddress && safeflows.length === 0 && !isSearching && !error && (
            <div className="card text-center py-12">
              <h3 className="text-lg text-white mb-2 uppercase tracking-wider">No SafeFlows Found</h3>
              <p className="text-gray-500 text-sm">No payment streams for this address.</p>
              <p className="text-gray-600 text-xs mt-2 font-mono uppercase">{searchedAddress}</p>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t-2 border-gray-800 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-xs text-gray-600 uppercase tracking-widest">
          SafeFlow — Programmable USDCx Payment Streams on Stacks
        </div>
      </footer>
    </div>
  );
}
