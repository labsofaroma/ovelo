use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum GuardError {
    // Access and lifecycle
    #[msg("Only the program's upgrade authority can initialize the config")]
    NotUpgradeAuthority,
    #[msg("Signer is not the config admin")]
    NotAdmin,
    #[msg("Signer is not the configured keeper")]
    NotKeeper,
    #[msg("The protocol is paused")]
    ProtocolPaused,
    #[msg("The plan is paused by its owner")]
    PlanPaused,
    #[msg("The plan is already in that pause state")]
    PauseStateUnchanged,
    #[msg("Unsupported account version")]
    UnsupportedVersion,

    // Config
    #[msg("Invalid config value")]
    InvalidConfig,

    // Assets and Token-2022 policy
    #[msg("Asset account does not match the output mint")]
    AssetMismatch,
    #[msg("Asset is disabled")]
    AssetDisabled,
    #[msg("Mint is not owned by a supported token program")]
    UnsupportedTokenProgram,
    #[msg("Mint has a permanent delegate that is not allow-listed")]
    PermanentDelegateNotAllowed,
    #[msg("Mint has a transfer hook program that is not allow-listed")]
    TransferHookNotAllowed,
    #[msg("Mint has a freeze or pause authority that is not allow-listed")]
    FreezeAuthorityNotAllowed,
    #[msg("Mint allows confidential transfers without an allow-listed approving authority")]
    ConfidentialTransferNotAllowed,
    #[msg("Mint is non-transferable")]
    NonTransferableMint,
    #[msg("Mint has an unsupported Token-2022 extension")]
    UnsupportedExtension,
    #[msg("Mint is paused")]
    MintPaused,
    #[msg("Mint decimals changed since registration")]
    DecimalsChanged,
    #[msg("ScaledUiAmount multiplier is invalid or out of range")]
    InvalidMultiplier,
    #[msg("Mint authority is not this asset's mock mint PDA")]
    MockMintAuthorityMismatch,

    // Plans
    #[msg("Funding mint is not allow-listed")]
    FundingMintNotAllowed,
    #[msg("Invalid schedule")]
    InvalidSchedule,
    #[msg("Outputs must be 1 to 20 distinct registered assets")]
    InvalidOutputs,
    #[msg("Output weights must sum to 10,000 bps and each leg must receive funds")]
    InvalidWeights,
    #[msg("Slippage is above the configured cap")]
    SlippageAboveCap,
    #[msg("Installment amount is above the launch cap")]
    AmountAboveCap,
    #[msg("Invalid token account")]
    InvalidTokenAccount,

    // Subscriptions
    #[msg("Subscriptions account has the wrong owner, address, length, discriminator or version")]
    InvalidSubscriptionAccount,
    #[msg("Subscriptions delegation terms do not match the plan")]
    DelegationTermsMismatch,

    // Execution
    #[msg("Not the period that can run now")]
    UnexpectedPeriod,
    #[msg("No period can run now")]
    NothingDue,
    #[msg("Invalid leg mask")]
    InvalidLegMask,
    #[msg("Wrong number of remaining accounts for the leg mask")]
    InvalidRemainingAccounts,
    #[msg("Destination is not the owner's associated token account for the output mint")]
    WrongDestination,
    #[msg("Funding debit or credit did not match the installment")]
    FundingBalanceMismatch,
    #[msg("Staging balance is not back at its starting balance")]
    StagingNotRestored,
    #[msg("Owner's output balance increased by less than the minimum")]
    OutputBelowMinimum,

    // Oracle
    #[msg("Price account is not a Pyth PriceUpdateV2")]
    InvalidPriceAccount,
    #[msg("Price feed id does not match the asset")]
    PriceFeedMismatch,
    #[msg("Price update is not fully verified")]
    PriceNotFullyVerified,
    #[msg("Price is older than the configured maximum")]
    StalePrice,
    #[msg("Price is not positive")]
    NonPositivePrice,
    #[msg("Price confidence interval is too wide")]
    ConfidenceTooWide,
    #[msg("Computed output is zero")]
    ZeroOutput,

    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("This build executes installments through execute_installment_routed")]
    MainnetExecutionUnavailable,

    // Mainnet (Jupiter) execution, M8. Appended so every earlier code keeps its number.
    #[msg("This build requires a configured keeper_authority")]
    KeeperRequired,
    #[msg("This build has no swap path; installments execute through execute_installment")]
    RoutedExecutionUnavailable,
    #[msg("Route is not a supported Jupiter route_v2 instruction")]
    UnsupportedRoute,
    #[msg("Route amount, fee or positive-slippage terms differ from the leg")]
    RouteTermsMismatch,
    #[msg("Route account does not match the leg (authority, accounts, mints, programs)")]
    RouteAccountMismatch,
    #[msg("Route includes an account it must not touch")]
    RouteAccountForbidden,
    #[msg("Swap accounts did not return to their starting balances")]
    SwapBalanceMismatch,
}
