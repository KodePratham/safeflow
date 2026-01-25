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
    case 1: return 'bg-green-50 text-green-700 border-green-200';
    case 2: return 'bg-blue-50 text-blue-700 border-blue-200';
    case 3: return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

export default function VerifyPage() {
  const [user, setUser] = useState<{ address: string | null; isConnected: boolean }>({
    address: null,
    isConnected: false,
  });

  const [searchAddress, setSearchAddress] = useState('');
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

    try {
      // Get count of SafeFlows for this recipient
      const countResult = await callReadOnlyFunction({
        network,
        contractAddress: SAFEFLOW_CONTRACT.address,
        contractName: SAFEFLOW_CONTRACT.name,
        functionName: 'get-recipient-safeflow-count',
        functionArgs: [principalCV(targetAddress)],
        senderAddress: targetAddress,
      });

      const count = Number(cvToValue(countResult));

      if (count === 0) {
        // This is not an error - just no SafeFlows yet
        setSearchedAddress(targetAddress);
        setIsSearching(false);
        return;
      }

      const foundSafeflows: SafeFlowInfo[] = [];

      for (let i = 0; i < count; i++) {
        const idResult = await callReadOnlyFunction({
          network,
          contractAddress: SAFEFLOW_CONTRACT.address,
          contractName: SAFEFLOW_CONTRACT.name,
          functionName: 'get-recipient-safeflow-id',
          functionArgs: [principalCV(targetAddress), uintCV(i)],
          senderAddress: targetAddress,
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
          senderAddress: targetAddress,
        });

        const sf = cvToValue(sfResult);
        if (!sf) continue;

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

        foundSafeflows.push({
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
          claimable: BigInt(claimableValue.value || claimableValue || 0),
          remaining: BigInt(sf['total-amount']) - BigInt(sf['claimed-amount']),
          progress: Number(progressValue.value || progressValue || 0),
        });
      }

      setSafeflows(foundSafeflows);
      setSearchedAddress(targetAddress);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to fetch SafeFlow information.');
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
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-200 py-4 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-xl font-bold text-orange-500">SafeFlow</Link>
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-600 hover:text-orange-500">Admin</Link>
            
            {currentBlock > 0 && (
              <span className="text-sm text-gray-500 hidden sm:block">
                Block {currentBlock.toLocaleString()}
              </span>
            )}
            
            {user.isConnected ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 border border-gray-200 px-3 py-1 rounded">
                  {user.address?.slice(0, 6)}...{user.address?.slice(-4)}
                </span>
                <button onClick={disconnectWallet} className="text-gray-400 hover:text-gray-600">×</button>
              </div>
            ) : (
              <button onClick={connectWallet} className="btn-primary text-sm py-2">
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-6">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">View & Claim SafeFlows</h2>
          <p className="text-gray-600 mb-8">Enter an address to view payment streams and claim available funds.</p>

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

          <div className="card mb-8">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                placeholder="ST..."
                className="input flex-1 font-mono text-sm"
              />
              <button
                onClick={() => searchSafeFlows()}
                disabled={isSearching}
                className="btn-primary px-6"
              >
                {isSearching ? '...' : 'Search'}
              </button>
            </div>

            {user.isConnected && user.address !== searchAddress && (
              <button
                onClick={() => { setSearchAddress(user.address!); searchSafeFlows(user.address!); }}
                className="mt-3 text-sm text-orange-500 hover:text-orange-600"
              >
                Use connected wallet
              </button>
            )}
          </div>

          {safeflows.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-gray-900">
                {safeflows.length} SafeFlow{safeflows.length > 1 ? 's' : ''} Found
              </h3>
              
              {safeflows.map((sf) => (
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

                  {sf.description && (
                    <p className="text-sm text-gray-600 mb-3">{sf.description}</p>
                  )}

                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-500">Progress</span>
                      <span className="text-gray-900">{sf.progress}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-orange-500 transition-all duration-500"
                        style={{ width: `${sf.progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-gray-500 text-xs mb-1">Total</p>
                      <p className="text-gray-900 font-bold">${formatUSDCx(sf.totalAmount)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-gray-500 text-xs mb-1">Claimed</p>
                      <p className="text-green-600 font-bold">${formatUSDCx(sf.claimedAmount)}</p>
                    </div>
                  </div>

                  {selectedSafeFlow?.id === sf.id && (
                    <div className="pt-4 border-t border-gray-100">
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-gray-500 text-xs mb-1">Remaining</p>
                          <p className="text-gray-900 font-bold">${formatUSDCx(sf.remaining)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-gray-500 text-xs mb-1">Rate</p>
                          <p className="text-gray-900 font-bold">
                            ${formatUSDCx(sf.dripRate * BigInt(sf.dripInterval === 'daily' ? BLOCKS_PER_DAY : BLOCKS_PER_MONTH))}/{sf.dripInterval === 'daily' ? 'day' : 'mo'}
                          </p>
                        </div>
                      </div>

                      <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                        <p className="text-gray-400 text-xs mb-1">From</p>
                        <p className="font-mono text-gray-600 break-all">{sf.admin}</p>
                      </div>

                      <div className="border-t border-gray-100 pt-4">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <p className="text-gray-500 text-sm">Available to Claim</p>
                            <p className="text-2xl font-bold text-orange-500">${formatUSDCx(sf.claimable)}</p>
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
                                {isLoading ? 'Processing...' : 'Claim USDCx'}
                              </button>
                            ) : (
                              <div className="text-center">
                                <p className="text-gray-500 mb-3 text-sm">Connect wallet to claim</p>
                                <button onClick={connectWallet} className="btn-primary">
                                  Connect Wallet
                                </button>
                              </div>
                            )}
                          </>
                        ) : sf.status === 2 ? (
                          <p className="text-center text-blue-600 py-2">
                            This SafeFlow is frozen. Contact the admin to resume.
                          </p>
                        ) : sf.status === 3 ? (
                          <p className="text-center text-red-600 py-2">
                            This SafeFlow has been cancelled.
                          </p>
                        ) : (
                          <p className="text-center text-gray-500 py-2">
                            No funds available yet. Check back later.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4 text-xs">
                        <div>
                          <p className="text-gray-400">Start Block</p>
                          <p className="text-gray-600 font-mono">{sf.startBlock.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Last Claim</p>
                          <p className="text-gray-600 font-mono">{sf.lastClaimBlock.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Current</p>
                          <p className="text-orange-500 font-mono">{currentBlock.toLocaleString()}</p>
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
              <h3 className="text-lg font-bold text-gray-900 mb-2">No SafeFlows Found</h3>
              <p className="text-gray-500">No payment streams for this address.</p>
              <p className="text-gray-400 text-sm mt-2 font-mono">{searchedAddress}</p>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-gray-200 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          SafeFlow — Programmable USDCx Payment Streams on Stacks
        </div>
      </footer>
    </div>
  );
}
