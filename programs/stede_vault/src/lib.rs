use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai");

#[program]
pub mod stede_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        initialize_vault_handler(ctx)
    }

    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        wrap_handler(ctx, amount)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        unwrap_handler(ctx, amount)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        set_paused_handler(ctx, paused)
    }
}