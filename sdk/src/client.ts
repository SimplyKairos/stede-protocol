import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionSignature,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";


import {
  STEDE_VAULT_PROGRAM_ID,
  STEDE_HOOK_PROGRAM_ID,
  STEDE_HANDLE_REGISTRY_PROGRAM_ID,
  STEDE_RULE_DAILY_LIMIT_PROGRAM_ID,
  STEDE_RULE_BLOCK_HANDLE_PROGRAM_ID,
  STEDE_RULE_COOLOFF_PROGRAM_ID,
  STEDE_RULE_NEW_RECIPIENT_DELAY_PROGRAM_ID,
  STEDE_RULE_TIME_WINDOW_PROGRAM_ID,
  STEDE_RULE_FRIEND_GATE_PROGRAM_ID,
  deriveHandlePda,
  deriveReversePda,
  deriveVaultPda,
  deriveDailyLimitPda,
  deriveBlockListPda,
  deriveCooloffPda,
  deriveSlowSendConfigPda,
  deriveSlowSendContactPda,
  deriveTimeWindowPda,
  deriveFriendGatePda,
} from "./pdas";

import type {
  HandleRecord,
  DailyLimitRecord,
  BlockListRecord,
  CooloffRecord,
  SlowSendRecord,
  NightModeRecord,
  FriendGateRecord,
  SenderRules,
  VaultRecord,
  TransferPreview,
} from "./types";

// --- Buffer BigInt-method polyfill (browser) -----------------------------
// spl-token encodes u64 amounts with Buffer.prototype.writeBigUInt64LE, which
// some browser Buffer builds omit. Add the methods if missing. No-op in Node.
import { Buffer as _B } from "buffer";
function _patchBuf(proto: any) {
  if (!proto) return;
  if (typeof proto.writeBigUInt64LE !== "function") {
    proto.writeBigUInt64LE = function (value: bigint, offset = 0): number {
      let v = BigInt(value);
      for (let i = 0; i < 8; i++) { this[offset + i] = Number(v & 0xffn); v >>= 8n; }
      return offset + 8;
    };
  }
  if (typeof proto.readBigUInt64LE !== "function") {
    proto.readBigUInt64LE = function (offset = 0): bigint {
      let r = 0n;
      for (let i = 7; i >= 0; i--) r = (r << 8n) | BigInt(this[offset + i] & 0xff);
      return r;
    };
  }
  if (typeof proto.writeBigInt64LE !== "function") {
    proto.writeBigInt64LE = function (value: bigint, offset = 0): number {
      return proto.writeBigUInt64LE.call(this, BigInt.asUintN(64, BigInt(value)), offset);
    };
  }
}
_patchBuf((_B as any)?.prototype);
if (typeof globalThis !== "undefined") _patchBuf((globalThis as any)?.Buffer?.prototype);
// -------------------------------------------------------------------------

/**
 * StedeClient — the public SDK for interacting with the Stede protocol.
 *
 * Construct once per session with an AnchorProvider (typically derived
 * from a Wallet Adapter or Privy embedded wallet on the frontend).
 *
 * All methods are async. Reads return data, writes return TransactionSignature.
 *
 * Day 14 status: protocol + rule SDK polish. The client wraps PDA
 * derivation and raw Anchor calls so app code can stay focused on UX.
 */
export class StedeClient {
  readonly provider: AnchorProvider;
  readonly connection: Connection;

  // Loaded programs — populated by init()
  private vaultProgram!: Program;
  private hookProgram!: Program;
  private handleRegistryProgram!: Program;
  private dailyLimitProgram!: Program;
  private blockHandleProgram!: Program;
  private cooloffProgram!: Program;
  private slowSendProgram!: Program;
  private timeWindowProgram!: Program;
  private friendGateProgram!: Program;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.connection = provider.connection;
  }

  /** Loads all program IDLs from chain. Must be called before any other method. */
  async init(): Promise<void> {
    this.vaultProgram = await Program.at(
      STEDE_VAULT_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.hookProgram = await Program.at(
      STEDE_HOOK_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.handleRegistryProgram = await Program.at(
      STEDE_HANDLE_REGISTRY_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.dailyLimitProgram = await Program.at(
      STEDE_RULE_DAILY_LIMIT_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.blockHandleProgram = await Program.at(
      STEDE_RULE_BLOCK_HANDLE_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.cooloffProgram = await Program.at(
      STEDE_RULE_COOLOFF_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.slowSendProgram = await Program.at(
      STEDE_RULE_NEW_RECIPIENT_DELAY_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.timeWindowProgram = await Program.at(
      STEDE_RULE_TIME_WINDOW_PROGRAM_ID.toBase58(),
      this.provider
    );
    this.friendGateProgram = await Program.at(
      STEDE_RULE_FRIEND_GATE_PROGRAM_ID.toBase58(),
      this.provider
    );
  }

  // ============================================================
  // HANDLE OPERATIONS
  // ============================================================

  /** Resolve a handle to its owner wallet. Returns null if unclaimed. */
  async resolveHandle(name: string): Promise<HandleRecord | null> {
    const pda = deriveHandlePda(name);
    try {
      const data = await (this.handleRegistryProgram.account as any).handle.fetch(pda);
      return {
        name: data.name,
        owner: data.owner,
        claimedAt: data.claimedAt.toNumber(),
      };
    } catch {
      return null;
    }
  }

  /** Resolve a wallet to its handle. Returns null if the wallet has no handle. */
  async resolveWallet(wallet: PublicKey): Promise<string | null> {
    const pda = deriveReversePda(wallet);
    try {
      const data = await (this.handleRegistryProgram.account as any).reverse.fetch(pda);
      return data.handle;
    } catch {
      return null;
    }
  }

  /** Claim a handle for the provider's wallet. */
  async claimHandle(name: string): Promise<TransactionSignature> {
    const claimer = this.provider.wallet.publicKey;
    return this.handleRegistryProgram.methods
      .claimHandle(name)
      .accountsPartial({
        claimer,
        handleAccount: deriveHandlePda(name),
        reverseAccount: deriveReversePda(claimer),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Release the provider's currently-owned handle. */
  async releaseHandle(name: string): Promise<TransactionSignature> {
    const owner = this.provider.wallet.publicKey;
    return this.handleRegistryProgram.methods
      .releaseHandle()
      .accountsPartial({
        owner,
        handleAccount: deriveHandlePda(name),
        reverseAccount: deriveReversePda(owner),
      })
      .rpc();
  }

  // ============================================================
  // VAULT OPERATIONS (wrap / unwrap)
  // ============================================================

  /** Read vault state for a given underlying stablecoin mint. */
  async getVault(underlyingMint: PublicKey): Promise<VaultRecord | null> {
    const pda = deriveVaultPda(underlyingMint);
    try {
      const data = await (this.vaultProgram.account as any).vault.fetch(pda);
      return {
        admin: data.admin,
        underlyingMint: data.underlyingMint,
        stedeMint: data.stedeMint,
        tokenVault: data.tokenVault,
        lockedAmount: data.lockedAmount,
        paused: data.paused,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // RULE OPERATIONS
  // ============================================================

  /** Set the provider's daily transfer limit for a Stede mint. */
  async setDailyLimit(
    stedeMint: PublicKey,
    limit: BN
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.dailyLimitProgram.methods
      .setLimit(limit)
      .accountsPartial({
        sender,
        stedeMint,
        dailyLimit: deriveDailyLimitPda(sender, stedeMint),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Add a wallet to the provider's block list for a Stede mint. */
  async addBlockedWallet(
    stedeMint: PublicKey,
    blockedWallet: PublicKey
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.blockHandleProgram.methods
      .addBlocked(blockedWallet)
      .accountsPartial({
        sender,
        stedeMint,
        blockList: deriveBlockListPda(sender, stedeMint),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Remove a wallet from the provider's block list. */
  async removeBlockedWallet(
    stedeMint: PublicKey,
    blockedWallet: PublicKey
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.blockHandleProgram.methods
      .removeBlocked(blockedWallet)
      .accountsPartial({
        sender,
        stedeMint,
        blockList: deriveBlockListPda(sender, stedeMint),
      })
      .rpc();
  }

  // ---- Cool-off ----

  /** Set a cool-off: transfers >= threshold trigger a pause of durationSeconds. */
  async setCooloff(
    stedeMint: PublicKey,
    threshold: BN,
    durationSeconds: BN
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.cooloffProgram.methods
      .setCooloff(threshold, durationSeconds)
      .accountsPartial({
        sender,
        stedeMint,
        cooloff: deriveCooloffPda(sender, stedeMint),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Disable the provider's cool-off for a Stede mint. */
  async disableCooloff(stedeMint: PublicKey): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.cooloffProgram.methods
      .disableCooloff()
      .accountsPartial({
        sender,
        cooloff: deriveCooloffPda(sender, stedeMint),
      })
      .rpc();
  }

  // ---- Slow Send (new recipient delay) ----

  /** Set the slow-send delay (seconds) for new recipients. */
  async setSlowSend(
    stedeMint: PublicKey,
    delaySeconds: BN
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.slowSendProgram.methods
      .setSlowSend(delaySeconds)
      .accountsPartial({
        sender,
        stedeMint,
        config: deriveSlowSendConfigPda(sender, stedeMint),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Disable slow send for a Stede mint. */
  async disableSlowSend(stedeMint: PublicKey): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.slowSendProgram.methods
      .disableSlowSend()
      .accountsPartial({
        sender,
        config: deriveSlowSendConfigPda(sender, stedeMint),
      })
      .rpc();
  }

  /** Register a recipient to start their slow-send waiting period. */
  async registerRecipient(
    stedeMint: PublicKey,
    recipient: PublicKey
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.slowSendProgram.methods
      .registerRecipient(recipient)
      .accountsPartial({
        sender,
        stedeMint,
        contact: deriveSlowSendContactPda(sender, recipient, stedeMint),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // ---- Night Mode (time window) ----

  /** Set the blocked-hours window (UTC, 0-23). */
  async setNightMode(
    stedeMint: PublicKey,
    startHour: number,
    endHour: number
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.timeWindowProgram.methods
      .setTimeWindow(startHour, endHour)
      .accountsPartial({
        sender,
        stedeMint,
        config: deriveTimeWindowPda(sender, stedeMint),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Disable night mode for a Stede mint. */
  async disableNightMode(stedeMint: PublicKey): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.timeWindowProgram.methods
      .disableTimeWindow()
      .accountsPartial({
        sender,
        config: deriveTimeWindowPda(sender, stedeMint),
      })
      .rpc();
  }

  // ---- Friend Gate ----

  /** Set a friend gate: transfers >= threshold require friendWallet to co-sign. */
  async setFriendGate(
    stedeMint: PublicKey,
    threshold: BN,
    friendWallet: PublicKey
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.friendGateProgram.methods
      .setFriendGate(threshold, friendWallet)
      .accountsPartial({
        sender,
        stedeMint,
        friendGate: deriveFriendGatePda(sender, stedeMint),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Disable the friend gate for a Stede mint. */
  async disableFriendGate(stedeMint: PublicKey): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    return this.friendGateProgram.methods
      .disableFriendGate()
      .accountsPartial({
        sender,
        friendGate: deriveFriendGatePda(sender, stedeMint),
      })
      .rpc();
  }

  /** Fetch all rule state for a sender on a Stede mint. Each is null if unset. */
  async getRulesForSender(
    sender: PublicKey,
    stedeMint: PublicKey
  ): Promise<SenderRules> {
    const [
      dailyLimit,
      blockList,
      cooloff,
      slowSend,
      nightMode,
      friendGate,
    ] = await Promise.all([
      (async (): Promise<DailyLimitRecord | null> => {
        try {
          const d = await (this.dailyLimitProgram.account as any).dailyLimit.fetch(
            deriveDailyLimitPda(sender, stedeMint)
          );
          return {
            limit: d.limit,
            spentToday: d.spentToday,
            windowStartSlot: d.windowStartSlot,
          };
        } catch {
          return null;
        }
      })(),
      (async (): Promise<BlockListRecord | null> => {
        try {
          const d = await (this.blockHandleProgram.account as any).blockList.fetch(
            deriveBlockListPda(sender, stedeMint)
          );
          const ZERO = PublicKey.default;
          return {
            blocked: d.blocked.filter((w: PublicKey) => !w.equals(ZERO)),
            count: d.count,
          };
        } catch {
          return null;
        }
      })(),
      (async (): Promise<CooloffRecord | null> => {
        try {
          const d = await (this.cooloffProgram.account as any).cooloff.fetch(
            deriveCooloffPda(sender, stedeMint)
          );
          return {
            threshold: d.threshold,
            durationSeconds: d.durationSeconds,
            lastLargeTransferAt: d.lastLargeTransferAt,
          };
        } catch {
          return null;
        }
      })(),
      (async (): Promise<SlowSendRecord | null> => {
        try {
          const d = await (this.slowSendProgram.account as any).slowSendConfig.fetch(
            deriveSlowSendConfigPda(sender, stedeMint)
          );
          return { delaySeconds: d.delaySeconds };
        } catch {
          return null;
        }
      })(),
      (async (): Promise<NightModeRecord | null> => {
        try {
          const d = await (this.timeWindowProgram.account as any).timeWindowConfig.fetch(
            deriveTimeWindowPda(sender, stedeMint)
          );
          return { startHour: d.startHour, endHour: d.endHour };
        } catch {
          return null;
        }
      })(),
      (async (): Promise<FriendGateRecord | null> => {
        try {
          const d = await (this.friendGateProgram.account as any).friendGate.fetch(
            deriveFriendGatePda(sender, stedeMint)
          );
          return { threshold: d.threshold, friendWallet: d.friendWallet };
        } catch {
          return null;
        }
      })(),
    ]);

    return { dailyLimit, blockList, cooloff, slowSend, nightMode, friendGate };
  }

  // ============================================================
  // ATA HELPERS
  // ============================================================

  /** Returns the Stede ATA address for a wallet + Stede mint (Token-2022). */
  getStedeAta(wallet: PublicKey, stedeMint: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
      stedeMint,
      wallet,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  }

  // ============================================================
  // HIGH-LEVEL TRANSFER
  // ============================================================

  /**
   * Transfer Stede dollars to a handle. Resolves the handle, ensures the
   * recipient ATA exists, builds the hook-aware transfer, and submits.
   *
   * For transfers that may trip the friend gate, use buildFriendGateTransfer
   * instead so the friend can co-sign.
   */
  async transfer(
    toHandle: string,
    stedeMint: PublicKey,
    amount: BN,
    decimals: number
  ): Promise<TransactionSignature> {
    const sender = this.provider.wallet.publicKey;
    const recipientRecord = await this.resolveHandle(toHandle);
    if (!recipientRecord) {
      throw new Error(`Handle @${toHandle} is not claimed.`);
    }
    const recipient = recipientRecord.owner;

    const sourceAta = this.getStedeAta(sender, stedeMint);
    const destAta = this.getStedeAta(recipient, stedeMint);

    const tx = new Transaction();

    // Create the recipient ATA if missing.
    const destInfo = await this.connection.getAccountInfo(destAta);
    if (!destInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          sender,
          destAta,
          recipient,
          stedeMint,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      this.connection,
      sourceAta,
      stedeMint,
      destAta,
      sender,
      BigInt(amount.toString()),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    tx.add(transferIx);

    return this.provider.sendAndConfirm(tx);
  }

  /**
   * Simulate a transfer and report whether it would pass all rules,
   * and if not, which rule refused. Does not submit.
   */
  async previewTransfer(
    toHandle: string,
    stedeMint: PublicKey,
    amount: BN,
    decimals: number
  ): Promise<TransferPreview> {
    const sender = this.provider.wallet.publicKey;
    const recipientRecord = await this.resolveHandle(toHandle);
    if (!recipientRecord) {
      return {
        approved: false,
        refusedBy: null,
        message: `Handle @${toHandle} is not claimed.`,
      };
    }
    const recipient = recipientRecord.owner;
    const sourceAta = this.getStedeAta(sender, stedeMint);
    const destAta = this.getStedeAta(recipient, stedeMint);

    try {
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        this.connection,
        sourceAta,
        stedeMint,
        destAta,
        sender,
        BigInt(amount.toString()),
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      const tx = new Transaction().add(transferIx);
      tx.feePayer = sender;
      const sim = await this.connection.simulateTransaction(tx, undefined);

      if (!sim.value.err) {
        return { approved: true, refusedBy: null, message: "Transfer would succeed." };
      }

      // The simulation failed. Decide whether a rule rejected it (expected) or
      // something else went wrong on-chain (unexpected — surface as an error).
      const logs = (sim.value.logs ?? []).join("\n");
      const refusedBy = this.classifyRefusal(logs);
      if (refusedBy) {
        return {
          approved: false,
          refusedBy,
          message: this.refusalMessage(refusedBy),
        };
      }
      return {
        approved: false,
        refusedBy: null,
        error: true,
        message: this.unexpectedErrorMessage(logs),
      };
    } catch (e: any) {
      // An exception here is almost always a real problem — building the hook
      // instruction (e.g. missing ExtraAccountMetaList or ATA), serialization,
      // or RPC. Only treat it as a refusal if the thrown error carries sim logs
      // that name a known rule; otherwise report it as an error, never a rule.
      const logs = e?.logs ? e.logs.join("\n") : String(e?.message ?? e);
      const refusedBy = this.classifyRefusal(logs);
      if (refusedBy) {
        return {
          approved: false,
          refusedBy,
          message: this.refusalMessage(refusedBy),
        };
      }
      return {
        approved: false,
        refusedBy: null,
        error: true,
        message: this.unexpectedErrorMessage(logs),
      };
    }
  }

  /**
   * Map simulation logs to the rule that refused, by the Anchor error name each
   * rule program emits. Returns null when no known rule error is present — the
   * caller must then treat the failure as an unexpected error, NOT as a rule.
   * Never defaults to a specific named rule.
   */
  private classifyRefusal(logs: string): string | null {
    if (logs.includes("DailyLimitExceeded")) return "daily_limit";
    if (logs.includes("RecipientBlocked")) return "block_list";
    if (logs.includes("CooloffActive")) return "cooloff";
    if (
      logs.includes("RecipientNotRegistered") ||
      logs.includes("WaitingPeriodActive")
    )
      return "slow_send";
    if (logs.includes("WithinBlockedWindow")) return "night_mode";
    if (logs.includes("FriendSignatureRequired")) return "friend_gate";
    return null;
  }

  private refusalMessage(refusedBy: string | null): string {
    switch (refusedBy) {
      case "daily_limit":
        return "This transfer would exceed your daily limit.";
      case "block_list":
        return "This recipient is on your block list.";
      case "cooloff":
        return "You're in a cool-off period after a recent large transfer.";
      case "slow_send":
        return "This is a new recipient. Register them and wait out the delay before sending.";
      case "night_mode":
        return "Transfers are blocked during your night mode hours.";
      case "friend_gate":
        return "This transfer needs your friend to co-sign.";
      default:
        // Not a rule refusal — generic, never a specific named rule.
        return "A rule blocked this transfer.";
    }
  }

  /** Message for a preview failure that is NOT a rule rejection. */
  private unexpectedErrorMessage(logs: string): string {
    if (logs.includes("AccountNotInitialized") || logs.includes("could not find account")) {
      return "Couldn't simulate this transfer — an account it needs isn't set up yet. Try again.";
    }
    if (logs.includes("insufficient") || logs.includes("Insufficient")) {
      return "Insufficient balance to cover this transfer.";
    }
    return "Couldn't simulate this transfer right now. Please try again.";
  }

  /**
   * Build a friend-gate transfer transaction (unsigned) for amounts at or
   * above the friend-gate threshold. Includes a co-sign carrier instruction
   * the friend must sign. The caller collects both signatures and submits.
   */
  async buildFriendGateTransfer(
    toHandle: string,
    stedeMint: PublicKey,
    amount: BN,
    decimals: number,
    friendWallet: PublicKey
  ): Promise<Transaction> {
    const sender = this.provider.wallet.publicKey;
    const recipientRecord = await this.resolveHandle(toHandle);
    if (!recipientRecord) {
      throw new Error(`Handle @${toHandle} is not claimed.`);
    }
    const recipient = recipientRecord.owner;
    const sourceAta = this.getStedeAta(sender, stedeMint);
    const destAta = this.getStedeAta(recipient, stedeMint);

    const tx = new Transaction();

    const destInfo = await this.connection.getAccountInfo(destAta);
    if (!destInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          sender,
          destAta,
          recipient,
          stedeMint,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      this.connection,
      sourceAta,
      stedeMint,
      destAta,
      sender,
      BigInt(amount.toString()),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const carrierIx = SystemProgram.transfer({
      fromPubkey: friendWallet,
      toPubkey: friendWallet,
      lamports: 0,
    });
    tx.add(carrierIx, transferIx);

    tx.feePayer = sender;
    return tx;
  }

  // ============================================================
  // WRAP / UNWRAP (vault)
  // ============================================================

  /**
   * Wrap underlying stablecoin (e.g. USDC) into Stede dollars.
   * Locks `amount` base units of the underlying and mints the same
   * amount of the Stede (Token-2022) mint to the user. Ensures the
   * user's Stede ATA exists first.
   */
  async wrap(
    underlyingMint: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    const user = this.provider.wallet.publicKey;
    const vaultPda = deriveVaultPda(underlyingMint);
    const vault = await this.getVault(underlyingMint);
    if (!vault) throw new Error("No Stede vault for that underlying mint.");

    const userUnderlyingAta = getAssociatedTokenAddressSync(
      underlyingMint,
      user,
      false,
      TOKEN_PROGRAM_ID
    );
    const userStedeAta = this.getStedeAta(user, vault.stedeMint);

    const tx = new Transaction();

    const stedeAtaInfo = await this.connection.getAccountInfo(userStedeAta);
    if (!stedeAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          user,
          userStedeAta,
          user,
          vault.stedeMint,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }

    const wrapIx = await (this.vaultProgram.methods as any)
      .wrap(amount)
      .accounts({
        user,
        vault: vaultPda,
        underlyingMint,
        stedeMint: vault.stedeMint,
        tokenVault: vault.tokenVault,
        userUnderlyingAta,
        userStedeAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    tx.add(wrapIx);

    return this.provider.sendAndConfirm(tx);
  }

  /**
   * Unwrap Stede dollars back into the underlying stablecoin, 1:1.
   * Burns `amount` base units of the Stede mint and releases the
   * same amount of the locked underlying to the user.
   */
  async unwrap(
    underlyingMint: PublicKey,
    amount: BN
  ): Promise<TransactionSignature> {
    const user = this.provider.wallet.publicKey;
    const vaultPda = deriveVaultPda(underlyingMint);
    const vault = await this.getVault(underlyingMint);
    if (!vault) throw new Error("No Stede vault for that underlying mint.");

    const userUnderlyingAta = getAssociatedTokenAddressSync(
      underlyingMint,
      user,
      false,
      TOKEN_PROGRAM_ID
    );
    const userStedeAta = this.getStedeAta(user, vault.stedeMint);

    return (this.vaultProgram.methods as any)
      .unwrap(amount)
      .accounts({
        user,
        vault: vaultPda,
        underlyingMint,
        stedeMint: vault.stedeMint,
        tokenVault: vault.tokenVault,
        userStedeAta,
        userUnderlyingAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

}
