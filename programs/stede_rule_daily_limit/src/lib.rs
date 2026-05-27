use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5");

#[program]
pub mod stede_rule_daily_limit {
    use super::*;

    pub fn set_limit(ctx: Context<SetLimit>, limit: u64) -> Result<()> {
        set_limit_handler(ctx, limit)
    }

    pub fn check_transfer(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
        check_transfer_handler(ctx, amount)
    }
}