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

/** Cool-off rule state. */
export interface CooloffRecord {
  /** Transfers at or above this amount trigger the cool-off timer. */
  threshold: BN;
  /** How long the cool-off lasts, in seconds. */
  durationSeconds: BN;
  /** Unix timestamp of the most recent large transfer. */
  lastLargeTransferAt: BN;
}

/** Slow Send (new recipient delay) config state. */
export interface SlowSendRecord {
  /** How long a newly-registered recipient must age before transfers, in seconds. */
  delaySeconds: BN;
}

/** Night Mode (time window) config state. */
export interface NightModeRecord {
  /** Hour (0-23 UTC) the blocked window starts. */
  startHour: number;
  /** Hour (0-23 UTC) the blocked window ends. */
  endHour: number;
}

/** Friend Gate config state. */
export interface FriendGateRecord {
  /** Transfers at or above this amount require the friend's co-signature. */
  threshold: BN;
  /** The designated co-signer wallet. */
  friendWallet: PublicKey;
}

/** Aggregated rule state for a sender on a given Stede mint. */
export interface SenderRules {
  /** Daily limit, or null if not set. */
  dailyLimit: DailyLimitRecord | null;
  /** Block list, or null if empty/uninitialized. */
  blockList: BlockListRecord | null;
  /** Cool-off, or null if not set. */
  cooloff: CooloffRecord | null;
  /** Slow Send, or null if not set. */
  slowSend: SlowSendRecord | null;
  /** Night Mode, or null if not set. */
  nightMode: NightModeRecord | null;
  /** Friend Gate, or null if not set. */
  friendGate: FriendGateRecord | null;
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
  /** True if the simulated transfer would succeed. */
  approved: boolean;
  /** Which rule refused, if any: "daily_limit" | "block_list" | "cooloff" | "slow_send" | "night_mode" | "friend_gate" | null. */
  refusedBy: string | null;
  /** Human-readable explanation of the result. */
  message: string;
  /**
   * True when the preview failed for a reason that is NOT a rule rejection —
   * e.g. an RPC failure, a missing ATA, a serialization problem, or an
   * unrecognized on-chain error. When `error` is true, `refusedBy` is null and
   * the UI should surface this as a problem to retry, not as a rule that blocked
   * the send.
   */
  error?: boolean;
}