# Deployed Programs

All 9 Stede programs are deployed to Solana devnet and verifiable on Solana Explorer.

## Program registry

| Program | Devnet ID | Deployed | Solscan |
|---|---|---|---|
| `stede_vault` | `hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai` | May 26, 2026 | [view](https://solscan.io/account/hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai?cluster=devnet) |
| `stede_hook` | `Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv` | May 26, 2026 | [view](https://solscan.io/account/Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv?cluster=devnet) |
| `stede_rule_daily_limit` | `DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5` | May 26, 2026 | [view](https://solscan.io/account/DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5?cluster=devnet) |
| `stede_rule_block_handle` | `J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq` | May 26, 2026 | [view](https://solscan.io/account/J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq?cluster=devnet) |
| `stede_handle_registry` | `FPpVV8GotRq2cPppWBp1juVun4SC193TpaEPodrmHYaA` | May 27, 2026 | [view](https://solscan.io/account/FPpVV8GotRq2cPppWBp1juVun4SC193TpaEPodrmHYaA?cluster=devnet) |
| `stede_rule_cooloff` | `4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg` | — | [view](https://solscan.io/account/4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg?cluster=devnet) |
| `stede_rule_new_recipient_delay` | `GWhPqirCmLHiYQdHsPXNzG2YexVR6cXsspps8YhPhaRb` | — | [view](https://solscan.io/account/GWhPqirCmLHiYQdHsPXNzG2YexVR6cXsspps8YhPhaRb?cluster=devnet) |
| `stede_rule_time_window` | `8AEdTE3avK5jhVy8osXHfZYnvtn73SSVrRxwuTaytaGu` | — | [view](https://solscan.io/account/8AEdTE3avK5jhVy8osXHfZYnvtn73SSVrRxwuTaytaGu?cluster=devnet) |
| `stede_rule_friend_gate` | `C2ETjCNkHYdPzNZxJtufmnc3j5at2osxG6csrS9StNk5` | — | [view](https://solscan.io/account/C2ETjCNkHYdPzNZxJtufmnc3j5at2osxG6csrS9StNk5?cluster=devnet) |

All IDLs are uploaded on-chain and can be fetched with:

```bash
anchor idl fetch <PROGRAM_ID> --provider.cluster devnet
```

## Test coverage

105 integration tests passing on devnet across all 9 programs:

| Test file | Coverage |
|---|---|
| `tests/stede_vault.ts` | Wrap, unwrap, pause/unpause, accounting |
| `tests/stede_hook.ts` | Hook initialization, transfer interception, multi-rule CPI |
| `tests/stede_rule_daily_limit.ts` | Limit setting, accumulation, rejection paths |
| `tests/stede_rule_block_handle.ts` | Block list management, recipient checks |
| `tests/stede_rule_cooloff.ts` | Cool-off configuration, withdrawal delay enforcement |
| `tests/stede_rule_new_recipient_delay.ts` | Slow send: first-send hold, recipient registration |
| `tests/stede_rule_time_window.ts` | Night mode: in-window vs out-of-window sends |
| `tests/stede_rule_friend_gate.ts` | Threshold gating, trusted-handle checks |
| `tests/stede_handle_registry.ts` | Handle claim/release/transfer, validation, anti-squat deposit |
| `tests/stede_e2e.ts` | Canonical user flow + scaffolding steps |
| **Total** | **105 tests** — full protocol surface, real devnet |

## Run the test suite yourself

```bash
git clone https://github.com/SimplyKairos/stede-protocol
cd stede-protocol
yarn install
solana config set --url https://api.devnet.solana.com
anchor test --skip-local-validator --skip-deploy --provider.cluster devnet
```

You'll need a devnet wallet with ~0.5 SOL to cover transaction fees during the test run.

## Upgrade paths (documented intentionally)

Some design decisions in v1 are explicit upgrade paths, not final state:

1. **Vault-issued Stede mints don't yet have the transfer hook extension wired in.** The vault produces plain Token-2022 mints in v1. Week 2 of the build adds the hook extension to the vault's mint creation. The 9-step e2e test demonstrates the architecture with a manually-wired hook mint.

2. **Anti-squat deposit refunds entirely on handle release.** Future versions may split the deposit into rent + protocol revenue.

3. **Block list is per-(sender, mint) and capped at 32 entries.** Sized for typical user behavior; can be expanded if needed.

These are noted to be transparent with auditors and integrators about what's v1 vs. what's the trajectory.
