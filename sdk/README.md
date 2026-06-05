# @stede/sdk

**TypeScript SDK for the Stede protocol — consumer money rules on Solana.**

Version `0.3.5` · Apache-2.0

One `StedeClient` wraps all nine Stede programs (vault, transfer hook, handle registry, and six rule programs) behind a single class. It handles PDA derivation, Token-2022 ATA setup, and the hook-aware transfer build so app code can stay focused on UX.

> **Status: devnet, unaudited.** The programs this SDK talks to are deployed on Solana **devnet** and have **not** been security-reviewed. An external audit is a planned milestone before any mainnet deployment. Read it, run it on devnet — do not put real funds behind it. See the [root README](https://github.com/SimplyKairos/stede-protocol/blob/main/README.md#status).

---

## Install

```bash
npm install @stede/sdk
```

Peer dependencies (you almost certainly already have these in a Solana app):

```bash
npm install @coral-xyz/anchor @solana/spl-token @solana/web3.js bn.js
```

---

## Quick start

Construct the client with an `AnchorProvider`, call `init()` once to load the program IDLs from chain, then use any method.

```typescript
import { StedeClient } from "@stede/sdk";
import { AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// In a browser app, build the provider from your wallet adapter instead.
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), {
  commitment: "confirmed",
});

const client = new StedeClient(provider);
await client.init(); // loads all 9 program IDLs — required before any other call
```

The constructor takes a single argument:

```typescript
new StedeClient(provider: AnchorProvider)
```

All write methods sign with `provider.wallet` and return a `TransactionSignature`. All read methods return data (or `null` when the account doesn't exist).

---

## Handles

A `@handle` is a human-readable identifier that resolves to an owner wallet.

```typescript
// Resolve a handle → owner record (null if unclaimed)
const record = await client.resolveHandle("alice");
if (record) {
  console.log(record.name, record.owner.toBase58(), record.claimedAt);
}

// Resolve a wallet → its handle string (null if none)
const handle = await client.resolveWallet(somePubkey);

// Claim / release a handle for the provider's wallet
await client.claimHandle("alice");
await client.releaseHandle("alice");
```

`resolveHandle(name)` returns:

```typescript
interface HandleRecord {
  name: string;
  owner: PublicKey;
  claimedAt: number; // unix seconds
}
```

---

## Vault — wrap / unwrap

Wrapping locks an underlying stablecoin (e.g. USDC) and mints Stede dollars 1:1; unwrapping burns Stede dollars and releases the underlying. Pass the **underlying** mint — the client looks up the matching vault and Stede mint for you. Amounts are `BN` in base units (USDC has 6 decimals, so `1 USDC = 1_000_000`).

```typescript
const usdcMint = new PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"); // example

// Wrap 200 USDC → 200 Stede USDC
await client.wrap(usdcMint, new BN(200_000_000));

// Unwrap 100 Stede USDC → 100 USDC
await client.unwrap(usdcMint, new BN(100_000_000));

// Read vault state (null if no vault for that underlying)
const vault = await client.getVault(usdcMint);
console.log(vault?.stedeMint.toBase58(), vault?.lockedAmount.toString(), vault?.paused);
```

Signatures:

```typescript
wrap(underlyingMint: PublicKey, amount: BN): Promise<TransactionSignature>
unwrap(underlyingMint: PublicKey, amount: BN): Promise<TransactionSignature>
```

---

## Rules

Every rule is configured against the **Stede** mint (the wrapped token), not the underlying. Each rule is opt-in and can be disabled. Thresholds and limits are `BN` base units; durations are `BN` seconds.

```typescript
const stedeMint = vault!.stedeMint;

// Daily cap — refuse sends over a 24h limit
await client.setDailyLimit(stedeMint, new BN(50_000_000)); // $50/day

// Block list — refuse sends to specific wallets (up to 32)
await client.addBlockedWallet(stedeMint, bobPubkey);
await client.removeBlockedWallet(stedeMint, bobPubkey);

// Cool-off — sends >= threshold trigger a pause of durationSeconds
await client.setCooloff(stedeMint, new BN(100_000_000), new BN(3600)); // >$100 → wait 1h
await client.disableCooloff(stedeMint);

// Slow send — first send to a new recipient must age delaySeconds
await client.setSlowSend(stedeMint, new BN(600));            // 10 min
await client.registerRecipient(stedeMint, recipientPubkey);  // starts their waiting period
await client.disableSlowSend(stedeMint);

// Night mode — block sends during these UTC hours (0–23)
await client.setNightMode(stedeMint, 22, 6); // block 22:00–06:00 UTC
await client.disableNightMode(stedeMint);

// Friend gate — sends >= threshold require friendWallet to co-sign (see caveat below)
await client.setFriendGate(stedeMint, new BN(100_000_000), trustedFriendPubkey);
await client.disableFriendGate(stedeMint);
```

Exact signatures for the two the task calls out:

```typescript
setDailyLimit(stedeMint: PublicKey, limit: BN): Promise<TransactionSignature>
setCooloff(stedeMint: PublicKey, threshold: BN, durationSeconds: BN): Promise<TransactionSignature>
```

### Fail-open

Rules **fail open**. If you haven't set a given rule, its config PDA doesn't exist and that rule auto-passes — only rules you've opted into can ever stop a transfer. Disabling a rule restores that behaviour.

### Reading rule state

```typescript
const rules = await client.getRulesForSender(senderPubkey, stedeMint);
// Each field is null when that rule is unset:
// rules.dailyLimit, rules.blockList, rules.cooloff,
// rules.slowSend, rules.nightMode, rules.friendGate
```

---

## Transfers

`transfer` resolves the recipient handle, creates their Stede ATA if missing, builds the Token-2022 hook-aware transfer, and submits. Pass the Stede mint, a `BN` amount in base units, and the mint's `decimals`.

```typescript
// Send 40 Stede USDC to @bob (USDC = 6 decimals)
await client.transfer("bob", stedeMint, new BN(40_000_000), 6);
```

```typescript
transfer(toHandle: string, stedeMint: PublicKey, amount: BN, decimals: number): Promise<TransactionSignature>
```

### Preview before sending

`previewTransfer` simulates the transfer and reports whether every enabled rule would pass — and if not, which one refused. It does **not** submit.

```typescript
const verdict = await client.previewTransfer("bob", stedeMint, new BN(40_000_000), 6);
if (verdict.approved) {
  // safe to call client.transfer(...)
} else if (verdict.refusedBy) {
  console.log(`Refused by ${verdict.refusedBy}: ${verdict.message}`);
} else {
  // verdict.error === true → not a rule rejection (RPC/ATA/etc), surface as retry
}
```

```typescript
previewTransfer(toHandle: string, stedeMint: PublicKey, amount: BN, decimals: number): Promise<TransferPreview>

interface TransferPreview {
  approved: boolean;
  // "daily_limit" | "block_list" | "cooloff" | "slow_send" | "night_mode" | "friend_gate" | null
  refusedBy: string | null;
  message: string;
  error?: boolean; // true when the failure was NOT a rule (RPC, missing ATA, etc.)
}
```

### Friend-gate caveat

`transfer()` is single-signer. A transfer at or above a configured friend-gate threshold will be **refused** (`previewTransfer` reports `refusedBy: "friend_gate"`), because it needs the trusted friend's co-signature. For those, build the transaction with `buildFriendGateTransfer`, then have the friend co-sign and submit it yourself:

```typescript
const tx = await client.buildFriendGateTransfer(
  "bob",
  stedeMint,
  new BN(150_000_000),
  6,
  trustedFriendPubkey
);
// tx is unsigned and includes a co-sign carrier instruction for the friend.
// Collect both signatures (sender + friend) and submit it yourself.
```

---

## Program IDs

The nine devnet program IDs are exported from the SDK (`STEDE_VAULT_PROGRAM_ID`, `STEDE_HOOK_PROGRAM_ID`, etc.) and derivation helpers (`deriveVaultPda`, `deriveDailyLimitPda`, …) are exported alongside them. The canonical table with Solscan links lives in the [root README](https://github.com/SimplyKairos/stede-protocol/blob/main/README.md#architecture) and [`docs/deployed-programs.md`](https://github.com/SimplyKairos/stede-protocol/blob/main/docs/deployed-programs.md). These IDs are locked — the same on devnet and mainnet.

---

## Full API

This README covers the common path. The complete client — including `resolveWallet`, `claimHandle` / `releaseHandle`, `getVault`, `getRulesForSender`, `getStedeAta`, every rule's `disable*`, `buildFriendGateTransfer`, and `wrap` / `unwrap` — is in [`src/client.ts`](https://github.com/SimplyKairos/stede-protocol/blob/main/sdk/src/client.ts). Public types are in [`src/types.ts`](https://github.com/SimplyKairos/stede-protocol/blob/main/sdk/src/types.ts).

---

## License

Apache License 2.0. See [`LICENSE`](https://github.com/SimplyKairos/stede-protocol/blob/main/LICENSE).
