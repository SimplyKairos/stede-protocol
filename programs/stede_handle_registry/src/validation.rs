use anchor_lang::prelude::*;

use crate::errors::HandleError;

/// Reserved handle names that no one can claim.
const RESERVED: &[&str] = &[
    "stede",
    "admin",
    "team",
    "support",
    "null",
    "system",
];

const MIN_LEN: usize = 3;
const MAX_LEN: usize = 20;

/// Validates a handle string against the format rules.
///
/// Errors with the appropriate HandleError variant if any rule fails.
pub fn validate_handle(name: &str) -> Result<()> {
    require!(name.len() >= MIN_LEN, HandleError::TooShort);
    require!(name.len() <= MAX_LEN, HandleError::TooLong);

    let bytes = name.as_bytes();

    // First char cannot be a digit.
    require!(!bytes[0].is_ascii_digit(), HandleError::StartsWithDigit);

    // All chars must be lowercase a-z, 0-9, or underscore.
    for &b in bytes {
        let valid = b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_';
        require!(valid, HandleError::InvalidCharacters);
    }

    // Reserved list check.
    require!(!RESERVED.contains(&name), HandleError::Reserved);

    Ok(())
}