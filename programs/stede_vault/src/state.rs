use anchor_lang::prelude::*;

/// Vault config + locked-amount accounting.
///
/// One Vault per stablecoin mint. Same `stede_vault` program serves
/// USDC, AUDD, or any future stablecoin — just initialize a new vault
/// keyed to a different mint.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// The wallet that can pause/unpause this vault. Set at initialization,
    /// transferred to a multisig before mainnet launch.
    pub admin: Pubkey,

    /// The underlying stablecoin mint (e.g. USDC, AUDD).
    pub underlying_mint: Pubkey,

    /// The Token-2022 Stede mint issued against the underlying.
    /// Mint authority is this Vault PDA.
    pub stede_mint: Pubkey,

    /// The token account that holds the locked underlying stablecoin.
    /// Authority is this Vault PDA.
    pub token_vault: Pubkey,

    /// Total amount of underlying currently locked.
    /// Invariant: token_vault.balance == locked_amount == stede_mint.supply.
    pub locked_amount: u64,

    /// Emergency pause flag. When true, wrap and unwrap both reject.
    pub paused: bool,

    /// PDA bump.
    pub bump: u8,
}

impl Vault {
    /// Seed prefix for the Vault PDA.
    pub const SEED_PREFIX: &'static [u8] = b"vault";

    /// Derive the Vault PDA for a given underlying mint.
    pub fn pda(underlying_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, underlying_mint.as_ref()],
            program_id,
        )
    }
}