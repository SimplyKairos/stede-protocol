use anchor_lang::prelude::*;

/// Maximum number of blocked recipients per sender per Stede mint.
///
/// Bounded so the PDA has a fixed size. Empty slots are stored as
/// `Pubkey::default()`. A real user almost never blocks more than a handful
/// of recipients; 32 gives substantial headroom without bloating the account.
pub const MAX_BLOCKED: usize = 32;

/// One BlockList PDA per (sender, stede_mint) pair.
///
/// Stores up to MAX_BLOCKED recipient wallets the sender has chosen to never
/// send to. The hook CPI's `check_transfer` reads this list and rejects
/// transfers to any blocked recipient.
#[account]
#[derive(InitSpace)]
pub struct BlockList {
    /// The wallet this block list belongs to (the sender).
    pub sender: Pubkey,

    /// The Stede mint this block list applies to. Block lists are per-currency.
    pub stede_mint: Pubkey,

    /// Fixed-size array of blocked recipient wallets.
    /// Pubkey::default() (all-zero) marks an empty slot.
    pub blocked: [Pubkey; MAX_BLOCKED],

    /// Number of non-empty entries (always <= MAX_BLOCKED).
    pub count: u8,

    /// PDA bump.
    pub bump: u8,
}

impl BlockList {
    pub const SEED_PREFIX: &'static [u8] = b"rule_block_handle";

    pub fn pda(sender: &Pubkey, stede_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, sender.as_ref(), stede_mint.as_ref()],
            program_id,
        )
    }

    /// Returns Some(index) if the wallet is on the block list, None otherwise.
    pub fn find(&self, wallet: &Pubkey) -> Option<usize> {
        self.blocked
            .iter()
            .position(|w| w == wallet && *w != Pubkey::default())
    }

    /// Returns Some(index) of the first empty slot, None if the list is full.
    pub fn first_empty(&self) -> Option<usize> {
        self.blocked.iter().position(|w| *w == Pubkey::default())
    }
}