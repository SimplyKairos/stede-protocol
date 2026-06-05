use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

use crate::{errors::FriendGateError, state::FriendGate};

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// The Friend Gate config PDA. MAY NOT EXIST (opt-in).
    /// CHECK: existence + address validated manually in the handler.
    pub friend_gate: UncheckedAccount<'info>,

    /// CHECK: the Instructions sysvar. Address checked in the handler.
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn check_transfer_handler(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
    let fg_info = &ctx.accounts.friend_gate;

    // OPT-IN: no config => rule not enabled => pass.
    if fg_info.data_is_empty() || fg_info.lamports() == 0 {
        msg!("Friend Gate not configured. Auto-pass.");
        return Ok(());
    }

    // Manually deserialize config (UncheckedAccount).
    // Layout after 8-byte discriminator:
    //   sender: Pubkey      8..40
    //   stede_mint: Pubkey  40..72
    //   threshold: u64      72..80
    //   friend_wallet: Pubkey 80..112
    //   bump: u8            112
    let data = fg_info.try_borrow_data()?;
    require!(data.len() >= 8 + FriendGate::INIT_SPACE, FriendGateError::SysvarReadFailed);

    let config_sender = Pubkey::try_from(&data[8..40])
        .map_err(|_| FriendGateError::SysvarReadFailed)?;
    let config_stede_mint = Pubkey::try_from(&data[40..72])
        .map_err(|_| FriendGateError::SysvarReadFailed)?;
    let threshold = u64::from_le_bytes(
        data[72..80].try_into().map_err(|_| FriendGateError::SysvarReadFailed)?,
    );
    let friend_wallet = Pubkey::try_from(&data[80..112])
        .map_err(|_| FriendGateError::SysvarReadFailed)?;
    drop(data);

    // Verify the passed config PDA is the legit one for (sender, mint).
    let (expected_config, _) =
        FriendGate::pda(&config_sender, &config_stede_mint, ctx.program_id);
    require_keys_eq!(
        fg_info.key(),
        expected_config,
        FriendGateError::SysvarReadFailed
    );

    // Below threshold: always pass.
    if amount < threshold {
        msg!("Friend Gate: amount {} below threshold {}. Pass.", amount, threshold);
        return Ok(());
    }

    // At/above threshold: the friend must be a signer somewhere in this transaction.
    // Verify the instructions sysvar account address first.
    require_keys_eq!(
        ctx.accounts.instructions_sysvar.key(),
        anchor_lang::solana_program::sysvar::instructions::ID,
        FriendGateError::SysvarReadFailed
    );

    let ix_sysvar = &ctx.accounts.instructions_sysvar;

    // How many instructions are in this transaction?
    let current_index = load_current_index_checked(ix_sysvar)
        .map_err(|_| FriendGateError::SysvarReadFailed)? as usize;

    // Scan all instructions up to and including the current one, collecting signers.
    // The friend co-signs the outer transaction, so they appear as a signer on at
    // least one instruction's account metas.
    let mut friend_signed = false;

    // Walk from 0..=current_index. load_instruction_at_checked gives each ix.
    for i in 0..=current_index {
        if let Ok(ix) = load_instruction_at_checked(i, ix_sysvar) {
            for acc in ix.accounts.iter() {
                if acc.is_signer && acc.pubkey == friend_wallet {
                    friend_signed = true;
                    break;
                }
            }
        }
        if friend_signed {
            break;
        }
    }

    require!(friend_signed, FriendGateError::FriendSignatureRequired);

    msg!(
        "Friend Gate: amount {} >= threshold {}, friend {} co-signed. Pass.",
        amount,
        threshold,
        friend_wallet,
    );

    Ok(())
}