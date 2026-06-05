use anchor_lang::prelude::*;

#[error_code]
pub enum FriendGateError {
    #[msg("Transfer at or above threshold requires the friend wallet to co-sign.")]
    FriendSignatureRequired,

    #[msg("Threshold must be greater than zero.")]
    ZeroThreshold,

    #[msg("Friend wallet cannot be the zero address.")]
    ZeroFriend,

    #[msg("Friend wallet cannot be the sender themselves.")]
    FriendIsSelf,

    #[msg("Could not read the instructions sysvar.")]
    SysvarReadFailed,
}