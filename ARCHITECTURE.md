# Stede Protocol Architecture

## System overview

Nine Anchor programs compose into a rule-enforcement layer for stablecoin transfers on Solana:

1. `stede_handle_registry` — `@handle` → wallet mapping via PDAs
2. `stede_vault` — wrap/unwrap USDC and AUDD into hook-equipped Stede mints
3. `stede_hook` — Token-2022 transfer hook; reads rule reference, CPIs into each enabled rule program
4. `stede_rule_daily_limit` — refuses sends exceeding a configured 24-hour cap
5. `stede_rule_block_handle` — refuses sends to handles/wallets on the user's block list (up to 32 per wallet)
6. `stede_rule_cooloff` — delays withdrawals by a configured period (seconds up to 7 days)
7. `stede_rule_new_recipient_delay` — slow send: a 10-minute hold on the first send to a new handle (anti-phishing)
8. `stede_rule_time_window` — night mode: blocks sends during configured local hours
9. `stede_rule_friend_gate` — sends above a threshold need a trusted handle to co-approve (v1: labeled block-only; co-sign coming)

All six rules **fail open**: if a sender hasn't configured a rule, its config PDA doesn't exist and that rule auto-passes. Only opted-in rules can stop a transfer, and the hook enforces them atomically — any refusal reverts the whole transfer.

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

## Built since v1

- The full six-rule set — cool-off, slow send, night mode, and friend gate — has landed alongside daily cap and block list.
- Hook-equipped mint wiring: the vault issues Stede mints with the transfer hook extension, and the hook CPIs into each enabled rule program.

## Still out of scope

- Composite/oracle/multisig rule kinds
- Friend-gate co-sign (v1 is labeled block-only)
- Mainnet deploy → upcoming, after an external security review
- Formal security review → planned, not yet done