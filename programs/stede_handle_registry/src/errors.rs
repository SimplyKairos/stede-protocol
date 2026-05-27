use anchor_lang::prelude::*;

#[error_code]
pub enum HandleError {
    #[msg("Handle is too short. Minimum 3 characters.")]
    TooShort,

    #[msg("Handle is too long. Maximum 20 characters.")]
    TooLong,

    #[msg("Handle contains invalid characters. Only lowercase a-z, 0-9, and underscore allowed.")]
    InvalidCharacters,

    #[msg("Handle cannot start with a digit.")]
    StartsWithDigit,

    #[msg("Handle is reserved.")]
    Reserved,

    #[msg("Caller does not own this handle.")]
    NotOwner,
}