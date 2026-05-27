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
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import {
  STEDE_VAULT_PROGRAM_ID,
  STEDE_HOOK_PROGRAM_ID,
  STEDE_HANDLE_REGISTRY_PROGRAM_ID,
  STEDE_RULE_DAILY_LIMIT_PROGRAM_ID,
  STEDE_RULE_BLOCK_HANDLE_PROGRAM_ID,
  deriveHandlePda,
  deriveReversePda,
  deriveVaultPda,
  deriveDailyLimitPda,
  deriveBlockListPda,
} from "./pdas";

import type {
  HandleRecord,
  DailyLimitRecord,
  BlockListRecord,
  SenderRules,
  VaultRecord,
} from "./types";

/**
 * StedeClient — the public SDK for interacting with the Stede protocol.
 *
 * Construct once per session with an AnchorProvider (typically derived
 * from a Wallet Adapter or Privy embedded wallet on the frontend).
 *
 * All methods are async. Reads return data, writes return TransactionSignature.
 *
 * Day 7 status: protocol-complete, but the vault-hook integration is
 * pending (Week 2 Day 8). Until then, hook enforcement applies only to
 * mints explicitly created with the transfer_hook extension; the vault's
 * issued Stede mints are plain Token-2022 mints.
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

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.connection = provider.connection;
  }

  /** Loads all five program IDLs from chain. Must be called before any other method. */
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
  // RULE OPERATIONS (daily limit + block list)
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

  /** Fetch all rule state for a sender on a Stede mint. */
  async getRulesForSender(
    sender: PublicKey,
    stedeMint: PublicKey
  ): Promise<SenderRules> {
    const dailyLimitPda = deriveDailyLimitPda(sender, stedeMint);
    const blockListPda = deriveBlockListPda(sender, stedeMint);

    let dailyLimit: DailyLimitRecord | null = null;
    try {
      const data = await (this.dailyLimitProgram.account as any).dailyLimit.fetch(dailyLimitPda);
      dailyLimit = {
        limit: data.limit,
        spentToday: data.spentToday,
        windowStartSlot: data.windowStartSlot,
      };
    } catch {
      // PDA doesn't exist — no limit set
    }

    let blockList: BlockListRecord | null = null;
    try {
      const data = await (this.blockHandleProgram.account as any).blockList.fetch(blockListPda);
      const ZERO = PublicKey.default;
      const blocked = data.blocked.filter((w: PublicKey) => !w.equals(ZERO));
      blockList = {
        blocked,
        count: data.count,
      };
    } catch {
      // PDA doesn't exist — empty block list
    }

    return { dailyLimit, blockList };
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
}