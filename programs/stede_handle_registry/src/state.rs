use anchor_lang::prelude::*;

/// Forward PDA: seeds = ["handle", name.as_bytes()]
///
/// Stores the wallet that owns a given handle, plus when it was claimed.
/// The anti-squat deposit is the lamports balance of this account beyond
/// the minimum rent — refunded entirely on `release_handle`.
#[account]
#[derive(InitSpace)]
pub struct Handle {
    /// The wallet that owns this handle.
    pub owner: Pubkey,

    /// The handle itself, e.g. "kay". Max 20 chars.
    #[max_len(20)]
    pub name: String,

    /// Unix timestamp (seconds) when this handle was first claimed.
    pub claimed_at: i64,

    /// PDA bump.
    pub bump: u8,
}

impl Handle {
    pub const SEED_PREFIX: &'static [u8] = b"handle";

    pub fn pda(name: &str, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, name.as_bytes()],
            program_id,
        )
    }
}

/// Reverse PDA: seeds = ["wallet", wallet_pubkey]
///
/// Stores the handle owned by a given wallet. Updated in lockstep with the
/// forward PDA. One Reverse per wallet — claiming a second handle from the
/// same wallet fails because this PDA already exists.
#[account]
#[derive(InitSpace)]
pub struct Reverse {
    /// The handle this wallet owns. Max 20 chars.
    #[max_len(20)]
    pub handle: String,

    /// PDA bump.
    pub bump: u8,
}

impl Reverse {
    pub const SEED_PREFIX: &'static [u8] = b"wallet";

    pub fn pda(wallet: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, wallet.as_ref()],
            program_id,
        )
    }
}