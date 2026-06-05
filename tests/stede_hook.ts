import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  ExtensionType,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  transferCheckedWithTransferHook,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const STEDE_HOOK_PROGRAM_ID = new PublicKey(
  "Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv"
);
const DAILY_LIMIT_PROGRAM_ID = new PublicKey(
  "DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5"
);
const BLOCK_HANDLE_PROGRAM_ID = new PublicKey(
  "J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq"
);
const COOLOFF_PROGRAM_ID = new PublicKey(
  "4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg"
);
const EXTRA_ACCOUNT_META_LIST_SEED = "extra-account-metas";
const DAILY_LIMIT_SEED = "rule_daily_limit";
const BLOCK_HANDLE_SEED = "rule_block_handle";
const COOLOFF_SEED = "rule_cooloff";
const DECIMALS = 6;
const MINT_100_STEDE = new BN(100_000_000);
const TRANSFER_50_STEDE = new BN(50_000_000);
const GENEROUS_DAILY_LIMIT = new BN(1_000_000_000);
const GENEROUS_COOLOFF_THRESHOLD = new BN("9999999999");
const GENEROUS_COOLOFF_DURATION = new BN(1);
// Genuine enforcement scenario: $5 cap, $6 over-limit, $3 within-limit.
const FIVE_DOLLAR_CAP = new BN(5_000_000);
const SIX_DOLLARS = new BN(6_000_000);
const THREE_DOLLARS = new BN(3_000_000);
const EXPECTED_HOOK_LOG = "stede_hook execute() invoked. CPIing into rules.";
const EXPECTED_DAILY_LIMIT_LOG = "Daily limit rule passed.";
const EXPECTED_BLOCK_LIST_LOG = "Block list rule passed.";

type HookMintFixture = {
  stedeMint: Keypair;
  extraAccountMetaList: PublicKey;
};

type TokenAccountsFixture = {
  senderAta: PublicKey;
  recipientWallet: PublicKey;
  recipientAta: PublicKey;
};

type DailyLimitAccount = {
  sender: PublicKey;
  stedeMint: PublicKey;
  limit: BN;
  spentToday: BN;
  windowStartSlot: BN;
  bump: number;
};

describe("stede_hook", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let hookProgram: Program;
  let dailyLimitProgram: Program;
  let blockHandleProgram: Program;
  let cooloffProgram: Program;
  let initializedMintFixture: HookMintFixture;

  before(async function () {
    hookProgram = await Program.at(STEDE_HOOK_PROGRAM_ID.toBase58(), provider);
    dailyLimitProgram = await Program.at(
      DAILY_LIMIT_PROGRAM_ID.toBase58(),
      provider
    );
    blockHandleProgram = await Program.at(
      BLOCK_HANDLE_PROGRAM_ID.toBase58(),
      provider
    );
    cooloffProgram = await Program.at(COOLOFF_PROGRAM_ID.toBase58(), provider);
  });

  function deriveExtraAccountMetaList(stedeMint: PublicKey): PublicKey {
    const [extraAccountMetaList] = PublicKey.findProgramAddressSync(
      [Buffer.from(EXTRA_ACCOUNT_META_LIST_SEED), stedeMint.toBuffer()],
      STEDE_HOOK_PROGRAM_ID
    );
    return extraAccountMetaList;
  }

  function deriveDailyLimit(
    sender: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [dailyLimit] = PublicKey.findProgramAddressSync(
      [Buffer.from(DAILY_LIMIT_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      DAILY_LIMIT_PROGRAM_ID
    );
    return dailyLimit;
  }

  function deriveBlockList(sender: PublicKey, stedeMint: PublicKey): PublicKey {
    const [blockList] = PublicKey.findProgramAddressSync(
      [Buffer.from(BLOCK_HANDLE_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      BLOCK_HANDLE_PROGRAM_ID
    );
    return blockList;
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

  function bnToBigInt(amount: BN): bigint {
    return BigInt(amount.toString());
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Public devnet RPC intermittently returns "Blockhash not found" / "node is
  // behind" for setup txs. These are transient infra errors, not logic errors,
  // so retry with a fresh blockhash before giving up.
  async function withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    attempts = 5
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        const msg = String((err as { message?: string })?.message ?? err);
        const transient =
          msg.includes("Blockhash not found") ||
          msg.includes("node is behind") ||
          msg.includes("block height exceeded") ||
          msg.includes("Transaction was not confirmed");
        if (!transient || i === attempts - 1) {
          throw err;
        }
        lastErr = err;
        console.log(`Retrying ${label} after transient error: ${msg}`);
        await sleep(1000);
      }
    }
    throw lastErr;
  }

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function createTransferHookMint(): Promise<HookMintFixture> {
    const stedeMint = Keypair.generate();
    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const rent = await connection.getMinimumBalanceForRentExemption(mintLen);

    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: stedeMint.publicKey,
      space: mintLen,
      lamports: rent,
      programId: TOKEN_2022_PROGRAM_ID,
    });

    const initTransferHookIx = createInitializeTransferHookInstruction(
      stedeMint.publicKey,
      payer.publicKey,
      STEDE_HOOK_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID
    );

    const initMintIx = createInitializeMintInstruction(
      stedeMint.publicKey,
      DECIMALS,
      payer.publicKey,
      payer.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = await withRetry(
      () =>
        provider.sendAndConfirm(
          new Transaction().add(createAccountIx, initTransferHookIx, initMintIx),
          [stedeMint],
          { commitment: "confirmed" }
        ),
      "Create Token-2022 mint with transfer hook"
    );
    await confirmTx(tx, "Create Token-2022 mint with transfer hook");

    return {
      stedeMint,
      extraAccountMetaList: deriveExtraAccountMetaList(stedeMint.publicKey),
    };
  }

  async function initializeExtraAccountMetaList(
    fixture: HookMintFixture,
    label = "Initialize ExtraAccountMetaList"
  ): Promise<string> {
    const tx = await (hookProgram.methods as any)
      .initializeExtraAccountMetaList()
      .accounts({
        payer: payer.publicKey,
        extraAccountMetaList: fixture.extraAccountMetaList,
        stedeMint: fixture.stedeMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function setDailyLimit(
    fixture: HookMintFixture,
    limit: BN,
    label = "Set hook daily limit"
  ): Promise<string> {
    const dailyLimit = deriveDailyLimit(
      payer.publicKey,
      fixture.stedeMint.publicKey
    );
    const tx = await (dailyLimitProgram.methods as any)
      .setLimit(limit)
      .accounts({
        sender: payer.publicKey,
        stedeMint: fixture.stedeMint.publicKey,
        dailyLimit,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function fetchDailyLimit(
    fixture: HookMintFixture
  ): Promise<DailyLimitAccount> {
    const dailyLimit = deriveDailyLimit(
      payer.publicKey,
      fixture.stedeMint.publicKey
    );
    return (dailyLimitProgram.account as any).dailyLimit.fetch(dailyLimit);
  }

  async function addBlocked(
    fixture: HookMintFixture,
    blockedWallet: PublicKey,
    label = "Add blocked wallet"
  ): Promise<string> {
    const blockList = deriveBlockList(
      payer.publicKey,
      fixture.stedeMint.publicKey
    );
    const tx = await (blockHandleProgram.methods as any)
      .addBlocked(blockedWallet)
      .accounts({
        sender: payer.publicKey,
        stedeMint: fixture.stedeMint.publicKey,
        blockList,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function createPassingBlockList(
    fixture: HookMintFixture,
    label = "Create passing block list"
  ): Promise<string> {
    return addBlocked(fixture, Keypair.generate().publicKey, label);
  }

  async function setGenerousCooloff(
    fixture: HookMintFixture,
    label = "Set generous cool-off"
  ): Promise<string> {
    const tx = await (cooloffProgram.methods as any)
      .setCooloff(GENEROUS_COOLOFF_THRESHOLD, GENEROUS_COOLOFF_DURATION)
      .accountsPartial({
        sender: payer.publicKey,
        stedeMint: fixture.stedeMint.publicKey,
        cooloff: deriveCooloffPda(payer.publicKey, fixture.stedeMint.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function createTokenAccounts(
    fixture: HookMintFixture
  ): Promise<TokenAccountsFixture> {
    const recipient = Keypair.generate();
    const senderAta = getAssociatedTokenAddressSync(
      fixture.stedeMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const recipientAta = getAssociatedTokenAddressSync(
      fixture.stedeMint.publicKey,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const createSenderAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      senderAta,
      payer.publicKey,
      fixture.stedeMint.publicKey,
      TOKEN_2022_PROGRAM_ID
    );
    const createRecipientAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      recipientAta,
      recipient.publicKey,
      fixture.stedeMint.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = await withRetry(
      () =>
        provider.sendAndConfirm(
          new Transaction().add(createSenderAtaIx, createRecipientAtaIx),
          [],
          { commitment: "confirmed" }
        ),
      "Create Token-2022 ATAs"
    );
    await confirmTx(tx, "Create Token-2022 ATAs");

    return { senderAta, recipientWallet: recipient.publicKey, recipientAta };
  }

  async function createRecipientAta(
    fixture: HookMintFixture,
    recipientWallet: PublicKey,
    label = "Create recipient Token-2022 ATA"
  ): Promise<PublicKey> {
    const recipientAta = getAssociatedTokenAddressSync(
      fixture.stedeMint.publicKey,
      recipientWallet,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = await withRetry(
      () =>
        provider.sendAndConfirm(
          new Transaction().add(
            createAssociatedTokenAccountInstruction(
              payer.publicKey,
              recipientAta,
              recipientWallet,
              fixture.stedeMint.publicKey,
              TOKEN_2022_PROGRAM_ID
            )
          ),
          [],
          { commitment: "confirmed" }
        ),
      label
    );
    await confirmTx(tx, label);

    return recipientAta;
  }

  async function mintStede(
    fixture: HookMintFixture,
    destination: PublicKey,
    amount: BN
  ): Promise<string> {
    const tx = await mintTo(
      connection,
      payer,
      fixture.stedeMint.publicKey,
      destination,
      payer,
      bnToBigInt(amount),
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    await confirmTx(tx, "Mint Token-2022 Stede dollars");
    return tx;
  }

  async function transferWithHook(
    fixture: HookMintFixture,
    accounts: TokenAccountsFixture,
    amount: BN,
    label = "Transfer checked with transfer hook"
  ): Promise<string> {
    // spl-token 0.4.x exposes this helper; it resolves the ExtraAccountMetaList
    // PDA and appends the hook execute accounts to the transferChecked ix.
    const tx = await transferCheckedWithTransferHook(
      connection,
      payer,
      accounts.senderAta,
      fixture.stedeMint.publicKey,
      accounts.recipientAta,
      payer,
      bnToBigInt(amount),
      DECIMALS,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    await confirmTx(tx, label);
    return tx;
  }

  async function getTokenBalance(tokenAccount: PublicKey): Promise<bigint> {
    const account = await getAccount(
      connection,
      tokenAccount,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    return account.amount;
  }

  async function getTransactionLogs(signature: string): Promise<string[]> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = tx?.meta?.logMessages;

      if (logs) {
        return logs;
      }

      await sleep(500);
    }

    return [];
  }

  function errorMatches(
    err: unknown,
    expectedName: string,
    expectedCode: number
  ): boolean {
    const sendError = err as {
      message?: string;
      logs?: string[];
    };
    const message = sendError.message ?? "";
    const logs = (sendError.logs ?? []).join("\n");
    const hexCode = `0x${expectedCode.toString(16)}`;

    return (
      message.includes(expectedName) ||
      message.includes(expectedCode.toString()) ||
      message.includes(hexCode) ||
      message.includes("Transfer would exceed the daily limit") ||
      message.includes("Recipient is on the sender's block list") ||
      logs.includes(expectedName) ||
      logs.includes(expectedCode.toString()) ||
      logs.includes(hexCode) ||
      logs.includes("Transfer would exceed the daily limit") ||
      logs.includes("Recipient is on the sender's block list")
    );
  }

  async function expectRejected(action: () => Promise<unknown>): Promise<void> {
    let rejected = false;

    try {
      await action();
    } catch (err) {
      rejected = true;
      console.log(`Expected rejection: ${String(err)}`);
    }

    expect(rejected).to.equal(true);
  }

  async function expectDailyLimitExceeded(
    action: () => Promise<unknown>
  ): Promise<void> {
    let caught: unknown;

    try {
      await action();
    } catch (err) {
      caught = err;
      console.log(`Expected DailyLimitExceeded rejection: ${String(err)}`);
    }

    expect(caught, "expected DailyLimitExceeded to be thrown").to.not.equal(
      undefined
    );
    expect(
      errorMatches(caught, "DailyLimitExceeded", 6000),
      `expected DailyLimitExceeded (6000), got ${String(caught)}`
    ).to.equal(true);
  }

  async function expectRecipientBlocked(
    action: () => Promise<unknown>
  ): Promise<void> {
    let caught: unknown;

    try {
      await action();
    } catch (err) {
      caught = err;
      console.log(`Expected RecipientBlocked rejection: ${String(err)}`);
    }

    expect(caught, "expected RecipientBlocked to be thrown").to.not.equal(
      undefined
    );
    expect(
      errorMatches(caught, "RecipientBlocked", 6000),
      `expected RecipientBlocked (6000), got ${String(caught)}`
    ).to.equal(true);
  }

  // initializeExtraAccountMetaList stores the hook metadata PDA Token-2022 reads.
  describe("initializeExtraAccountMetaList", function () {
    it("creates the ExtraAccountMetaList PDA for a Stede mint", async function () {
      initializedMintFixture = await createTransferHookMint();

      await initializeExtraAccountMetaList(initializedMintFixture);

      const accountInfo = await connection.getAccountInfo(
        initializedMintFixture.extraAccountMetaList,
        "confirmed"
      );
      expect(accountInfo).to.not.equal(null);
    });

    it("cannot be initialized twice for the same mint", async function () {
      await expectRejected(async () => {
        await initializeExtraAccountMetaList(
          initializedMintFixture,
          "Initialize duplicate ExtraAccountMetaList"
        );
      });
    });
  });

  // execute is tested indirectly by a Token-2022 transferChecked invocation.
  describe("execute (via transferChecked)", function () {
    it("hook fires on transferChecked of a Stede dollar", async function () {
      const tokenAccounts = await createTokenAccounts(initializedMintFixture);
      await mintStede(
        initializedMintFixture,
        tokenAccounts.senderAta,
        MINT_100_STEDE
      );
      await setDailyLimit(
        initializedMintFixture,
        GENEROUS_DAILY_LIMIT,
        "Set generous daily limit"
      );
      await createPassingBlockList(
        initializedMintFixture,
        "Create non-blocking block list"
      );
      await setGenerousCooloff(initializedMintFixture);

      const tx = await transferWithHook(
        initializedMintFixture,
        tokenAccounts,
        TRANSFER_50_STEDE
      );

      const logs = await getTransactionLogs(tx);
      expect(logs.some((log) => log.includes(EXPECTED_HOOK_LOG))).to.equal(
        true
      );
      expect(
        logs.some((log) => log.includes(EXPECTED_DAILY_LIMIT_LOG))
      ).to.equal(true);
      expect(
        logs.some((log) => log.includes(EXPECTED_BLOCK_LIST_LOG))
      ).to.equal(true);

      const dailyLimit = await fetchDailyLimit(initializedMintFixture);
      expect(dailyLimit.spentToday.eq(TRANSFER_50_STEDE)).to.equal(true);

      const senderBalance = await getTokenBalance(tokenAccounts.senderAta);
      const recipientBalance = await getTokenBalance(
        tokenAccounts.recipientAta
      );
      expect(senderBalance.toString()).to.equal(TRANSFER_50_STEDE.toString());
      expect(recipientBalance.toString()).to.equal(
        TRANSFER_50_STEDE.toString()
      );
    });

    it("transfer fails when ExtraAccountMetaList is not initialized", async function () {
      const uninitializedMintFixture = await createTransferHookMint();
      const tokenAccounts = await createTokenAccounts(uninitializedMintFixture);
      await mintStede(
        uninitializedMintFixture,
        tokenAccounts.senderAta,
        MINT_100_STEDE
      );

      await expectRejected(async () => {
        await transferWithHook(
          uninitializedMintFixture,
          tokenAccounts,
          TRANSFER_50_STEDE,
          "Transfer without ExtraAccountMetaList"
        );
      });
    });

    it("enforces a $5 cap: rejects $6, then allows $3", async function () {
      const limitedMintFixture = await createTransferHookMint();
      await initializeExtraAccountMetaList(
        limitedMintFixture,
        "Initialize $5-cap mint ExtraAccountMetaList"
      );
      const tokenAccounts = await createTokenAccounts(limitedMintFixture);
      await mintStede(
        limitedMintFixture,
        tokenAccounts.senderAta,
        MINT_100_STEDE
      );
      await setDailyLimit(
        limitedMintFixture,
        FIVE_DOLLAR_CAP,
        "Set $5 daily cap"
      );
      await createPassingBlockList(
        limitedMintFixture,
        "Create block list before $5-cap enforcement"
      );
      await setGenerousCooloff(
        limitedMintFixture,
        "Set cool-off before $5-cap enforcement"
      );

      // $6 > $5 cap: must be rejected with DailyLimitExceeded, and because the
      // hook CPI aborts the whole transfer, nothing is spent or moved.
      await expectDailyLimitExceeded(async () => {
        await transferWithHook(
          limitedMintFixture,
          tokenAccounts,
          SIX_DOLLARS,
          "Transfer $6 over $5 cap"
        );
      });

      const afterRejection = await fetchDailyLimit(limitedMintFixture);
      expect(
        afterRejection.spentToday.eq(new BN(0)),
        "rejected $6 transfer must not consume any daily allowance"
      ).to.equal(true);
      expect(
        (await getTokenBalance(tokenAccounts.senderAta)).toString()
      ).to.equal(MINT_100_STEDE.toString());
      expect(
        (await getTokenBalance(tokenAccounts.recipientAta)).toString()
      ).to.equal("0");

      // $3 <= $5 cap: must succeed, move funds, and record $3 spent.
      await transferWithHook(
        limitedMintFixture,
        tokenAccounts,
        THREE_DOLLARS,
        "Transfer $3 within $5 cap"
      );

      const afterSuccess = await fetchDailyLimit(limitedMintFixture);
      expect(
        afterSuccess.spentToday.eq(THREE_DOLLARS),
        "successful $3 transfer must record $3 spent"
      ).to.equal(true);
      expect(
        (await getTokenBalance(tokenAccounts.senderAta)).toString()
      ).to.equal(MINT_100_STEDE.sub(THREE_DOLLARS).toString());
      expect(
        (await getTokenBalance(tokenAccounts.recipientAta)).toString()
      ).to.equal(THREE_DOLLARS.toString());
    });

    // Regression: a brand-new sender with NO rules configured must be able to
    // send. The hook CPIs into all six rule programs unconditionally, so every
    // rule must treat "unset / no config PDA" as auto-pass. Before the fix,
    // daily_limit (first in the CPI order) rejected with AccountNotInitialized
    // and blocked every first send — which the app mislabeled as "Night mode".
    it("fresh account with NO rules set can send to another account", async function () {
      const freshMintFixture = await createTransferHookMint();
      await initializeExtraAccountMetaList(
        freshMintFixture,
        "Initialize no-rules ExtraAccountMetaList"
      );
      const tokenAccounts = await createTokenAccounts(freshMintFixture);
      await mintStede(
        freshMintFixture,
        tokenAccounts.senderAta,
        MINT_100_STEDE
      );

      // Intentionally configure NOTHING: no daily limit, no block list, no
      // cool-off, no slow send, no night mode, no friend gate. Every rule must
      // fail open, so the transfer should pass purely on auto-pass paths.
      const tx = await transferWithHook(
        freshMintFixture,
        tokenAccounts,
        THREE_DOLLARS,
        "Fresh no-rules transfer"
      );

      const logs = await getTransactionLogs(tx);
      expect(
        logs.some((log) => log.includes(EXPECTED_HOOK_LOG)),
        "hook must fire even when no rules are configured"
      ).to.equal(true);

      // The daily-limit PDA was never created, so it must not exist after a
      // successful auto-pass transfer (the rule didn't write anything).
      const dailyLimitPda = deriveDailyLimit(
        payer.publicKey,
        freshMintFixture.stedeMint.publicKey
      );
      expect(
        await connection.getAccountInfo(dailyLimitPda, "confirmed"),
        "unset daily-limit PDA must remain uncreated"
      ).to.equal(null);

      // Funds actually moved.
      expect(
        (await getTokenBalance(tokenAccounts.senderAta)).toString()
      ).to.equal(MINT_100_STEDE.sub(THREE_DOLLARS).toString());
      expect(
        (await getTokenBalance(tokenAccounts.recipientAta)).toString()
      ).to.equal(THREE_DOLLARS.toString());
    });

    it("transfer is refused when recipient is on the sender's block list", async function () {
      const blockedMintFixture = await createTransferHookMint();
      await initializeExtraAccountMetaList(
        blockedMintFixture,
        "Initialize blocked-recipient ExtraAccountMetaList"
      );

      const recipientA = Keypair.generate();
      const recipientB = Keypair.generate();
      const senderAta = getAssociatedTokenAddressSync(
        blockedMintFixture.stedeMint.publicKey,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const recipientAAta = await createRecipientAta(
        blockedMintFixture,
        recipientA.publicKey,
        "Create blocked recipient ATA"
      );
      await createRecipientAta(
        blockedMintFixture,
        recipientB.publicKey,
        "Create unblocked recipient ATA"
      );
      await createRecipientAta(
        blockedMintFixture,
        payer.publicKey,
        "Create sender ATA for blocked-recipient test"
      );
      await mintStede(blockedMintFixture, senderAta, MINT_100_STEDE);
      await setDailyLimit(
        blockedMintFixture,
        GENEROUS_DAILY_LIMIT,
        "Set generous daily limit before block failure"
      );
      await addBlocked(
        blockedMintFixture,
        recipientA.publicKey,
        "Block recipient wallet"
      );
      await setGenerousCooloff(
        blockedMintFixture,
        "Set cool-off before block-list failure"
      );

      await expectRecipientBlocked(async () => {
        await transferWithHook(
          blockedMintFixture,
          {
            senderAta,
            recipientWallet: recipientA.publicKey,
            recipientAta: recipientAAta,
          },
          TRANSFER_50_STEDE,
          "Transfer to blocked recipient"
        );
      });
    });

    it("transfer succeeds when recipient is not blocked", async function () {
      const allowedMintFixture = await createTransferHookMint();
      await initializeExtraAccountMetaList(
        allowedMintFixture,
        "Initialize allowed-recipient ExtraAccountMetaList"
      );

      const recipientA = Keypair.generate();
      const recipientB = Keypair.generate();
      const senderAta = getAssociatedTokenAddressSync(
        allowedMintFixture.stedeMint.publicKey,
        payer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      await createRecipientAta(
        allowedMintFixture,
        recipientA.publicKey,
        "Create blocked wallet ATA"
      );
      const recipientBAta = await createRecipientAta(
        allowedMintFixture,
        recipientB.publicKey,
        "Create allowed recipient ATA"
      );
      await createRecipientAta(
        allowedMintFixture,
        payer.publicKey,
        "Create sender ATA for allowed-recipient test"
      );
      await mintStede(allowedMintFixture, senderAta, MINT_100_STEDE);
      await setDailyLimit(
        allowedMintFixture,
        GENEROUS_DAILY_LIMIT,
        "Set generous daily limit before allowed transfer"
      );
      await addBlocked(
        allowedMintFixture,
        recipientA.publicKey,
        "Block a different recipient wallet"
      );
      await setGenerousCooloff(
        allowedMintFixture,
        "Set cool-off before allowed transfer"
      );

      const tx = await transferWithHook(
        allowedMintFixture,
        {
          senderAta,
          recipientWallet: recipientB.publicKey,
          recipientAta: recipientBAta,
        },
        TRANSFER_50_STEDE,
        "Transfer to unblocked recipient"
      );

      const logs = await getTransactionLogs(tx);
      expect(
        logs.some((log) => log.includes(EXPECTED_DAILY_LIMIT_LOG))
      ).to.equal(true);
      expect(
        logs.some((log) => log.includes(EXPECTED_BLOCK_LIST_LOG))
      ).to.equal(true);
    });
  });
});
