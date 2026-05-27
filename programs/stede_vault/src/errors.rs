use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Vault is paused.")]
    Paused,

    #[msg("Wrap amount must be greater than zero.")]
    ZeroAmount,

    #[msg("Insufficient locked underlying to unwrap requested amount.")]
    InsufficientLocked,

    #[msg("Arithmetic overflow.")]
    Overflow,

    #[msg("Unauthorized: admin only.")]
    Unauthorized,

    #[msg("Provided mint does not match the vault's configured mint.")]
    MintMismatch,
}