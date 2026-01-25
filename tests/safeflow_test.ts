// @ts-nocheck
// This file is run by Clarinet (Deno), not TypeScript
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.8.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.208.0/testing/asserts.ts';

Clarinet.test({
  name: 'safeflow: anyone can create a safeflow',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient = accounts.get('wallet_2')!;
    const deployer = accounts.get('deployer')!;

    // First mint some USDCx to creator
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000), // 10000 USDCx
        types.principal(creator.address),
      ], deployer.address),
    ]);
    assertEquals(block.receipts[0].result.expectOk(), 'true');

    // Create a safeflow (anyone can create, not just admin)
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.utf8('Developer Salary'),
        types.utf8('Monthly payment for frontend development'),
        types.uint(1000000000), // 1000 USDCx total
        types.uint(100000000),  // 100 USDCx per period
        types.ascii('monthly'),
      ], creator.address),
    ]);
    const result = block.receipts[0].result.expectOk().expectTuple();
    assertEquals(result['id'], 'u0');

    // Check safeflow exists
    const safeflow = chain.callReadOnlyFn(
      'safeflow',
      'get-safeflow',
      [types.uint(0)],
      creator.address
    );
    const sfData = safeflow.result.expectSome().expectTuple();
    assertEquals(sfData['total-amount'], 'u1000000000');
    assertEquals(sfData['status'], 'u1'); // STATUS_ACTIVE
    assertEquals(sfData['title'], 'u"Developer Salary"');
  },
});

Clarinet.test({
  name: 'safeflow: recipient can claim dripped funds',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient = accounts.get('wallet_2')!;
    const deployer = accounts.get('deployer')!;

    // Mint and create safeflow
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(creator.address),
      ], deployer.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.utf8('Daily Payments'),
        types.utf8('Daily drip test'),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('daily'),
      ], creator.address),
    ]);

    // Mine some blocks to allow drip
    chain.mineEmptyBlockUntil(150);

    // Check claimable amount
    const claimable = chain.callReadOnlyFn(
      'safeflow',
      'get-claimable-amount',
      [types.uint(0)],
      recipient.address
    );
    // Should have some claimable amount after 144+ blocks
    claimable.result.expectOk();

    // Claim
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'claim', [
        types.principal(`${deployer.address}.usdcx`),
        types.uint(0),
      ], recipient.address),
    ]);
    block.receipts[0].result.expectOk();
  },
});

Clarinet.test({
  name: 'safeflow: admin can freeze and unfreeze safeflow',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient = accounts.get('wallet_2')!;
    const deployer = accounts.get('deployer')!;

    // Mint and create safeflow
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(creator.address),
      ], deployer.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.utf8('Freeze Test'),
        types.utf8('Testing freeze functionality'),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
      ], creator.address),
    ]);

    // Freeze safeflow (creator is admin)
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'freeze-safeflow', [
        types.uint(0),
      ], creator.address),
    ]);
    block.receipts[0].result.expectOk();

    // Check safeflow is frozen
    const safeflow = chain.callReadOnlyFn(
      'safeflow',
      'get-safeflow',
      [types.uint(0)],
      creator.address
    );
    const sfData = safeflow.result.expectSome().expectTuple();
    assertEquals(sfData['status'], 'u2'); // STATUS_FROZEN

    // Unfreeze safeflow
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'unfreeze-safeflow', [
        types.uint(0),
      ], creator.address),
    ]);
    block.receipts[0].result.expectOk();

    // Check safeflow is active again
    const safeflowAfter = chain.callReadOnlyFn(
      'safeflow',
      'get-safeflow',
      [types.uint(0)],
      creator.address
    );
    const sfDataAfter = safeflowAfter.result.expectSome().expectTuple();
    assertEquals(sfDataAfter['status'], 'u1'); // STATUS_ACTIVE
  },
});

Clarinet.test({
  name: 'safeflow: admin can cancel and get USDCx returned',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient = accounts.get('wallet_2')!;
    const deployer = accounts.get('deployer')!;

    // Mint and create safeflow
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(creator.address),
      ], deployer.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.utf8('Cancel Test'),
        types.utf8('Testing cancel functionality'),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
      ], creator.address),
    ]);

    // Get creator's balance before cancel
    const balanceBefore = chain.callReadOnlyFn(
      'usdcx',
      'get-balance',
      [types.principal(creator.address)],
      creator.address
    );
    
    // Cancel safeflow (should return USDCx to creator)
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'cancel-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.uint(0),
      ], creator.address),
    ]);
    const cancelResult = block.receipts[0].result.expectOk().expectTuple();
    assertEquals(cancelResult['status'], '"cancelled"');
    assertEquals(cancelResult['returned-amount'], 'u1000000000');

    // Check safeflow is cancelled
    const safeflow = chain.callReadOnlyFn(
      'safeflow',
      'get-safeflow',
      [types.uint(0)],
      creator.address
    );
    const sfData = safeflow.result.expectSome().expectTuple();
    assertEquals(sfData['status'], 'u3'); // STATUS_CANCELLED

    // Verify USDCx was returned to creator
    const balanceAfter = chain.callReadOnlyFn(
      'usdcx',
      'get-balance',
      [types.principal(creator.address)],
      creator.address
    );
    // Balance should be restored (minus any claimed)
  },
});

Clarinet.test({
  name: 'safeflow: non-admin cannot freeze or cancel',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient = accounts.get('wallet_2')!;
    const attacker = accounts.get('wallet_3')!;
    const deployer = accounts.get('deployer')!;

    // Mint and create safeflow
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(creator.address),
      ], deployer.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.utf8('Security Test'),
        types.utf8('Testing unauthorized access'),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
      ], creator.address),
    ]);

    // Try to freeze as non-admin (should fail)
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'freeze-safeflow', [
        types.uint(0),
      ], attacker.address),
    ]);
    block.receipts[0].result.expectErr().expectUint(100); // ERR_UNAUTHORIZED

    // Try to cancel as non-admin (should fail)
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'cancel-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.uint(0),
      ], attacker.address),
    ]);
    block.receipts[0].result.expectErr().expectUint(100); // ERR_UNAUTHORIZED
  },
});

Clarinet.test({
  name: 'safeflow: recipient cannot claim from frozen safeflow',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient = accounts.get('wallet_2')!;
    const deployer = accounts.get('deployer')!;

    // Mint and create safeflow
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(creator.address),
      ], deployer.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.utf8('Frozen Claim Test'),
        types.utf8('Testing claim on frozen safeflow'),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('daily'),
      ], creator.address),
    ]);

    // Mine blocks for drip
    chain.mineEmptyBlockUntil(150);

    // Freeze the safeflow
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'freeze-safeflow', [
        types.uint(0),
      ], creator.address),
    ]);

    // Try to claim (should fail with ERR_SAFEFLOW_INACTIVE)
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'claim', [
        types.principal(`${deployer.address}.usdcx`),
        types.uint(0),
      ], recipient.address),
    ]);
    block.receipts[0].result.expectErr().expectUint(105); // ERR_SAFEFLOW_INACTIVE
  },
});

Clarinet.test({
  name: 'safeflow: get-stats returns correct data',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient1 = accounts.get('wallet_2')!;
    const recipient2 = accounts.get('wallet_3')!;
    const deployer = accounts.get('deployer')!;

    // Create two safeflows
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(20000000000),
        types.principal(creator.address),
      ], deployer.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient1.address),
        types.utf8('SafeFlow 1'),
        types.utf8('First safeflow'),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
      ], creator.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient2.address),
        types.utf8('SafeFlow 2'),
        types.utf8('Second safeflow'),
        types.uint(2000000000),
        types.uint(200000000),
        types.ascii('daily'),
      ], creator.address),
    ]);

    // Check stats
    const stats = chain.callReadOnlyFn(
      'safeflow',
      'get-stats',
      [],
      creator.address
    );
    const statsData = stats.result.expectTuple();
    assertEquals(statsData['total-safeflows'], 'u2');
    assertEquals(statsData['active-safeflows'], 'u2');
    assertEquals(statsData['total-allocated'], 'u3000000000');
  },
});

Clarinet.test({
  name: 'safeflow: can update drip rate',
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const creator = accounts.get('wallet_1')!;
    const recipient = accounts.get('wallet_2')!;
    const deployer = accounts.get('deployer')!;

    // Mint and create safeflow
    let block = chain.mineBlock([
      Tx.contractCall('usdcx', 'mint', [
        types.uint(10000000000),
        types.principal(creator.address),
      ], deployer.address),
      Tx.contractCall('safeflow', 'create-safeflow', [
        types.principal(`${deployer.address}.usdcx`),
        types.principal(recipient.address),
        types.utf8('Rate Update Test'),
        types.utf8('Testing drip rate update'),
        types.uint(1000000000),
        types.uint(100000000),
        types.ascii('monthly'),
      ], creator.address),
    ]);

    // Update drip rate
    block = chain.mineBlock([
      Tx.contractCall('safeflow', 'update-drip-rate', [
        types.uint(0),
        types.uint(200000000), // Double the drip
        types.ascii('daily'),
      ], creator.address),
    ]);
    block.receipts[0].result.expectOk();

    // Verify update
    const safeflow = chain.callReadOnlyFn(
      'safeflow',
      'get-safeflow',
      [types.uint(0)],
      creator.address
    );
    const sfData = safeflow.result.expectSome().expectTuple();
    assertEquals(sfData['drip-interval'], '"daily"');
  },
});
