import { PublicKey } from "@solana/web3.js";

/**
 * Centralized PDA derivation helpers.
 *
 * All PDA derivations the SDK uses, in one place. Frontend never touches
 * these directly — it calls `client.X()` and the client derives internally.
 *
 * Seeds must match exactly what each Rust program uses; mismatched bytes
 * mean the derived address points at a non-existent account.
 */

// Program IDs (locked, will be the same on devnet and mainnet)
export const STEDE_VAULT_PROGRAM_ID = new PublicKey(
  "hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai"
);
export const STEDE_HOOK_PROGRAM_ID = new PublicKey(
  "Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv"
);
export const STEDE_HANDLE_REGISTRY_PROGRAM_ID = new PublicKey(
  "FPpVV8GotRq2cPppWBp1juVun4SC193TpaEPodrmHYaA"
);
export const STEDE_RULE_DAILY_LIMIT_PROGRAM_ID = new PublicKey(
  "DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5"
);
export const STEDE_RULE_BLOCK_HANDLE_PROGRAM_ID = new PublicKey(
  "J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq"
);

/** Vault PDA seeded by underlying mint. */
export function deriveVaultPda(underlyingMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), underlyingMint.toBuffer()],
    STEDE_VAULT_PROGRAM_ID
  );
  return pda;
}

/** Forward handle PDA: name → owner. */
export function deriveHandlePda(name: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("handle"), Buffer.from(name)],
    STEDE_HANDLE_REGISTRY_PROGRAM_ID
  );
  return pda;
}

/** Reverse handle PDA: wallet → handle. */
export function deriveReversePda(wallet: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), wallet.toBuffer()],
    STEDE_HANDLE_REGISTRY_PROGRAM_ID
  );
  return pda;
}

export const STEDE_RULE_COOLOFF_PROGRAM_ID = new PublicKey(
  "4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg"
);
export const STEDE_RULE_NEW_RECIPIENT_DELAY_PROGRAM_ID = new PublicKey(
  "GWhPqirCmLHiYQdHsPXNzG2YexVR6cXsspps8YhPhaRb"
);
export const STEDE_RULE_TIME_WINDOW_PROGRAM_ID = new PublicKey(
  "8AEdTE3avK5jhVy8osXHfZYnvtn73SSVrRxwuTaytaGu"
);
export const STEDE_RULE_FRIEND_GATE_PROGRAM_ID = new PublicKey(
  "C2ETjCNkHYdPzNZxJtufmnc3j5at2osxG6csrS9StNk5"
);

/** Daily limit PDA per (sender, stedeMint). */
export function deriveDailyLimitPda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("rule_daily_limit"),
      sender.toBuffer(),
      stedeMint.toBuffer(),
    ],
    STEDE_RULE_DAILY_LIMIT_PROGRAM_ID
  );
  return pda;
}

/** Block list PDA per (sender, stedeMint). */
export function deriveBlockListPda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("rule_block_handle"),
      sender.toBuffer(),
      stedeMint.toBuffer(),
    ],
    STEDE_RULE_BLOCK_HANDLE_PROGRAM_ID
  );
  return pda;
}

/** ExtraAccountMetaList PDA for a Stede mint with transfer hook. */
export function deriveExtraAccountMetaListPda(stedeMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), stedeMint.toBuffer()],
    STEDE_HOOK_PROGRAM_ID
  );
  return pda;
}

/** Cool-off PDA per (sender, stedeMint). */
export function deriveCooloffPda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rule_cooloff"), sender.toBuffer(), stedeMint.toBuffer()],
    STEDE_RULE_COOLOFF_PROGRAM_ID
  );
  return pda;
}

/** Slow Send config PDA per (sender, stedeMint). */
export function deriveSlowSendConfigPda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("slow_send_config"), sender.toBuffer(), stedeMint.toBuffer()],
    STEDE_RULE_NEW_RECIPIENT_DELAY_PROGRAM_ID
  );
  return pda;
}

/** Slow Send contact PDA per (sender, recipient, stedeMint). */
export function deriveSlowSendContactPda(
  sender: PublicKey,
  recipient: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("slow_send_contact"),
      sender.toBuffer(),
      recipient.toBuffer(),
      stedeMint.toBuffer(),
    ],
    STEDE_RULE_NEW_RECIPIENT_DELAY_PROGRAM_ID
  );
  return pda;
}

/** Night Mode (time window) config PDA per (sender, stedeMint). */
export function deriveTimeWindowPda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("time_window"), sender.toBuffer(), stedeMint.toBuffer()],
    STEDE_RULE_TIME_WINDOW_PROGRAM_ID
  );
  return pda;
}

/** Friend Gate config PDA per (sender, stedeMint). */
export function deriveFriendGatePda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rule_friend_gate"), sender.toBuffer(), stedeMint.toBuffer()],
    STEDE_RULE_FRIEND_GATE_PROGRAM_ID
  );
  return pda;
}