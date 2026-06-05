import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  createTransferCheckedWithTransferHookInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  transferChecked,
  transferCheckedWithTransferHook,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import {
  STEDE_HOOK_PROGRAM_ID,
  STEDE_VAULT_PROGRAM_ID,
  StedeClient,
  deriveExtraAccountMetaListPda,
  deriveVaultPda,
} from "../sdk/src";

const USDC_DECIMALS = 6;
const STEDE_DECIMALS = 6;
const PAYER_USDC_AMOUNT = 1_000_000_000;
const ALICE_INITIAL_USDC_AMOUNT = 500_000_000;
const STEP_TRANSFER_USDC_AMOUNT = 200_000_000;
const WRAP_200_USDC = new BN(200_000_000);
const DAILY_LIMIT_50 = new BN(50_000_000);
const SEND_30 = new BN(30_000_000);
const SEND_40 = new BN(40_000_000);
const SEND_20 = new BN(20_000_000);
const UNWRAP_100_USDC = new BN(100_000_000);
const SEND_5 = new BN(5_000_000);
const COOLOFF_PROGRAM_ID = new PublicKey(
  "4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg"
);
const SLOW_SEND_PROGRAM_ID = new PublicKey(
  "GWhPqirCmLHiYQdHsPXNzG2YexVR6cXsspps8YhPhaRb"
);
const FRIEND_GATE_PROGRAM_ID = new PublicKey(
  "C2ETjCNkHYdPzNZxJtufmnc3j5at2osxG6csrS9StNk5"
);
const COOLOFF_SEED = "rule_cooloff";
const SLOW_SEND_CONFIG_SEED = "slow_send_config";
const SLOW_SEND_CONTACT_SEED = "slow_send_contact";
const FRIEND_GATE_SEED = "rule_friend_gate";
const GENEROUS_COOLOFF_THRESHOLD = new BN("9999999999");
const GENEROUS_COOLOFF_DURATION = new BN(1);

type VaultAccount = {
  admin: PublicKey;
  underlyingMint: PublicKey;
  stedeMint: PublicKey;
  tokenVault: PublicKey;
  lockedAmount: BN;
  paused: boolean;
  bump: number;
};

describe("Stede 9-step end-to-end", function () {
  this.timeout(180_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const payerWallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = payerWallet.payer;

  let vaultProgram: Program;
  let cooloffProgram: Program;
  let slowSendProgram: Program;
  let friendGateProgram: Program;

  let alice: Keypair;
  let bob: Keypair;
  let aliceProvider: AnchorProvider;
  let bobProvider: AnchorProvider;
  let aliceSdk: StedeClient;
  let bobSdk: StedeClient;

  let usdcMint: PublicKey;
  let payerUsdcAta: PublicKey;
  let aliceUsdcAta: PublicKey;

  let vaultPda: PublicKey;
  let vaultStedeMint: Keypair;
  let tokenVault: Keypair;
  let aliceVaultStedeAta: PublicKey;
  let bobVaultStedeAta: PublicKey;

  let aliceHandle: string;
  let bobHandle: string;

  before(async function () {
    vaultProgram = await Program.at(
      STEDE_VAULT_PROGRAM_ID.toBase58(),
      provider
    );
    cooloffProgram = await Program.at(COOLOFF_PROGRAM_ID.toBase58(), provider);
    slowSendProgram = await Program.at(
      SLOW_SEND_PROGRAM_ID.toBase58(),
      provider
    );
    friendGateProgram = await Program.at(
      FRIEND_GATE_PROGRAM_ID.toBase58(),
      provider
    );

    // Step 0 setup: create a fresh classic SPL Token mock USDC mint.
    usdcMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      USDC_DECIMALS,
      Keypair.generate(),
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`Mock USDC mint: ${usdcMint.toBase58()}`);

    payerUsdcAta = await createClassicAta(
      payer.publicKey,
      usdcMint,
      "Create payer USDC ATA"
    );
    const mintPayerUsdcTx = await mintTo(
      connection,
      payer,
      usdcMint,
      payerUsdcAta,
      payer,
      PAYER_USDC_AMOUNT,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
    await confirmTx(mintPayerUsdcTx, "Mint 1000 mock USDC to payer");

    alice = Keypair.generate();
    bob = Keypair.generate();
    await fundWallet(alice, 0.5 * LAMPORTS_PER_SOL, "Fund Alice");
    await fundWallet(bob, 0.5 * LAMPORTS_PER_SOL, "Fund Bob");

    aliceProvider = providerFor(alice);
    bobProvider = providerFor(bob);
    aliceSdk = new StedeClient(aliceProvider);
    bobSdk = new StedeClient(bobProvider);
    await aliceSdk.init();
    await bobSdk.init();

    aliceUsdcAta = await createClassicAta(
      alice.publicKey,
      usdcMint,
      "Create Alice USDC ATA"
    );
    const mintAliceUsdcTx = await mintTo(
      connection,
      payer,
      usdcMint,
      aliceUsdcAta,
      payer,
      ALICE_INITIAL_USDC_AMOUNT,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
    await confirmTx(mintAliceUsdcTx, "Mint 500 mock USDC to Alice");
  });

  function providerFor(keypair: Keypair): AnchorProvider {
    return new AnchorProvider(connection, new Wallet(keypair), {
      commitment: "confirmed",
    });
  }

  function bnToBigInt(amount: BN): bigint {
    return BigInt(amount.toString());
  }

  function randomHandle(prefix: string): string {
    return `${prefix}${Math.random().toString(36).substring(2, 9)}`;
  }

  function deriveCooloffPda(
    sender: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [cooloff] = PublicKey.findProgramAddressSync(
      [Buffer.from(COOLOFF_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      COOLOFF_PROGRAM_ID
    );
    return cooloff;
  }

  function deriveSlowSendConfigPda(
    sender: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [config] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SLOW_SEND_CONFIG_SEED),
        sender.toBuffer(),
        stedeMint.toBuffer(),
      ],
      SLOW_SEND_PROGRAM_ID
    );
    return config;
  }

  function deriveSlowSendContactPda(
    sender: PublicKey,
    recipient: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [contact] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SLOW_SEND_CONTACT_SEED),
        sender.toBuffer(),
        recipient.toBuffer(),
        stedeMint.toBuffer(),
      ],
      SLOW_SEND_PROGRAM_ID
    );
    return contact;
  }

  function deriveFriendGatePda(
    sender: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [friendGate] = PublicKey.findProgramAddressSync(
      [Buffer.from(FRIEND_GATE_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      FRIEND_GATE_PROGRAM_ID
    );
    return friendGate;
  }

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function fundWallet(
    wallet: Keypair,
    lamports: number,
    label: string
  ): Promise<string> {
    const tx = await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: wallet.publicKey,
          lamports,
        })
      ),
      [],
      { commitment: "confirmed" }
    );
    await confirmTx(tx, `${label} ${wallet.publicKey.toBase58()}`);
    return tx;
  }

  async function createClassicAta(
    owner: PublicKey,
    mint: PublicKey,
    label: string
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID
    );
    const tx = await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          owner,
          mint,
          TOKEN_PROGRAM_ID
        )
      ),
      [],
      { commitment: "confirmed" }
    );
    await confirmTx(tx, label);
    return ata;
  }

  async function createToken2022Ata(
    owner: PublicKey,
    mint: PublicKey,
    label: string
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const tx = await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          owner,
          mint,
          TOKEN_2022_PROGRAM_ID
        )
      ),
      [],
      { commitment: "confirmed" }
    );
    await confirmTx(tx, label);
    return ata;
  }

  async function fetchVault(): Promise<VaultAccount> {
    return (vaultProgram.account as any).vault.fetch(vaultPda);
  }

  async function getTokenAmount(
    tokenAccount: PublicKey,
    tokenProgram: PublicKey
  ): Promise<bigint> {
    const account = await getAccount(
      connection,
      tokenAccount,
      "confirmed",
      tokenProgram
    );
    return account.amount;
  }

  function errorMatches(
    err: unknown,
    expectedName: string,
    expectedCode: number
  ): boolean {
    const sendError = err as {
      error?: { errorCode?: { code?: string; number?: number } };
      message?: string;
      logs?: string[];
    };
    const errorCode = sendError.error?.errorCode;
    const message = sendError.message ?? "";
    const logs = (sendError.logs ?? []).join("\n");
    const hexCode = `0x${expectedCode.toString(16)}`;

    return (
      errorCode?.code === expectedName ||
      errorCode?.number === expectedCode ||
      message.includes(expectedName) ||
      message.includes(expectedCode.toString()) ||
      message.includes(hexCode) ||
      logs.includes(expectedName) ||
      logs.includes(expectedCode.toString()) ||
      logs.includes(hexCode)
    );
  }

  async function expectRuleError(
    action: () => Promise<unknown>,
    expectedName: string,
    expectedCode: number
  ): Promise<void> {
    let caught: unknown;

    try {
      await action();
    } catch (err) {
      caught = err;
      console.log(`Expected ${expectedName} rejection: ${String(err)}`);
    }

    expect(caught, `expected ${expectedName} to be thrown`).to.not.equal(
      undefined
    );
    expect(
      errorMatches(caught, expectedName, expectedCode),
      `expected ${expectedName} (${expectedCode}), got ${String(caught)}`
    ).to.equal(true);
  }

  async function transferHookStede(amount: BN, label: string): Promise<string> {
    const tx = await transferCheckedWithTransferHook(
      connection,
      alice,
      aliceVaultStedeAta,
      vaultStedeMint.publicKey,
      bobVaultStedeAta,
      alice,
      bnToBigInt(amount),
      STEDE_DECIMALS,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    await confirmTx(tx, label);
    return tx;
  }

  // Step 1: create the unified vault-issued Stede mint, now with TransferHook active.
  it("creates a USDC vault with hook-attached Stede mint", async function () {
    vaultPda = deriveVaultPda(usdcMint);
    vaultStedeMint = Keypair.generate();
    tokenVault = Keypair.generate();

    const initVaultTx = await (vaultProgram.methods as any)
      .initializeVault("Stede USD", "stUSD", "")
      .accountsPartial({
        admin: payer.publicKey,
        underlyingMint: usdcMint,
        vault: vaultPda,
        stedeMint: vaultStedeMint.publicKey,
        tokenVault: tokenVault.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([vaultStedeMint, tokenVault])
      .rpc();
    await confirmTx(initVaultTx, "Initialize USDC vault");

    const extraAccountMetaListPda = deriveExtraAccountMetaListPda(
      vaultStedeMint.publicKey
    );
    const initHookTx = await (vaultProgram.methods as any)
      .initializeVaultHook()
      .accountsPartial({
        admin: payer.publicKey,
        vault: vaultPda,
        stedeMint: vaultStedeMint.publicKey,
        extraAccountMetaList: extraAccountMetaListPda,
        stedeHookProgram: STEDE_HOOK_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await confirmTx(initHookTx, "Initialize vault hook ExtraAccountMetaList");

    const vault = await fetchVault();
    expect(vault.admin.equals(payer.publicKey)).to.equal(true);
    expect(vault.underlyingMint.equals(usdcMint)).to.equal(true);
    expect(vault.lockedAmount.eq(new BN(0))).to.equal(true);
    expect(vault.paused).to.equal(false);

    const mintAccountInfo = await connection.getAccountInfo(
      vaultStedeMint.publicKey,
      "confirmed"
    );
    const extraAccountMetaListInfo = await connection.getAccountInfo(
      extraAccountMetaListPda,
      "confirmed"
    );
    expect(mintAccountInfo).to.not.equal(null);
    expect(extraAccountMetaListInfo).to.not.equal(null);
  });

  // Step 2: exercise the SDK handle APIs with one client per user keypair.
  it("alice and bob each claim a handle", async function () {
    aliceHandle = randomHandle("alice_e2e_");
    bobHandle = randomHandle("bob_e2e_");

    const aliceClaimTx = await aliceSdk.claimHandle(aliceHandle);
    await confirmTx(aliceClaimTx, `Alice claims @${aliceHandle}`);
    const bobClaimTx = await bobSdk.claimHandle(bobHandle);
    await confirmTx(bobClaimTx, `Bob claims @${bobHandle}`);

    const resolvedAlice = await aliceSdk.resolveHandle(aliceHandle);
    const resolvedAliceWallet = await aliceSdk.resolveWallet(alice.publicKey);
    const resolvedBob = await bobSdk.resolveHandle(bobHandle);

    expect(resolvedAlice?.owner.equals(alice.publicKey)).to.equal(true);
    expect(resolvedAliceWallet).to.equal(aliceHandle);
    expect(resolvedBob?.owner.equals(bob.publicKey)).to.equal(true);
  });

  // Step 3: wrap on the vault-issued Stede mint; this mint now has TransferHook active.
  it("alice wraps 200 USDC into 200 Stede USDC", async function () {
    const fundAliceTx = await transferChecked(
      connection,
      payer,
      payerUsdcAta,
      usdcMint,
      aliceUsdcAta,
      payer,
      STEP_TRANSFER_USDC_AMOUNT,
      USDC_DECIMALS,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
    await confirmTx(fundAliceTx, "Transfer 200 USDC from payer to Alice");

    aliceVaultStedeAta = await createToken2022Ata(
      alice.publicKey,
      vaultStedeMint.publicKey,
      "Create Alice vault-issued Stede ATA"
    );

    const tx = await (vaultProgram.methods as any)
      .wrap(WRAP_200_USDC)
      .accounts({
        user: alice.publicKey,
        vault: vaultPda,
        underlyingMint: usdcMint,
        stedeMint: vaultStedeMint.publicKey,
        tokenVault: tokenVault.publicKey,
        userUnderlyingAta: aliceUsdcAta,
        userStedeAta: aliceVaultStedeAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();
    await confirmTx(tx, "Alice wraps 200 USDC");

    const vault = await fetchVault();
    const aliceStedeBalance = await getTokenAmount(
      aliceVaultStedeAta,
      TOKEN_2022_PROGRAM_ID
    );

    expect(vault.lockedAmount.eq(WRAP_200_USDC)).to.equal(true);
    expect(aliceStedeBalance.toString()).to.equal(WRAP_200_USDC.toString());
  });

  // Step 4: set the daily limit rule through the SDK on the vault-issued mint.
  it("alice sets a $50 daily limit", async function () {
    const tx = await aliceSdk.setDailyLimit(
      vaultStedeMint.publicKey,
      DAILY_LIMIT_50
    );
    await confirmTx(tx, "Alice sets $50 daily limit");

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      vaultStedeMint.publicKey
    );
    expect(rules.dailyLimit?.limit.eq(DAILY_LIMIT_50)).to.equal(true);
  });

  // Step 5: create the block-list PDA by blocking Bob's wallet.
  it("alice blocks bob", async function () {
    const tx = await aliceSdk.addBlockedWallet(
      vaultStedeMint.publicKey,
      bob.publicKey
    );
    await confirmTx(tx, "Alice blocks Bob");

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      vaultStedeMint.publicKey
    );
    expect(
      rules.blockList?.blocked.some((wallet) => wallet.equals(bob.publicKey))
    ).to.equal(true);
  });

  // Step 6.5: create Alice's cool-off PDA without constraining e2e transfers.
  it("alice sets generous cool-off (so it doesn't interfere with later steps)", async function () {
    const setTx = await (cooloffProgram.methods as any)
      .setCooloff(GENEROUS_COOLOFF_THRESHOLD, GENEROUS_COOLOFF_DURATION)
      .accountsPartial({
        sender: alice.publicKey,
        stedeMint: vaultStedeMint.publicKey,
        cooloff: deriveCooloffPda(alice.publicKey, vaultStedeMint.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc();
    console.log(`Alice sets generous cool-off transaction: ${setTx}`);
    await connection.confirmTransaction(setTx, "confirmed");
  });

  // Step 6: daily limit runs first, then the block-list rule rejects Bob.
  it("alice's $30 send to bob is refused (blocked)", async function () {
    bobVaultStedeAta = await createToken2022Ata(
      bob.publicKey,
      vaultStedeMint.publicKey,
      "Create Bob vault-issued Stede ATA"
    );

    await expectRuleError(
      () => transferHookStede(SEND_30, "Alice sends $30 to blocked Bob"),
      "RecipientBlocked",
      6000
    );

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      vaultStedeMint.publicKey
    );
    expect(rules.dailyLimit?.spentToday.eq(new BN(0))).to.equal(true);
  });

  // Step 7: unblock Bob through the SDK, leaving an initialized empty block list.
  it("alice unblocks bob", async function () {
    const tx = await aliceSdk.removeBlockedWallet(
      vaultStedeMint.publicKey,
      bob.publicKey
    );
    await confirmTx(tx, "Alice unblocks Bob");

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      vaultStedeMint.publicKey
    );
    expect(
      rules.blockList?.blocked.some((wallet) => wallet.equals(bob.publicKey))
    ).to.equal(false);
  });

  // Step 8: transfer succeeds now that Bob is unblocked and the amount is within the daily limit.
  it("alice sends $40 to bob (allowed)", async function () {
    await transferHookStede(SEND_40, "Alice sends allowed $40 to Bob");

    const bobBalance = await getTokenAmount(
      bobVaultStedeAta,
      TOKEN_2022_PROGRAM_ID
    );
    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      vaultStedeMint.publicKey
    );

    expect(bobBalance.toString()).to.equal(SEND_40.toString());
    expect(rules.dailyLimit?.spentToday.eq(SEND_40)).to.equal(true);
  });

  // Step 9: the next transfer would total $60, so the daily-limit rule rejects it.
  it("alice's $20 send is refused (would exceed daily limit)", async function () {
    await expectRuleError(
      () => transferHookStede(SEND_20, "Alice sends over-limit $20 to Bob"),
      "DailyLimitExceeded",
      6000
    );

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      vaultStedeMint.publicKey
    );
    expect(rules.dailyLimit?.spentToday.eq(SEND_40)).to.equal(true);
  });

  it("alice enables slow send, a transfer to a brand-new recipient is refused, then allowed after registration + wait", async function () {
    this.timeout(90_000);

    const setTx = await (slowSendProgram.methods as any)
      .setSlowSend(new BN(12))
      .accountsPartial({
        sender: alice.publicKey,
        stedeMint: vaultStedeMint.publicKey,
        config: deriveSlowSendConfigPda(
          alice.publicKey,
          vaultStedeMint.publicKey
        ),
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc();
    await confirmTx(setTx, "Alice enables Slow Send");

    const charlie = Keypair.generate();
    const charlieVaultStedeAta = await createToken2022Ata(
      charlie.publicKey,
      vaultStedeMint.publicKey,
      "Create Charlie vault-issued Stede ATA"
    );

    async function transferToCharlie(label: string): Promise<string> {
      const tx = await transferCheckedWithTransferHook(
        connection,
        alice,
        aliceVaultStedeAta,
        vaultStedeMint.publicKey,
        charlieVaultStedeAta,
        alice,
        bnToBigInt(SEND_5),
        STEDE_DECIMALS,
        [],
        { commitment: "confirmed" },
        TOKEN_2022_PROGRAM_ID
      );
      await confirmTx(tx, label);
      return tx;
    }

    await expectRuleError(
      () => transferToCharlie("Alice sends $5 to unregistered Charlie"),
      "RecipientNotRegistered",
      6000
    );

    const registerTx = await (slowSendProgram.methods as any)
      .registerRecipient(charlie.publicKey)
      .accountsPartial({
        sender: alice.publicKey,
        stedeMint: vaultStedeMint.publicKey,
        contact: deriveSlowSendContactPda(
          alice.publicKey,
          charlie.publicKey,
          vaultStedeMint.publicKey
        ),
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc();
    await confirmTx(registerTx, "Alice registers Charlie for Slow Send");

    await expectRuleError(
      () =>
        transferToCharlie("Alice sends $5 to Charlie during waiting period"),
      "WaitingPeriodActive",
      6001
    );

    await new Promise((resolve) => setTimeout(resolve, 14000));

    const beforeCharlieBalance = await getTokenAmount(
      charlieVaultStedeAta,
      TOKEN_2022_PROGRAM_ID
    );
    await transferToCharlie("Alice sends $5 to Charlie after waiting period");
    const afterCharlieBalance = await getTokenAmount(
      charlieVaultStedeAta,
      TOKEN_2022_PROGRAM_ID
    );

    expect((afterCharlieBalance - beforeCharlieBalance).toString()).to.equal(
      SEND_5.toString()
    );
  });

  it("alice enables friend gate, a large transfer without friend co-sign is refused, then succeeds with friend co-sign", async function () {
    this.timeout(90_000);

    const friend = Keypair.generate();
    await fundWallet(friend, 0.01 * LAMPORTS_PER_SOL, "Fund friend signer");

    const registerBobTx = await (slowSendProgram.methods as any)
      .registerRecipient(bob.publicKey)
      .accountsPartial({
        sender: alice.publicKey,
        stedeMint: vaultStedeMint.publicKey,
        contact: deriveSlowSendContactPda(
          alice.publicKey,
          bob.publicKey,
          vaultStedeMint.publicKey
        ),
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc();
    await confirmTx(registerBobTx, "Alice registers Bob for Slow Send");
    await new Promise((resolve) => setTimeout(resolve, 14000));

    const setTx = await (friendGateProgram.methods as any)
      .setFriendGate(new BN(3_000_000), friend.publicKey)
      .accountsPartial({
        sender: alice.publicKey,
        stedeMint: vaultStedeMint.publicKey,
        friendGate: deriveFriendGatePda(
          alice.publicKey,
          vaultStedeMint.publicKey
        ),
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc();
    await confirmTx(setTx, "Alice enables Friend Gate");

    await expectRuleError(
      () => transferHookStede(SEND_5, "Alice sends $5 without friend co-sign"),
      "FriendSignatureRequired",
      6000
    );

    const beforeBobBalance = await getTokenAmount(
      bobVaultStedeAta,
      TOKEN_2022_PROGRAM_ID
    );
    const carrierIx = SystemProgram.transfer({
      fromPubkey: friend.publicKey,
      toPubkey: friend.publicKey,
      lamports: 0,
    });
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      connection,
      aliceVaultStedeAta,
      vaultStedeMint.publicKey,
      bobVaultStedeAta,
      alice.publicKey,
      bnToBigInt(SEND_5),
      STEDE_DECIMALS,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const tx = await connection.sendTransaction(
      new Transaction().add(carrierIx, transferIx),
      [alice, friend],
      { preflightCommitment: "confirmed" }
    );
    await confirmTx(tx, "Alice sends $5 with friend co-sign");
    const afterBobBalance = await getTokenAmount(
      bobVaultStedeAta,
      TOKEN_2022_PROGRAM_ID
    );

    expect((afterBobBalance - beforeBobBalance).toString()).to.equal(
      SEND_5.toString()
    );
  });

  // Step 10: unwrap uses Alice's vault-issued Stede from the same unified mint.
  it("alice unwraps 100 Stede USDC back to 100 USDC", async function () {
    const beforeUsdc = await getTokenAmount(aliceUsdcAta, TOKEN_PROGRAM_ID);

    const tx = await (vaultProgram.methods as any)
      .unwrap(UNWRAP_100_USDC)
      .accounts({
        user: alice.publicKey,
        vault: vaultPda,
        underlyingMint: usdcMint,
        stedeMint: vaultStedeMint.publicKey,
        tokenVault: tokenVault.publicKey,
        userStedeAta: aliceVaultStedeAta,
        userUnderlyingAta: aliceUsdcAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();
    await confirmTx(tx, "Alice unwraps 100 vault-issued Stede");

    const vault = await fetchVault();
    const afterUsdc = await getTokenAmount(aliceUsdcAta, TOKEN_PROGRAM_ID);

    expect(vault.lockedAmount.eq(new BN(100_000_000))).to.equal(true);
    expect((afterUsdc - beforeUsdc).toString()).to.equal(
      UNWRAP_100_USDC.toString()
    );
  });
});
