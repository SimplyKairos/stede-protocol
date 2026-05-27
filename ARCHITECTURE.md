# Stede Protocol Architecture

## System overview

Five Anchor programs compose into a rule-enforcement layer for stablecoin transfers on Solana:

1. `stede_handle_registry` — `@handle` → wallet mapping via PDAs
2. `stede_vault` — wrap/unwrap USDC and AUDD into hook-equipped Stede mints
3. `stede_hook` — Token-2022 transfer hook; reads rule reference, CPIs into rule programs
4. `stede_rule_daily_limit` — refuses sends exceeding configured daily cap
5. `stede_rule_block_handle` — refuses sends to handles on user's block list

## Locked decisions

1. **Multi-stablecoin via parameterized vault.** `stede_vault` is mint-agnostic. We deploy two instances at runtime: USDC and AUDD. Each gets a separate Stede mint, both pointing to the same `stede_hook` program.

2. **Handle storage.** One PDA per handle, seeded `["handle", handle_string]`. Contains `{ owner: Pubkey, claimed_at: i64 }`. Reverse PDA per wallet, seeded `["wallet", wallet_pubkey]`, contains the handle owned by that wallet. O(1) lookup both directions.

3. **Rule dispatch.** Each rule is a separate program. Hook reads the active rule list from a per-sender PDA on the hook program, then CPIs into each rule's `check_transfer` instruction. Any rule that errors reverts the entire transfer.

4. **Handle format.** `@<alphanumeric_lowercase>`, 3-20 chars, no special characters except underscore. Cannot start with a digit. Reserved words: `stede`, `admin`, `team`, `support`, `null`, `system`.

5. **Anti-squat deposit.** Claiming a handle locks 0.01 SOL in the handle PDA. Returned on release.

## Why these choices

- **Separate programs per rule.** Anyone can ship `stede_rule_<anything>` and it plugs in. Protocol property, not an app feature.
- **PDA-per-handle.** Simple, on-chain, no off-chain index needed. Migration to Merkle tree is the fallback if account costs become a concern at scale.
- **Per-currency rule state.** A user's daily cap is in their primary currency. No cross-currency rule math in v1.

## Out of scope for v1

- Composite/oracle/multisig rule kinds → Week 2
- Mainnet deploy → Week 4 (Day 22)
- Frontend → Week 3
- Formal audit → post-launch, revenue-funded