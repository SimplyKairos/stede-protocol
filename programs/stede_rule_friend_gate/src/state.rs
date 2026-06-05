use anchor_lang::prelude::*;

/// Config PDA: one per (sender, stede_mint).
/// Seeds: ["rule_friend_gate", sender, stede_mint]
///
/// Transfers at or above `threshold` require `friend_wallet` to co-sign the
/// transaction. Below threshold, transfers pass freely. If this PDA does not
/// exist, the rule is not enabled and auto-passes (opt-in).
#[account]
#[derive(InitSpace)]
pub struct FriendGate {
    /// The wallet this rule belongs to.
    pub sender: Pubkey,

    /// The Stede mint this rule applies to.
    pub stede_mint: Pubkey,

    /// Transfers at or above this amount require the friend's co-signature.
    pub threshold: u64,

    /// The designated co-signer wallet.
    pub friend_wallet: Pubkey,

    /// PDA bump.
    pub bump: u8,
}

impl FriendGate {
    pub const SEED_PREFIX: &'static [u8] = b"rule_friend_gate";

    pub fn pda(sender: &Pubkey, stede_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, sender.as_ref(), stede_mint.as_ref()],
            program_id,
        )
    }
}