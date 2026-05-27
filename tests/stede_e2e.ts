import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createMint,
  ExtensionType,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
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
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import {
  StedeClient,
  deriveExtraAccountMetaListPda,
  deriveVaultPda,
} from "../sdk/src";

const STEDE_VAULT_PROGRAM_ID = new PublicKey(
  "hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai"
);
const STEDE_HOOK_PROGRAM_ID = new PublicKey(
  "Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv"
);
const USDC_DECIMALS = 6;
const STEDE_DECIMALS = 6;
const PAYER_USDC_AMOUNT = 1_000_000_000;
const ALICE_INITIAL_USDC_AMOUNT = 500_000_000;
const STEP_TRANSFER_USDC_AMOUNT = 200_000_000;
const WRAP_200_USDC = new BN(200_000_000);
const HOOK_MINT_100_STEDE = new BN(100_000_000);
const DAILY_LIMIT_50 = new BN(50_000_000);
const SEND_30 = new BN(30_000_000);
const SEND_40 = new BN(40_000_000);
const SEND_20 = new BN(20_000_000);
const UNWRAP_100_USDC = new BN(100_000_000);

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
  let hookProgram: Program;

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

  let hookStedeMint: Keypair;
  let aliceHookStedeAta: PublicKey;
  let bobHookStedeAta: PublicKey;

  let aliceHandle: string;
  let bobHandle: string;

  before(async function () {
    vaultProgram = await Program.at(
      STEDE_VAULT_PROGRAM_ID.toBase58(),
      provider
    );
    hookProgram = await Program.at(STEDE_HOOK_PROGRAM_ID.toBase58(), provider);

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
      aliceHookStedeAta,
      hookStedeMint.publicKey,
      bobHookStedeAta,
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

  // Step 1: create the vault-issued Stede mint and the underlying token vault.
  it("creates a USDC vault", async function () {
    vaultPda = deriveVaultPda(usdcMint);
    vaultStedeMint = Keypair.generate();
    tokenVault = Keypair.generate();

    const tx = await (vaultProgram.methods as any)
      .initializeVault()
      .accounts({
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
    await confirmTx(tx, "Initialize USDC vault");

    const vault = await fetchVault();
    expect(vault.admin.equals(payer.publicKey)).to.equal(true);
    expect(vault.underlyingMint.equals(usdcMint)).to.equal(true);
    expect(vault.lockedAmount.eq(new BN(0))).to.equal(true);
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

  // Step 3: wrap on the vault-issued Stede mint, which is a plain Token-2022 mint.
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

  // Step 4 scaffolding: until the vault mints with transfer hooks, rules use a separate hook-attached mint.
  it("creates a hook-attached Stede mint for rule testing", async function () {
    hookStedeMint = Keypair.generate();
    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const rent = await connection.getMinimumBalanceForRentExemption(mintLen);

    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: hookStedeMint.publicKey,
      space: mintLen,
      lamports: rent,
      programId: TOKEN_2022_PROGRAM_ID,
    });
    const initTransferHookIx = createInitializeTransferHookInstruction(
      hookStedeMint.publicKey,
      payer.publicKey,
      STEDE_HOOK_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID
    );
    const initMintIx = createInitializeMintInstruction(
      hookStedeMint.publicKey,
      STEDE_DECIMALS,
      payer.publicKey,
      payer.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const mintTx = await provider.sendAndConfirm(
      new Transaction().add(createAccountIx, initTransferHookIx, initMintIx),
      [hookStedeMint],
      { commitment: "confirmed" }
    );
    await confirmTx(mintTx, "Create hook-attached Token-2022 Stede mint");

    const extraAccountMetaList = deriveExtraAccountMetaListPda(
      hookStedeMint.publicKey
    );
    const eamlTx = await (hookProgram.methods as any)
      .initializeExtraAccountMetaList()
      .accounts({
        payer: payer.publicKey,
        extraAccountMetaList,
        stedeMint: hookStedeMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await confirmTx(eamlTx, "Initialize hook ExtraAccountMetaList");

    aliceHookStedeAta = await createToken2022Ata(
      alice.publicKey,
      hookStedeMint.publicKey,
      "Create Alice hook-mint Stede ATA"
    );
    const mintAliceHookTx = await mintTo(
      connection,
      payer,
      hookStedeMint.publicKey,
      aliceHookStedeAta,
      payer,
      bnToBigInt(HOOK_MINT_100_STEDE),
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    await confirmTx(mintAliceHookTx, "Mint 100 hook-mint Stede to Alice");
  });

  // Step 5: set the daily limit rule through the SDK.
  it("alice sets a $50 daily limit", async function () {
    const tx = await aliceSdk.setDailyLimit(
      hookStedeMint.publicKey,
      DAILY_LIMIT_50
    );
    await confirmTx(tx, "Alice sets $50 daily limit");

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      hookStedeMint.publicKey
    );
    expect(rules.dailyLimit?.limit.eq(DAILY_LIMIT_50)).to.equal(true);
  });

  // Step 6: create the block-list PDA by blocking Bob's wallet.
  it("alice blocks bob", async function () {
    const tx = await aliceSdk.addBlockedWallet(
      hookStedeMint.publicKey,
      bob.publicKey
    );
    await confirmTx(tx, "Alice blocks Bob");

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      hookStedeMint.publicKey
    );
    expect(
      rules.blockList?.blocked.some((wallet) => wallet.equals(bob.publicKey))
    ).to.equal(true);
  });

  // Step 7: daily limit runs first, then the block-list rule rejects Bob.
  it("alice's $30 send to bob is refused (blocked)", async function () {
    bobHookStedeAta = await createToken2022Ata(
      bob.publicKey,
      hookStedeMint.publicKey,
      "Create Bob hook-mint Stede ATA"
    );

    await expectRuleError(
      () => transferHookStede(SEND_30, "Alice sends $30 to blocked Bob"),
      "RecipientBlocked",
      6000
    );

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      hookStedeMint.publicKey
    );
    expect(rules.dailyLimit?.spentToday.eq(new BN(0))).to.equal(true);
  });

  // Step 8: unblock Bob through the SDK, leaving an initialized empty block list.
  it("alice unblocks bob", async function () {
    const tx = await aliceSdk.removeBlockedWallet(
      hookStedeMint.publicKey,
      bob.publicKey
    );
    await confirmTx(tx, "Alice unblocks Bob");

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      hookStedeMint.publicKey
    );
    expect(
      rules.blockList?.blocked.some((wallet) => wallet.equals(bob.publicKey))
    ).to.equal(false);
  });

  // Step 9: transfer succeeds now that Bob is unblocked and the amount is within the daily limit.
  it("alice sends $40 to bob (allowed)", async function () {
    await transferHookStede(SEND_40, "Alice sends allowed $40 to Bob");

    const bobBalance = await getTokenAmount(
      bobHookStedeAta,
      TOKEN_2022_PROGRAM_ID
    );
    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      hookStedeMint.publicKey
    );

    expect(bobBalance.toString()).to.equal(SEND_40.toString());
    expect(rules.dailyLimit?.spentToday.eq(SEND_40)).to.equal(true);
  });

  // Step 10: the next transfer would total $60, so the daily-limit rule rejects it.
  it("alice's $20 send is refused (would exceed daily limit)", async function () {
    await expectRuleError(
      () => transferHookStede(SEND_20, "Alice sends over-limit $20 to Bob"),
      "DailyLimitExceeded",
      6000
    );

    const rules = await aliceSdk.getRulesForSender(
      alice.publicKey,
      hookStedeMint.publicKey
    );
    expect(rules.dailyLimit?.spentToday.eq(SEND_40)).to.equal(true);
  });

  // Step 11: unwrap uses Alice's vault-issued Stede, not Bob's hook-mint Stede.
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
