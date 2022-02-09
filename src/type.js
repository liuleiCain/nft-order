const {WyvernProtocol} = require("wyvern-js")
module.exports = {
    API_BASE_MAINNET: "https://api.opensea.io",
    API_BASE_RINKEBY: "https://testnets-api.opensea.io",
    OPENSEA_FEE_RECIPIENT: "0x5b3256965e7c3cf26e11fcaf296dfc8807c01073",
    DEFAULT_GAS_INCREASE_FACTOR: 1.01,
    EventType: {
        // Transactions and signature requests
        TransactionCreated: "TransactionCreated",
        TransactionConfirmed: "TransactionConfirmed",
        TransactionDenied: "TransactionDenied",
        TransactionFailed: "TransactionFailed",

        // Pre-transaction events
        InitializeAccount: "InitializeAccount",
        WrapEth: "WrapEth",
        UnwrapWeth: "UnwrapWeth",
        ApproveCurrency: "ApproveCurrency",
        ApproveAsset: "ApproveAsset",
        ApproveAllAssets: "ApproveAllAssets",
        UnapproveCurrency: "UnapproveCurrency",

        // Basic actions: matching orders, creating orders, and cancelling orders
        MatchOrders: "MatchOrders",
        CancelOrder: "CancelOrder",
        ApproveOrder: "ApproveOrder",
        CreateOrder: "CreateOrder", // When the signature request for an order is denied
        OrderDenied: "OrderDenied",

        // When transferring one or more assets
        TransferAll: "TransferAll",
        TransferOne: "TransferOne",

        // When wrapping or unwrapping NFTs
        WrapAssets: "WrapAssets",
        UnwrapAssets: "UnwrapAssets",
        LiquidateAssets: "LiquidateAssets",
        PurchaseAssets: "PurchaseAssets",
    },
    ENJIN_COIN_ADDRESS: "0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c",
    FunctionInputKind: {
        Replaceable: 'replaceable', Asset: 'asset', Owner: 'owner', Index: 'index', Count: 'count', Data: 'data',
    },
    INVERSE_BASIS_POINT: 10000,
    MANA_ADDRESS: "0x0f5d2fb29fb7d3cfee444a200298f468908cc942",
    MAX_ERROR_LENGTH: 120,
    MIN_EXPIRATION_SECONDS: 10,
    NULL_ADDRESS: WyvernProtocol.NULL_ADDRESS,
    NULL_BLOCK_HASH: "0x0000000000000000000000000000000000000000000000000000000000000000",
    Network: {
        Main: 'main',
        // Rinkeby: 'rinkeby',
    },
    SaleKind: {
        FixedPrice: 0, DutchAuction: 1
    },
    ORDER_MATCHING_LATENCY_SECONDS: 60 * 60 * 24 * 7,
    OrderSide: {
        Buy: 0, Sell: 1,
    },
    WyvernSchemaName: {
        ERC20: "ERC20",
        ERC721: "ERC721",
        ERC721v3: "ERC721v3",
        ERC1155: "ERC1155",
        LegacyEnjin: "Enjin",
        ENSShortNameAuction: "ENSShortNameAuction",
    }
}
