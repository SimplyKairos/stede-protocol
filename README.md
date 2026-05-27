# Stede Protocol

**Money that refuses the wrong move.**

Stede is an open protocol on Solana where users set rules for their own transfers — daily spending limits, recipient block lists, more rules coming — and the chain enforces those rules at the token level. Built on Token-2022 with the SPL Transfer Hook extension.

Stede is not a wallet. It's the rule layer that any wallet, any DEX, any payment app can integrate.

---

## How it works

Every Stede dollar transfer routes through a transfer hook program before completing. The hook checks the sender's active rules. If any rule rejects the transfer, the entire transaction reverts atomically. Nothing moves.

```
┌──────────────┐    transferChecked    ┌──────────────┐
│              │ ───────────────────▶  │              │
│   Sender     │                       │  Token-2022  │
│              │                       │              │
└──────────────┘                       └──────┬───────┘
                                              │ CPI
                                              ▼
                                       ┌──────────────┐
                                       │  stede_hook  │
                                       │              │
                                       └──┬─────────┬─┘
                                          │ CPI     │ CPI
                                          ▼         ▼
                              ┌─────────────┐   ┌──────────────┐
                              │ daily_limit │   │ block_handle │
                              │    rule     │   │     rule     │
                              └─────────────┘   └──────────────┘
```

If either rule returns `Err`, the transfer reverts. Atomic — either everything happens or nothing does. The chain refused.

---

## Architecture

Five Anchor programs deployed to Solana devnet:

| Program | Purpose | Program ID |
|---|---|---|
| `stede_vault` | Wraps stablecoins (USDC, AUDD) into Stede dollars | `hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai` |
| `stede_hook` | Transfer hook that enforces rules on every transfer | `Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv` |
| `stede_handle_registry` | `@handle` system — human-readable identifiers for wallets | `FPpVV8GotRq2cPppWBp1juVun4SC193TpaEPodrmHYaA` |
| `stede_rule_daily_limit` | Per-sender daily transfer limit | `DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5` |
| `stede_rule_block_handle` | Per-sender recipient block list | `J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq` |

See [`docs/deployed-programs.md`](docs/deployed-programs.md) for Solscan links.

Full architecture in [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## The user flow

The protocol is currently exercised end-to-end by an integration test that runs against live devnet — [`tests/stede_e2e.ts`](tests/stede_e2e.ts). The 9 user-facing steps:

1. Alice and Bob each claim a `@handle`
2. Alice wraps 200 USDC into 200 Stede USDC
3. Alice sets her daily transfer limit to $50
4. Alice adds Bob's wallet to her block list
5. Alice tries to send $30 to Bob → **chain refuses** (`RecipientBlocked`)
6. Alice removes Bob from her block list
7. Alice sends $40 to Bob → succeeds
8. Alice tries to send $20 to Bob → **chain refuses** (`DailyLimitExceeded`, would total $60)
9. Alice unwraps 100 Stede USDC back to 100 USDC

Both rejections happen on-chain, before any tokens move. Verifiable on Solana Explorer.

---

## Why this matters

Stablecoins on Solana today are technically functional but emotionally hostile. Approve once, the chain will execute anything — including transfers you'd reverse if you could.

Stede inverts that. The sender's rules are stored on-chain, owned by the sender, and enforced by the chain itself. No multisig, no time delay, no smart contract wallet. Just the token program asking the rule program "should this go through?" before completing.

This is what *programmable money* should mean for ordinary users — not "smart contracts" as a developer abstraction but **a finger on the pause button, baked into every dollar.**

---

## Try it on devnet

The fastest way to see this work is to run the integration test against the already-deployed devnet programs.

```bash
git clone https://github.com/SimplyKairos/stede-protocol
cd stede-protocol
yarn install

# Configure your Solana CLI to devnet
solana config set --url https://api.devnet.solana.com

# Set up a funded devnet wallet (~0.5 SOL needed for the test)
solana-keygen new --outfile ~/.config/solana/devnet-stede.json

# Drop your wallet path into Anchor.toml's [provider.wallet] field

# Run the 9-step end-to-end test against deployed devnet programs
anchor test --skip-local-validator --skip-deploy --provider.cluster devnet
```

Expected output: 61 tests passing across all 5 programs + the canonical 9-step e2e flow.

---

## Integration

The TypeScript SDK in [`sdk/`](sdk/) wraps all 5 programs behind one client:

```typescript
import { StedeClient } from "@stede/sdk";
import { AnchorProvider } from "@coral-xyz/anchor";

const client = new StedeClient(provider);
await client.init();

// Resolve a handle to its owner
const record = await client.resolveHandle("alice");
console.log(record.owner.toBase58());

// Set a daily limit
await client.setDailyLimit(stedeMint, new BN(50_000_000));

// Add a recipient to your block list
await client.addBlockedWallet(stedeMint, bobPubkey);

// Fetch all rule state for a sender
const rules = await client.getRulesForSender(senderPubkey, stedeMint);
```

The full SDK source is in `sdk/src/`. See [`sdk/src/client.ts`](sdk/src/client.ts) for the complete API.

---

## Status

**This is devnet, not mainnet.** Code is unaudited. Some design decisions are explicitly marked as upgrade paths (see `ARCHITECTURE.md`).

**Mainnet launch: June 18, 2026.** Pre-launch audit by a friend-developer, then deployment of the same 5 programs to mainnet against real USDC and AUDD.

---

## License

Apache License 2.0. See [`LICENSE`](LICENSE).

---

## Contact

Built solo by [@SimplyKairos](https://x.com/SimplyKairos).

For integration questions, technical issues, or partnership conversations: open a GitHub issue or DM on X.
