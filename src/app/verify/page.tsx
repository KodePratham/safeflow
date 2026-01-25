'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AppConfig,
  UserSession,
  showConnect,
  openContractCall,
} from '@stacks/connect';
import {
  principalCV,
  contractPrincipalCV,
  PostConditionMode,
  cvToValue,
  callReadOnlyFunction,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
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
const BLOCKS_PER_DAY = 144;
const BLOCKS_PER_MONTH = 4320;

interface PaymentInfo {
  totalAmount: bigint;
  claimedAmount: bigint;
  dripRate: bigint;
  dripInterval: string;
  startBlock: number;
  lastClaimBlock: number;
  isActive: boolean;
  description: string;
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

export default function VerifyPage() {
  const [user, setUser] = useState<{ address: string | null; isConnected: boolean }>({
    address: null,
    isConnected: false,
  });

  const [searchAddress, setSearchAddress] = useState('');
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [searchedAddress, setSearchedAddress] = useState('');

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

  const searchPayment = async (address?: string) => {
    const targetAddress = address || searchAddress;
    
    if (!isValidStacksAddress(targetAddress)) {
      setError('Please enter a valid Stacks address');
      return;
    }

    setIsSearching(true);
    setError(null);
    setPaymentInfo(null);

    try {
      const paymentResult = await callReadOnlyFunction({
        network,
        contractAddress: DEVPAYMENTS_CONTRACT.address,
        contractName: DEVPAYMENTS_CONTRACT.name,
        functionName: 'get-payment',
        functionArgs: [principalCV(targetAddress)],
        senderAddress: targetAddress,
      });

      const paymentValue = cvToValue(paymentResult);

      if (!paymentValue) {
        setError('No payment found for this address.');
        setSearchedAddress(targetAddress);
        return;
      }

      const claimableResult = await callReadOnlyFunction({
        network,
        contractAddress: DEVPAYMENTS_CONTRACT.address,
        contractName: DEVPAYMENTS_CONTRACT.name,
        functionName: 'get-claimable-amount',
        functionArgs: [principalCV(targetAddress)],
        senderAddress: targetAddress,
      });

      const claimableValue = cvToValue(claimableResult);

      const progressResult = await callReadOnlyFunction({
        network,
        contractAddress: DEVPAYMENTS_CONTRACT.address,
        contractName: DEVPAYMENTS_CONTRACT.name,
        functionName: 'get-payment-progress',
        functionArgs: [principalCV(targetAddress)],
        senderAddress: targetAddress,
      });

      const progressValue = cvToValue(progressResult);

      const remainingResult = await callReadOnlyFunction({
        network,
        contractAddress: DEVPAYMENTS_CONTRACT.address,
        contractName: DEVPAYMENTS_CONTRACT.name,
        functionName: 'get-remaining-amount',
        functionArgs: [principalCV(targetAddress)],
        senderAddress: targetAddress,
      });

      const remainingValue = cvToValue(remainingResult);

      setPaymentInfo({
        totalAmount: BigInt(paymentValue['total-amount']),
        claimedAmount: BigInt(paymentValue['claimed-amount']),
        dripRate: BigInt(paymentValue['drip-rate']),
        dripInterval: paymentValue['drip-interval'],
        startBlock: Number(paymentValue['start-block']),
        lastClaimBlock: Number(paymentValue['last-claim-block']),
        isActive: paymentValue['is-active'],
        description: paymentValue['description'],
        claimable: BigInt(claimableValue.value || claimableValue || 0),
        remaining: BigInt(remainingValue.value || remainingValue || 0),
        progress: Number(progressValue.value || progressValue || 0),
      });

      setSearchedAddress(targetAddress);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to fetch payment information.');
    } finally {
      setIsSearching(false);
    }
  };

  const claimPayment = async () => {
    if (!user.isConnected || !user.address) {
      setError('Please connect your wallet to claim');
      return;
    }

    if (user.address !== searchedAddress) {
      setError('You can only claim payments for your connected wallet');
      return;
    }

    if (!paymentInfo || paymentInfo.claimable <= 0n) {
      setError('No funds available to claim');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await openContractCall({
        network,
        contractAddress: DEVPAYMENTS_CONTRACT.address,
        contractName: DEVPAYMENTS_CONTRACT.name,
        functionName: 'claim',
        functionArgs: [contractPrincipalCV(USDCX_CONTRACT.address, USDCX_CONTRACT.name)],
        postConditionMode: PostConditionMode.Allow,
        onFinish: (data) => {
          setSuccess(`Claim successful. TX: ${data.txId}`);
          searchPayment(user.address!);
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
      searchPayment(user.address);
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
                <button onClick={disconnectWallet} className="text-gray-400 hover:text-gray-600">x</button>
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
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Verify Payment</h2>
          <p className="text-gray-600 mb-8">Enter an address to check payment status and claim funds.</p>

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
                onClick={() => searchPayment()}
                disabled={isSearching}
                className="btn-primary px-6"
              >
                {isSearching ? '...' : 'Search'}
              </button>
            </div>

            {user.isConnected && user.address !== searchAddress && (
              <button
                onClick={() => { setSearchAddress(user.address!); searchPayment(user.address!); }}
                className="mt-3 text-sm text-orange-500 hover:text-orange-600"
              >
                Use connected wallet
              </button>
            )}
          </div>

          {paymentInfo && (
            <div className="card">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Payment Details</h3>
                  <p className="text-gray-500 text-sm font-mono">
                    {searchedAddress.slice(0, 10)}...{searchedAddress.slice(-8)}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded text-sm ${
                  paymentInfo.isActive 
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}>
                  {paymentInfo.isActive ? 'Active' : 'Paused'}
                </span>
              </div>

              {paymentInfo.description && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">Description</p>
                  <p className="text-gray-900">{paymentInfo.description}</p>
                </div>
              )}

              <div className="mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-500">Progress</span>
                  <span className="text-gray-900">{paymentInfo.progress}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-orange-500 transition-all duration-500"
                    style={{ width: `${paymentInfo.progress}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-gray-500 text-xs mb-1">Total</p>
                  <p className="text-gray-900 font-bold">${formatUSDCx(paymentInfo.totalAmount)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-gray-500 text-xs mb-1">Claimed</p>
                  <p className="text-green-600 font-bold">${formatUSDCx(paymentInfo.claimedAmount)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-gray-500 text-xs mb-1">Remaining</p>
                  <p className="text-gray-900 font-bold">${formatUSDCx(paymentInfo.remaining)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-gray-500 text-xs mb-1">Rate</p>
                  <p className="text-gray-900 font-bold">
                    ${formatUSDCx(paymentInfo.dripRate * BigInt(paymentInfo.dripInterval === 'daily' ? BLOCKS_PER_DAY : BLOCKS_PER_MONTH))}/{paymentInfo.dripInterval === 'daily' ? 'day' : 'mo'}
                  </p>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-gray-500 text-sm">Available to Claim</p>
                    <p className="text-2xl font-bold text-orange-500">${formatUSDCx(paymentInfo.claimable)}</p>
                  </div>
                </div>

                {paymentInfo.claimable > 0n ? (
                  <>
                    {user.isConnected && user.address === searchedAddress ? (
                      <button
                        onClick={claimPayment}
                        disabled={isLoading}
                        className="btn-primary w-full"
                      >
                        {isLoading ? 'Processing...' : 'Claim'}
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
                ) : (
                  <p className="text-center text-gray-500 py-2">
                    No funds available yet. Check back later.
                  </p>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="text-gray-400">Start</p>
                  <p className="text-gray-600 font-mono">{paymentInfo.startBlock.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400">Last Claim</p>
                  <p className="text-gray-600 font-mono">{paymentInfo.lastClaimBlock.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400">Current</p>
                  <p className="text-orange-500 font-mono">{currentBlock.toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          {searchedAddress && !paymentInfo && !isSearching && !error && (
            <div className="card text-center py-12">
              <h3 className="text-lg font-bold text-gray-900 mb-2">No Payment Found</h3>
              <p className="text-gray-500">No active payment stream for this address.</p>
              <p className="text-gray-400 text-sm mt-2 font-mono">{searchedAddress}</p>
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
