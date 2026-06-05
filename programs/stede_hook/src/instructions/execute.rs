use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use stede_rule_daily_limit::{
    cpi::{accounts::CheckTransfer as DailyLimitCheckTransfer, check_transfer as daily_limit_check_transfer},
    program::StedeRuleDailyLimit,
};
use stede_rule_block_handle::{
    cpi::{accounts::CheckTransfer as BlockListCheckTransfer, check_transfer as block_list_check_transfer},
    program::StedeRuleBlockHandle,
};

use stede_rule_cooloff::{
    cpi::{accounts::CheckTransfer as CooloffCheckTransfer, check_transfer as cooloff_check_transfer},
    program::StedeRuleCooloff,
};

use stede_rule_new_recipient_delay::{
    cpi::{accounts::CheckTransfer as SlowSendCheckTransfer, check_transfer as slow_send_check_transfer},
    program::StedeRuleNewRecipientDelay,
};

use stede_rule_time_window::{
    cpi::{accounts::CheckTransfer as TimeWindowCheckTransfer, check_transfer as time_window_check_transfer},
    program::StedeRuleTimeWindow,
};

use stede_rule_friend_gate::{
    cpi::{accounts::CheckTransfer as FriendGateCheckTransfer, check_transfer as friend_gate_check_transfer},
    program::StedeRuleFriendGate,
};

/// Accounts Token-2022 passes to our execute() on every transfer.
/// First 5 are fixed by the SPL Transfer Hook Interface.
/// Last ones are declared in our ExtraAccountMetaList.
#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: source token account, validated by Token-2022.
    pub source_token: UncheckedAccount<'info>,

    pub stede_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: destination token account, validated by Token-2022.
    pub destination_token: UncheckedAccount<'info>,

    /// CHECK: owner of source, validated by Token-2022.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList PDA, derived by hook interface.
    pub extra_account_meta_list: UncheckedAccount<'info>,

    // ---- Extra accounts declared in ExtraAccountMetaList ----

    pub stede_rule_daily_limit_program: Program<'info, StedeRuleDailyLimit>,

    /// CHECK: DailyLimit PDA, validated by daily limit program.
    #[account(mut)]
    pub daily_limit_pda: UncheckedAccount<'info>,

    pub stede_rule_block_handle_program: Program<'info, StedeRuleBlockHandle>,

    /// CHECK: BlockList PDA, validated by block list program.
    pub block_list_pda: UncheckedAccount<'info>,

    pub stede_rule_cooloff_program: Program<'info, StedeRuleCooloff>,

    /// CHECK: Cooloff PDA, validated by cool-off program.
    #[account(mut)]
    pub cooloff_pda: UncheckedAccount<'info>,

    pub stede_rule_new_recipient_delay_program: Program<'info, StedeRuleNewRecipientDelay>,

    /// CHECK: SlowSendConfig PDA, validated by the slow send program.
    pub slow_send_config_pda: UncheckedAccount<'info>,

    /// CHECK: SlowSendContact PDA (may not exist), validated by the slow send program.
    pub slow_send_contact_pda: UncheckedAccount<'info>,

    pub stede_rule_time_window_program: Program<'info, StedeRuleTimeWindow>,

    /// CHECK: TimeWindow config PDA (may not exist), validated by the time window program.
    pub time_window_config_pda: UncheckedAccount<'info>,

    pub stede_rule_friend_gate_program: Program<'info, StedeRuleFriendGate>,

    /// CHECK: FriendGate config PDA (may not exist), validated by the friend gate program.
    pub friend_gate_config_pda: UncheckedAccount<'info>,

    /// CHECK: Instructions sysvar, address validated by the friend gate program.
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn execute_handler(ctx: Context<Execute>, amount: u64) -> Result<()> {
    msg!("stede_hook execute() invoked. CPIing into rules.");

    // Rule 1: daily limit.
    let daily_limit_accounts = DailyLimitCheckTransfer {
        daily_limit: ctx.accounts.daily_limit_pda.to_account_info(),
    };
    daily_limit_check_transfer(
        CpiContext::new(
            ctx.accounts.stede_rule_daily_limit_program.to_account_info(),
            daily_limit_accounts,
        ),
        amount,
    )?;
    msg!("Daily limit rule passed.");

    // Rule 2: block list. Extract recipient wallet from destination token account.
    let destination_data = ctx.accounts.destination_token.try_borrow_data()?;
    let recipient_wallet = Pubkey::try_from(&destination_data[32..64])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    drop(destination_data);

    let block_list_accounts = BlockListCheckTransfer {
        block_list: ctx.accounts.block_list_pda.to_account_info(),
    };
    block_list_check_transfer(
        CpiContext::new(
            ctx.accounts.stede_rule_block_handle_program.to_account_info(),
            block_list_accounts,
        ),
        recipient_wallet,
    )?;
    msg!("Block list rule passed.");

    // Rule 3: cool-off.
    let cooloff_accounts = CooloffCheckTransfer {
        cooloff: ctx.accounts.cooloff_pda.to_account_info(),
    };
    cooloff_check_transfer(
        CpiContext::new(
            ctx.accounts.stede_rule_cooloff_program.to_account_info(),
            cooloff_accounts,
        ),
        amount,
    )?;
    msg!("Cool-off rule passed.");

    // Rule 4: slow send (new recipient delay).
    let slow_send_accounts = SlowSendCheckTransfer {
        config: ctx.accounts.slow_send_config_pda.to_account_info(),
        contact: ctx.accounts.slow_send_contact_pda.to_account_info(),
        destination_token: ctx.accounts.destination_token.to_account_info(),
    };
    slow_send_check_transfer(CpiContext::new(
        ctx.accounts.stede_rule_new_recipient_delay_program.to_account_info(),
        slow_send_accounts,
    ))?;
    msg!("Slow Send rule passed.");

    // Rule 5: time window (night mode).
    let time_window_accounts = TimeWindowCheckTransfer {
        config: ctx.accounts.time_window_config_pda.to_account_info(),
        sender: ctx.accounts.owner.to_account_info(),
        stede_mint: ctx.accounts.stede_mint.to_account_info(),
    };
    time_window_check_transfer(
        CpiContext::new(
            ctx.accounts.stede_rule_time_window_program.to_account_info(),
            time_window_accounts,
        ),
        amount,
    )?;
    msg!("Time window rule passed.");

    // Rule 6: friend gate.
    let friend_gate_accounts = FriendGateCheckTransfer {
        friend_gate: ctx.accounts.friend_gate_config_pda.to_account_info(),
        instructions_sysvar: ctx.accounts.instructions_sysvar.to_account_info(),
    };
    friend_gate_check_transfer(
        CpiContext::new(
            ctx.accounts.stede_rule_friend_gate_program.to_account_info(),
            friend_gate_accounts,
        ),
        amount,
    )?;
    msg!("Friend Gate rule passed.");

    Ok(())
}
