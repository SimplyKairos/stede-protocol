use anchor_lang::prelude::*;

#[error_code]
pub enum BlockHandleError {
    #[msg("Recipient is on the sender's block list.")]
    RecipientBlocked,

    #[msg("Block list is full. Remove an entry before adding more.")]
    BlockListFull,

    #[msg("Wallet is already on the block list.")]
    AlreadyBlocked,

    #[msg("Wallet is not on the block list.")]
    NotBlocked,

    #[msg("Cannot block the zero address.")]
    ZeroAddress,

    #[msg("Block list config account is not the canonical PDA for its sender/mint.")]
    InvalidConfigAccount,
}