// @ts-nocheck
// This file is run by Clarinet (Deno), not TypeScript
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.8.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.208.0/testing/asserts.ts';

Clarinet.test({
  name: 'dev-payments: admin can create a payment',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get('deployer')!;
    const recipient = accounts.get('wallet_1')!;

    // First mint some USDCx to deployer
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000), // 10000 USDCx
        types.principal(deployer.address),
      ], deployer.address),
    ]);
    assertEquals(block.receipts[0].result.expectOk(), 'true');

    // Create a payment
    block = chain.mineBlock([
      Tx.contractCall('dev-payments', 'create-payment', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.uint(1000000000), // 1000 USDCx total
        types.uint(100000000),  // 100 USDCx per period
        types.ascii('monthly'),
        types.utf8('Payment for Project X'),
      ], deployer.address),
    ]);
    assertEquals(block.receipts[0].result.expectOk(), 'u1');

    // Check payment exists
    const payment = chain.callReadOnlyFn(
      'dev-payments',
      'get-payment',
      [types.principal(recipient.address)],
      deployer.address
    );
    const paymentData = payment.result.expectSome().expectTuple();
    assertEquals(paymentData['total-amount'], 'u1000000000');
    assertEquals(paymentData['is-active'], 'true');
  },
});

Clarinet.test({
  name: 'dev-payments: recipient can claim dripped funds',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get('deployer')!;
    const recipient = accounts.get('wallet_1')!;

    // Mint and create payment
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(deployer.address),
      ], deployer.address),
      Tx.contractCall('dev-payments', 'create-payment', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('daily'),
        types.utf8('Daily payment'),
      ], deployer.address),
    ]);

    // Mine some blocks to allow drip
    chain.mineEmptyBlockUntil(150);

    // Check claimable amount
    const claimable = chain.callReadOnlyFn(
      'dev-payments',
      'get-claimable-amount',
      [types.principal(recipient.address)],
      recipient.address
    );
    // Should have some claimable amount after 144+ blocks
    const amount = claimable.result.expectOk();

    // Claim
    block = chain.mineBlock([
      Tx.contractCall('dev-payments', 'claim', [
        types.principal(`${deployer.address}.usdcx`),
      ], recipient.address),
    ]);
    block.receipts[0].result.expectOk();
  },
});

Clarinet.test({
  name: 'dev-payments: admin can pause and resume payment',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get('deployer')!;
    const recipient = accounts.get('wallet_1')!;

    // Mint and create payment
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(deployer.address),
      ], deployer.address),
      Tx.contractCall('dev-payments', 'create-payment', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
        types.utf8('Test payment'),
      ], deployer.address),
    ]);

    // Pause payment
    block = chain.mineBlock([
      Tx.contractCall('dev-payments', 'pause-payment', [
        types.principal(recipient.address),
      ], deployer.address),
    ]);
    block.receipts[0].result.expectOk();

    // Check payment is paused
    const payment = chain.callReadOnlyFn(
      'dev-payments',
      'get-payment',
      [types.principal(recipient.address)],
      deployer.address
    );
    const paymentData = payment.result.expectSome().expectTuple();
    assertEquals(paymentData['is-active'], 'false');

    // Resume payment
    block = chain.mineBlock([
      Tx.contractCall('dev-payments', 'resume-payment', [
        types.principal(recipient.address),
      ], deployer.address),
    ]);
    block.receipts[0].result.expectOk();

    // Check payment is active again
    const paymentAfter = chain.callReadOnlyFn(
      'dev-payments',
      'get-payment',
      [types.principal(recipient.address)],
      deployer.address
    );
    const paymentDataAfter = paymentAfter.result.expectSome().expectTuple();
    assertEquals(paymentDataAfter['is-active'], 'true');
  },
});

Clarinet.test({
  name: 'dev-payments: non-admin cannot create payment',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get('deployer')!;
    const wallet1 = accounts.get('wallet_1')!;
    const wallet2 = accounts.get('wallet_2')!;

    // Mint to non-admin
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(wallet1.address),
      ], deployer.address),
    ]);

    // Try to create payment as non-admin
    block = chain.mineBlock([
      Tx.contractCall('dev-payments', 'create-payment', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(wallet2.address),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
        types.utf8('Unauthorized payment'),
      ], wallet1.address),
    ]);
    // Should fail with err-unauthorized (u1)
    block.receipts[0].result.expectErr().expectUint(1);
  },
});

Clarinet.test({
  name: 'dev-payments: get-stats returns correct data',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get('deployer')!;
    const wallet1 = accounts.get('wallet_1')!;
    const wallet2 = accounts.get('wallet_2')!;

    // Create two payments
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(20000000000),
        types.principal(deployer.address),
      ], deployer.address),
      Tx.contractCall('dev-payments', 'create-payment', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(wallet1.address),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
        types.utf8('Payment 1'),
      ], deployer.address),
      Tx.contractCall('dev-payments', 'create-payment', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(wallet2.address),
        types.uint(2000000000),
        types.uint(200000000),
        types.ascii('daily'),
        types.utf8('Payment 2'),
      ], deployer.address),
    ]);

    // Check stats
    const stats = chain.callReadOnlyFn(
      'dev-payments',
      'get-stats',
      [],
      deployer.address
    );
    const statsData = stats.result.expectTuple();
    assertEquals(statsData['total-payments'], 'u2');
    assertEquals(statsData['total-allocated'], 'u3000000000');
  },
});
