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