import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Public type definitions for the Stede SDK.
 *
 * These mirror the Anchor account structures but use TS-friendly types
 * (PublicKey instead of byte arrays, BN for u64).
 */

/** A claimed @handle and its owner. */
export interface HandleRecord {
  /** The handle string, e.g. "kay". */
  name: string;
  /** The wallet that owns this handle. */
  owner: PublicKey;
  /** Unix timestamp when claimed. */
  claimedAt: number;
}

/** A user's daily transfer limit for a given Stede mint. */
export interface DailyLimitRecord {
  /** Maximum base units the sender can transfer per 24h window. */
  limit: BN;
  /** How much has been spent in the current window. */
  spentToday: BN;
  /** Slot the current window started. */
  windowStartSlot: BN;
}

/** A user's block list for a given Stede mint. */
export interface BlockListRecord {
  /** Currently-blocked recipient wallets. Empty Pubkey slots are filtered out. */
  blocked: PublicKey[];
  /** How many entries are actively blocked. */
  count: number;
}

/** Aggregated rule state for a sender on a given Stede mint. */
export interface SenderRules {
  /** Daily limit, or null if the sender hasn't set one. */
  dailyLimit: DailyLimitRecord | null;
  /** Block list, or null if empty/uninitialized. */
  blockList: BlockListRecord | null;
}

/** A Stede vault tied to a specific underlying stablecoin mint. */
export interface VaultRecord {
  /** The vault's admin (pauser). */
  admin: PublicKey;
  /** The underlying stablecoin (e.g. USDC). */
  underlyingMint: PublicKey;
  /** The Stede mint issued against the underlying. */
  stedeMint: PublicKey;
  /** Token account holding the locked underlying. */
  tokenVault: PublicKey;
  /** Total underlying locked. */
  lockedAmount: BN;
  /** Whether wrap/unwrap is paused. */
  paused: boolean;
}

/** Result of a transfer preview (does this transfer pass all rules?). */
export interface TransferPreview {
  /** True if all rules approve this transfer. */
  approved: boolean;
  /** Specific rule failures, if any. */
  failures: string[];
}