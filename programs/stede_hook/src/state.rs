//! State for stede_hook.
//!
//! Day 3 has no persistent state of its own — the ExtraAccountMetaList is
//! managed by the spl-tlv-account-resolution crate.
//!
//! Day 4 onwards will add per-sender rule registries here.

use anchor_lang::prelude::*;

/// Seed prefix for the ExtraAccountMetaList PDA.
/// Token-2022's transfer hook interface looks for this exact seed when
/// resolving extra accounts during a transfer.
pub const EXTRA_ACCOUNT_META_LIST_SEED: &[u8] = b"extra-account-metas";

/// Helper to derive the ExtraAccountMetaList PDA for a given Stede mint.
pub fn extra_account_meta_list_pda(stede_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[EXTRA_ACCOUNT_META_LIST_SEED, stede_mint.as_ref()],
        program_id,
    )
}