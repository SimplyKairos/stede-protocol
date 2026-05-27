use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod validation;
pub mod instructions;

use instructions::*;

declare_id!("FPpVV8GotRq2cPppWBp1juVun4SC193TpaEPodrmHYaA");

#[program]
pub mod stede_handle_registry {
    use super::*;

    pub fn claim_handle(ctx: Context<ClaimHandle>, name: String) -> Result<()> {
        claim_handle_handler(ctx, name)
    }

    pub fn release_handle(ctx: Context<ReleaseHandle>) -> Result<()> {
        release_handle_handler(ctx)
    }

    pub fn transfer_handle(ctx: Context<TransferHandle>) -> Result<()> {
        transfer_handle_handler(ctx)
    }
}