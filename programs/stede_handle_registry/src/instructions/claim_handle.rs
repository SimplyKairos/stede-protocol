use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::{
    state::{Handle, Reverse},
    validation::validate_handle,
};

/// Anti-squat deposit, in lamports. 0.01 SOL.
pub const ANTI_SQUAT_DEPOSIT: u64 = 10_000_000;

#[derive(Accounts)]
#[instruction(name: String)]
pub struct ClaimHandle<'info> {
    /// The wallet claiming the handle. Pays for both PDAs + deposit.
    #[account(mut)]
    pub claimer: Signer<'info>,

    /// Forward PDA: handle name → owner wallet.
    /// Init-only: claiming a handle that already exists fails.
    #[account(
        init,
        payer = claimer,
        space = 8 + Handle::INIT_SPACE,
        seeds = [Handle::SEED_PREFIX, name.as_bytes()],
        bump,
    )]
    pub handle_account: Account<'info, Handle>,

    /// Reverse PDA: wallet → handle name.
    /// Init-only: a wallet that already owns a handle cannot claim another.
    #[account(
        init,
        payer = claimer,
        space = 8 + Reverse::INIT_SPACE,
        seeds = [Reverse::SEED_PREFIX, claimer.key().as_ref()],
        bump,
    )]
    pub reverse_account: Account<'info, Reverse>,

    pub system_program: Program<'info, System>,
}

pub fn claim_handle_handler(ctx: Context<ClaimHandle>, name: String) -> Result<()> {
    // Validate format. Errors if invalid.
    validate_handle(&name)?;

    let clock = Clock::get()?;
    let claimer_key = ctx.accounts.claimer.key();
    let handle_bump = ctx.bumps.handle_account;
    let reverse_bump = ctx.bumps.reverse_account;

    // Populate forward PDA in its own scope so the borrow drops.
    {
        let handle_account = &mut ctx.accounts.handle_account;
        handle_account.owner = claimer_key;
        handle_account.name = name.clone();
        handle_account.claimed_at = clock.unix_timestamp;
        handle_account.bump = handle_bump;
    }

    // Populate reverse PDA in its own scope.
    {
        let reverse_account = &mut ctx.accounts.reverse_account;
        reverse_account.handle = name.clone();
        reverse_account.bump = reverse_bump;
    }

    // Now transfer anti-squat deposit. No mutable borrow held.
    let cpi_accounts = Transfer {
        from: ctx.accounts.claimer.to_account_info(),
        to: ctx.accounts.handle_account.to_account_info(),
    };
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
        ),
        ANTI_SQUAT_DEPOSIT,
    )?;

    msg!(
        "Handle '{}' claimed by {}. Anti-squat deposit: {} lamports.",
        name,
        claimer_key,
        ANTI_SQUAT_DEPOSIT
    );

    Ok(())
}