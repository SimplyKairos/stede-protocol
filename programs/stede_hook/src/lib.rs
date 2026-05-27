use anchor_lang::prelude::*;
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("Cr1nytaygTvi4h73JhGacAJMbJsYxMvf7syQWpr6CYYv");

#[program]
pub mod stede_hook {
    use super::*;

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        initialize_extra_account_meta_list_handler(ctx)
    }

    pub fn execute(ctx: Context<Execute>, amount: u64) -> Result<()> {
        execute_handler(ctx, amount)
    }

    /// Fallback for the Transfer Hook Interface.
    ///
    /// Token-2022 invokes us with a discriminator that doesn't match Anchor's
    /// auto-generated one. We have to manually dispatch from the fallback.
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;
        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::execute(program_id, accounts, &amount_bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}