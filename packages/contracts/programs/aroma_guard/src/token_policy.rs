//! Token-2022 policy for registered assets (M6 decision 5, as amended by the owner after the
//! mainnet xStocks read; REWRITE-PLAN M6 decisions). Run by `register_asset` and again on the
//! live mint at every execution, so an extension the issuer turns on later fails closed.
//!
//! - Permanent delegate: accepted only if allow-listed (`allowed_permanent_delegates`).
//! - Transfer hook: accepted with no program, or a program in `allowed_transfer_hook_programs`.
//! - Freeze authority and Pausable authority: accepted only if in `allowed_freeze_authorities`;
//!   a paused mint is refused at execution.
//! - Confidential transfer: accepted only with auto-approve OFF and an authority in
//!   `allowed_permanent_delegates` (the issuer key that approves confidential accounts).
//! - Non-transferable: rejected.
//! - ScaledUiAmount: accepted; the multiplier is applied in the oracle math.
//! - Metadata pointer, token metadata, group pointers, default account state Initialized:
//!   accepted (no power over balances). Default state Frozen is rejected.
//! - Everything else (transfer fee, interest-bearing, mint close authority, confidential
//!   mint/burn, confidential fees, unknown types): rejected.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{
        confidential_transfer::ConfidentialTransferMint, default_account_state::DefaultAccountState,
        pausable::PausableConfig, permanent_delegate::PermanentDelegate,
        scaled_ui_amount::ScaledUiAmountConfig, transfer_hook::TransferHook, BaseStateWithExtensions,
        ExtensionType, StateWithExtensions,
    },
    state::{AccountState, Mint},
};
use anchor_lang::solana_program::program_pack::Pack;

use crate::errors::GuardError;
use crate::math::{effective_multiplier_bits, multiplier_fp_ceil, UNIT_MULTIPLIER_FP};
use crate::state::{listed, Config};

/// What the policy learned about a mint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MintFacts {
    pub decimals: u8,
    pub mint_authority: Option<Pubkey>,
    /// Bit `n` = `ExtensionType` with discriminant `n` (only types below 64 can be accepted).
    pub extensions: u64,
    pub scaled: Option<ScaledFacts>,
    pub paused: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScaledFacts {
    pub multiplier_bits: u64,
    pub new_multiplier_bits: u64,
    pub new_multiplier_effective_ts: i64,
}

impl MintFacts {
    /// Shares per token in fixed point (10^12) at `now`; exactly 1 without ScaledUiAmount.
    pub fn multiplier_fp(&self, now: i64) -> core::result::Result<u128, GuardError> {
        match self.scaled {
            None => Ok(UNIT_MULTIPLIER_FP),
            Some(s) => multiplier_fp_ceil(effective_multiplier_bits(
                s.multiplier_bits,
                s.new_multiplier_bits,
                s.new_multiplier_effective_ts,
                now,
            )),
        }
    }
}

fn opt_key(value: Option<Pubkey>) -> Option<Pubkey> {
    value.filter(|k| *k != Pubkey::default())
}

/// Parses `data` (owned by `token_program`) and applies the policy against `config`.
pub fn inspect_mint(data: &[u8], token_program: &Pubkey, config: &Config) -> core::result::Result<MintFacts, GuardError> {
    if *token_program != anchor_spl::token::ID && *token_program != spl_token_2022::ID {
        return Err(GuardError::UnsupportedTokenProgram);
    }
    // Token-2022's parser also reads classic 82-byte SPL mints (no extensions).
    let state = StateWithExtensions::<Mint>::unpack(data).map_err(|_| GuardError::UnsupportedTokenProgram)?;
    if *token_program == anchor_spl::token::ID && data.len() != Mint::LEN {
        return Err(GuardError::UnsupportedTokenProgram);
    }
    let base = state.base;
    if !base.is_initialized {
        return Err(GuardError::UnsupportedTokenProgram);
    }
    if let Some(freeze) = opt_key(base.freeze_authority.into()) {
        if !listed(&config.allowed_freeze_authorities, &freeze) {
            return Err(GuardError::FreezeAuthorityNotAllowed);
        }
    }
    let types = state.get_extension_types().map_err(|_| GuardError::UnsupportedExtension)?;
    let mut facts = MintFacts {
        decimals: base.decimals,
        mint_authority: base.mint_authority.into(),
        extensions: 0,
        scaled: None,
        paused: false,
    };
    for t in types {
        let n = u16::from(t);
        if n >= 64 {
            return Err(GuardError::UnsupportedExtension);
        }
        facts.extensions |= 1u64 << n;
        match t {
            ExtensionType::MetadataPointer
            | ExtensionType::TokenMetadata
            | ExtensionType::GroupPointer
            | ExtensionType::GroupMemberPointer
            | ExtensionType::TokenGroup
            | ExtensionType::TokenGroupMember => {}
            ExtensionType::DefaultAccountState => {
                let ext = state.get_extension::<DefaultAccountState>().map_err(|_| GuardError::UnsupportedExtension)?;
                if ext.state != u8::from(AccountState::Initialized) {
                    return Err(GuardError::UnsupportedExtension);
                }
            }
            ExtensionType::PermanentDelegate => {
                let ext = state.get_extension::<PermanentDelegate>().map_err(|_| GuardError::UnsupportedExtension)?;
                if let Some(delegate) = opt_key(ext.delegate.into()) {
                    if !listed(&config.allowed_permanent_delegates, &delegate) {
                        return Err(GuardError::PermanentDelegateNotAllowed);
                    }
                }
            }
            ExtensionType::TransferHook => {
                let ext = state.get_extension::<TransferHook>().map_err(|_| GuardError::UnsupportedExtension)?;
                if let Some(program) = opt_key(ext.program_id.into()) {
                    if !listed(&config.allowed_transfer_hook_programs, &program) {
                        return Err(GuardError::TransferHookNotAllowed);
                    }
                }
            }
            ExtensionType::ConfidentialTransferMint => {
                let ext = state
                    .get_extension::<ConfidentialTransferMint>()
                    .map_err(|_| GuardError::UnsupportedExtension)?;
                let auto_approve: bool = ext.auto_approve_new_accounts.into();
                let authority = opt_key(ext.authority.into());
                let gated = !auto_approve
                    && authority.is_some_and(|a| listed(&config.allowed_permanent_delegates, &a));
                if !gated {
                    return Err(GuardError::ConfidentialTransferNotAllowed);
                }
            }
            ExtensionType::Pausable => {
                let ext = state.get_extension::<PausableConfig>().map_err(|_| GuardError::UnsupportedExtension)?;
                if let Some(authority) = opt_key(ext.authority.into()) {
                    if !listed(&config.allowed_freeze_authorities, &authority) {
                        return Err(GuardError::FreezeAuthorityNotAllowed);
                    }
                }
                facts.paused = ext.paused.into();
            }
            ExtensionType::ScaledUiAmount => {
                let ext = state
                    .get_extension::<ScaledUiAmountConfig>()
                    .map_err(|_| GuardError::UnsupportedExtension)?;
                let scaled = ScaledFacts {
                    multiplier_bits: f64::from(ext.multiplier).to_bits(),
                    new_multiplier_bits: f64::from(ext.new_multiplier).to_bits(),
                    new_multiplier_effective_ts: i64::from(ext.new_multiplier_effective_timestamp),
                };
                // Both multipliers must be valid now, so a scheduled change cannot fail later.
                multiplier_fp_ceil(scaled.multiplier_bits)?;
                multiplier_fp_ceil(scaled.new_multiplier_bits)?;
                facts.scaled = Some(scaled);
            }
            ExtensionType::NonTransferable => return Err(GuardError::NonTransferableMint),
            _ => return Err(GuardError::UnsupportedExtension),
        }
    }
    Ok(facts)
}

/// Owner, mint and amount of an SPL Token or Token-2022 account (base layout).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenAccountFacts {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

pub fn read_token_account(info: &AccountInfo) -> core::result::Result<TokenAccountFacts, GuardError> {
    if *info.owner != anchor_spl::token::ID && *info.owner != spl_token_2022::ID {
        return Err(GuardError::InvalidTokenAccount);
    }
    let data = info.try_borrow_data().map_err(|_| GuardError::InvalidTokenAccount)?;
    let state = StateWithExtensions::<spl_token_2022::state::Account>::unpack(&data)
        .map_err(|_| GuardError::InvalidTokenAccount)?;
    Ok(TokenAccountFacts { owner: state.base.owner, mint: state.base.mint, amount: state.base.amount })
}
