# @stede/sdk

Programmable stablecoin rules on Solana. Wrap USDC into a Stede dollar, set spending rules, and the chain enforces them on every transfer.

**npm:** `@stede/sdk` v0.3.5
**License:** Apache 2.0
**Repo:** [github.com/SimplyKairos/stede-protocol](https://github.com/SimplyKairos/stede-protocol)

---

## Install

```bash
npm install @stede/sdk
```

Peer dependencies: `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`.

---

## Quick start

```typescript
import { AnchorProvider } from "@coral-xyz/anchor";
import { StedeClient } from "@stede/sdk";

// 1. Create provider (your app's wallet + connection)
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});

// 2. Create client (single AnchorProvider arg, nothing else)
const client = new StedeClient(provider);

// 3. Initialize (loads all 9 program IDLs)
await client.init();

// 4. Wrap USDC into Stede dollars
const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // devnet
await client.wrap(usdcMint, new BN(10_000_000)); // 10 USDC (6 decimals)

// 5. Set a daily cap of $50
const vault = await client.getVault(usdcMint);
await client.setDailyLimit(vault.stedeMint, new BN(50_000_000));

// 6. Send to a handle
await client.transfer("@alice", vault.stedeMint, new BN(5_000_000), 6);
```

---

## Constructor

```typescript
const client = new StedeClient(provider: AnchorProvider);
```

Takes a single `AnchorProvider`. Not `{ connection, wallet }`. Not two args. One provider.

Call `await client.init()` before any other method. This loads all 9 Anchor IDLs.

---

## Core concepts

**Underlying mint vs Stede mint.** USDC is the underlying mint. When you wrap it, you get a Stede mint (a Token-2022 mint with a transfer hook). Rules are keyed on the Stede mint. Wrap/unwrap/getVault take the underlying mint. Order matters: wrap first, then read `vault.stedeMint`, then configure rules.

**Fail-open.** A rule that isn't configured auto-passes. Unset rules never block funds.

**Transfer hook.** Every transfer of a Stede token triggers the hook program, which calls each rule program via CPI. Any rule can revert the entire transaction. This applies to all transfers of the token, not just transfers through the Stede app.

**Handles.** Users claim `@handle` names that resolve to wallet addresses. Transfers use handles, not raw pubkeys.

---

## Wrapping and unwrapping

### `wrap(underlyingMint, amount)`

Wraps an underlying stablecoin (e.g. USDC) into Stede dollars 1:1.

```typescript
await client.wrap(
  usdcMint,        // PublicKey of the underlying mint
  new BN(10_000_000) // amount in base units (10 USDC at 6 decimals)
);
```

Creates the user's Stede ATA if it doesn't exist. Deposits the underlying token into the vault. Mints the equivalent Stede tokens.

### `unwrap(underlyingMint, amount)`

Burns Stede dollars and returns the underlying stablecoin 1:1.

```typescript
await client.unwrap(usdcMint, new BN(5_000_000)); // 5 USDC back
```

Non-custodial. No approval needed. Funds are always redeemable.

### `getVault(underlyingMint)`

Returns the vault state for a given underlying mint.

```typescript
const vault = await client.getVault(usdcMint);
// vault.stedeMint   -> PublicKey of the Stede token mint
// vault.authority    -> vault PDA
```

---

## Transfers

### `transfer(toHandle, stedeMint, amount, decimals)`

Resolves the handle, ensures the recipient's ATA exists, and submits a hook-aware transfer. The transfer hook runs every rule the sender has configured.

```typescript
await client.transfer(
  "@alice",          // recipient handle
  vault.stedeMint,   // Stede mint (not underlying)
  new BN(5_000_000), // amount in base units
  6                  // decimals
);
```

If any rule refuses, the entire transaction reverts. Nothing partial, nothing leaked.

For new recipients (no existing Stede ATA), the SDK creates the ATA in a separate confirmed transaction before building the transfer.

### `previewTransfer(client, stedeMint, handle, amount, decimals)`

Simulates the transfer without submitting. Returns one of three outcomes:

```typescript
const preview = await client.previewTransfer(
  client, stedeMint, "@alice", new BN(50_000_000), 6
);

if (preview.approved) {
  // Transfer would succeed
}

if (preview.refusedBy) {
  // A rule would block it
  // preview.refusedBy: "daily_limit" | "block_list" | "cooloff"
  //                  | "slow_send" | "night_mode" | "friend_gate"
  // preview.reason: human-readable string
}

if (preview.error) {
  // Infrastructure/RPC error, not a rule refusal
}
```

Three-way result. Do not render an infra error as a rule refusal.

### `buildFriendGateTransfer(toHandle, stedeMint, amount, friendHandle)`

Builds an unsigned two-instruction transaction for friend-gate co-signed transfers.

```typescript
const { unsignedTx, needsCoSignFrom } = await client.buildFriendGateTransfer(
  "@alice", vault.stedeMint, new BN(100_000_000), "@bob"
);
```

**Note:** Full co-sign flow is not yet live in v1. Friend gate currently blocks over-threshold sends rather than routing a co-sign request.

---

## Handles

### `claimHandle(handle)`

Claims a `@handle` for the connected wallet.

```typescript
await client.claimHandle("alice"); // claims @alice
```

### `releaseHandle(handle)`

Releases a handle, making it available for others.

### `resolveHandle(handle)`

Resolves a handle to a wallet address.

```typescript
const wallet: PublicKey = await client.resolveHandle("alice");
```

### `resolveWallet(wallet)`

Reverse lookup: wallet address to handle.

```typescript
const handle: string | null = await client.resolveWallet(walletPubkey);
```

---

## Rules

All rules are keyed on the Stede mint, not the underlying mint.

### Daily cap

Limits total outgoing transfers within a rolling 24-hour window.

```typescript
// Set a $50/day cap
await client.setDailyLimit(stedeMint, new BN(50_000_000));

// Disable (writes a HUGE_LIMIT sentinel, does not close the PDA)
await client.setDailyLimit(stedeMint, new BN(1_000_000_000));
```

### Block list

Refuses transfers to specific handles or wallets. Max 32 entries.

```typescript
await client.addBlockedWallet(stedeMint, blockedPubkey);
await client.removeBlockedWallet(stedeMint, blockedPubkey);
```

### Cool-off

Delays withdrawals by a configured period (seconds up to 7 days).

```typescript
await client.setCooloff(
  stedeMint,
  new BN(10_000_000),  // threshold: $10+
  new BN(86400)        // delay: 24 hours in seconds
);
```

### Slow send

Holds the first transfer to a new recipient for a configured delay.

```typescript
// Enable with a 600-second (10-minute) delay
await client.setSlowSend(stedeMint, new BN(600));

// Register a known recipient (bypasses the delay)
await client.registerRecipient(stedeMint, recipientPubkey);

// Disable (closes the config PDA entirely)
await client.disableSlowSend(stedeMint);
```

### Night mode

Blocks transfers during configured hours.

```typescript
// Block sends between midnight and 6am (UTC offset in seconds)
await client.setNightMode(
  stedeMint,
  new BN(0),     // start: 00:00
  new BN(21600)  // end: 06:00 (6 * 3600)
);

await client.disableNightMode(stedeMint);
```

### Friend gate

Requires a trusted contact to co-approve transfers above a threshold.

```typescript
await client.setFriendGate(
  stedeMint,
  new BN(50_000_000),  // threshold: $50+
  friendWalletPubkey
);

await client.disableFriendGate(stedeMint);
```

### Reading rule state

```typescript
const rules = await client.getRulesForSender(stedeMint);
// Returns the on-chain state of all configured rules for the sender
```

---

## Program IDs

All 9 programs. Same IDs on devnet and mainnet.

| Program | ID |
|---|---|
| Vault | `hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai` |
| Hook | `Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv` |
| Handle registry | `FPpVV8GotRq2cPppWBp1juVun4SC193TpaEPodrmHYaA` |
| Daily cap | `DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5` |
| Block list | `J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq` |
| Cool-off | `4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg` |
| Slow send | `GWhPqirCmLHiYQdHsPXNzG2YexVR6cXsspps8YhPhaRb` |
| Night mode | `8AEdTE3avK5jhVy8osXHfZYnvtn73SSVrRxwuTaytaGu` |
| Friend gate | `C2ETjCNkHYdPzNZxJtufmnc3j5at2osxG6csrS9StNk5` |

---

## Error handling

Transfer errors fall into two categories:

**Rule refusals:** The transfer hook detected a rule violation and reverted the transaction. The error logs contain the rule's Anchor error name (e.g. `DailyLimitExceeded`, `RecipientBlocked`, `WithinBlockedWindow`). Use `classifyRefusal()` to identify which rule refused.

**Infrastructure errors:** RPC failures, insufficient SOL for fees, account resolution failures. These are not rule refusals and should not be displayed as such.

```typescript
try {
  await client.transfer("@alice", stedeMint, amount, 6);
} catch (err) {
  const rule = client.classifyRefusal(err.logs?.join("\n") ?? "");
  if (rule) {
    // Rule refused: rule is "daily_limit" | "block_list" | etc.
  } else {
    // Infrastructure error
  }
}
```

---

## Architecture

```
User sets rules --> Rules stored on-chain (per-sender, per-mint PDAs)
                         |
User sends Stede  -------+--> Transfer hook fires
                         |
                   Hook CPIs each rule program
                         |
              All pass? --> Transfer settles
              Any fail? --> Entire transaction reverts
```

The hook program (`Cr1nyt...`) is registered as the transfer hook on the Stede Token-2022 mint. It runs on every transfer of that token, regardless of which app initiated the transfer. Each rule program is called via CPI. The hook passes sender, recipient, amount, and the rule's config PDA. The rule program returns `Ok(())` to pass or an error to refuse.

Rules are fail-open: if a rule's config PDA doesn't exist for the sender, that rule auto-passes.

---

## Notes

- The SDK is TypeScript. Anchor 0.32.1.
- Token-2022 with transfer hook extensions.
- 105 tests passing against devnet.
- Apache 2.0 license.
- No $STEDE token exists or will exist. Stede dollars are wrapped USDC (or AUDD).
