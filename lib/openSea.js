(function (module, exports) {
    const {isValidAddress} = require("ethereumjs-util")
    const util = require("../src/util.js")
    const types = require('../src/type')
    const {WyvernProtocol} = require('wyvern-js')
    const WyvernSchemas = require('wyvern-schemas')
    const Web3 = require("web3")
    const {BigNumber} = require("bignumber.js")
    const {ERC721, ERC20, getMethod} = require("../src/contracts")

    class NftAutoBuy {
        constructor(networkName, provider) {
            this._networkName = networkName
            this.web3 = new Web3(provider);
            this._wyvernProtocol = new WyvernProtocol(provider, {
                network: this._networkName,
            });
        }

        /**
         * Get the balance of a fungible token.
         * Convenience method for getAssetBalance for fungibles
         * @param param0 __namedParameters Object
         * @param accountAddress Account address to check
         * @param tokenAddress The address of the token to check balance for
         * @param schemaName Optional schema name for the fungible token
         * @param retries Number of times to retry if balance is undefined
         */
        async getTokenBalance({
                                  accountAddress, tokenAddress, schemaName = types.WyvernSchemaName.ERC20,
                              }, retries = 1) {
            const asset = {
                tokenId: null, tokenAddress, schemaName,
            };
            return this.getAssetBalance({accountAddress, asset}, retries);
        }


        /**
         * Get an account's balance of any Asset.
         * @param param0 __namedParameters Object
         * @param accountAddress Account address to check
         * @param asset The Asset to check balance for
         * @param retries How many times to retry if balance is 0
         */
        async getAssetBalance({accountAddress, asset}, retries = 1) {
            const schema = this._getSchema(asset.schemaName);
            const wyAsset = util.getWyvernAsset(schema, asset);

            if (schema.functions.countOf) {
                // ERC20 or ERC1155 (non-Enjin)
                const abi = schema.functions.countOf(wyAsset);
                const contract = this._getClientsForRead(retries)
                    .web3.eth.contract(abi)
                    .at(abi.target);
                const inputValues = abi.inputs
                    .filter((x) => x.value !== undefined)
                    .map((x) => x.value);
                const count = await contract[abi.name].call(accountAddress, ...inputValues);

                if (count !== undefined) {
                    return count;
                }
            } else if (schema.functions.ownerOf) {
                // ERC721 asset

                const abi = schema.functions.ownerOf(wyAsset);
                const contract = this._getClientsForRead(retries)
                    .web3.eth.contract(abi)
                    .at(abi.target);
                if (abi.inputs.filter((x) => x.value === undefined)[0]) {
                    throw new Error("Missing an argument for finding the owner of this asset");
                }
                const inputValues = abi.inputs.map((i) => i.value.toString());
                const owner = await contract[abi.name].call(...inputValues);
                if (owner) {
                    return owner.toLowerCase() === accountAddress.toLowerCase() ? new BigNumber(1) : new BigNumber(0);
                }
            } else {
                // Missing ownership call - skip check to allow listings
                // by default
                throw new Error("Missing ownership schema for this asset type");
            }

            if (retries <= 0) {
                throw new Error("Unable to get current owner from smart contract");
            } else {
                await delay(500);
                // Recursively check owner again
                return await this.getAssetBalance({accountAddress, asset}, retries - 1);
            }
        }

        /**
         * Gets the price for the order using the contract
         * @param order The order to calculate the price for
         */
        async getCurrentPrice(order) {
            return await this._wyvernProtocol.wyvernExchange.calculateCurrentPrice_.callAsync([order.exchange, order.maker, order.taker, order.feeRecipient, order.target, order.staticTarget, order.paymentToken,], [order.makerRelayerFee, order.takerRelayerFee, order.makerProtocolFee, order.takerProtocolFee, order.basePrice, order.extra, order.listingTime, order.expirationTime, order.salt,], order.feeMethod, order.side, order.saleKind, order.howToCall, order.calldata, order.replacementPattern, order.staticExtradata);
        }

        async _atomicMatch({buy, sell, accountAddress, metadata = types.NULL_BLOCK_HASH}) {
            let value;
            let shouldValidateBuy = true;
            let shouldValidateSell = true;

            if (sell.maker.toLowerCase() == accountAddress.toLowerCase()) {
                // USER IS THE SELLER, only validate the buy order
                await this._sellOrderValidationAndApprovals({
                    order: sell, accountAddress,
                });
                shouldValidateSell = false;
            } else if (buy.maker.toLowerCase() == accountAddress.toLowerCase()) {
                // USER IS THE BUYER, only validate the sell order
                await this._buyOrderValidationAndApprovals({
                    order: buy, counterOrder: sell, accountAddress,
                });
                shouldValidateBuy = false;

                // If using ETH to pay, set the value of the transaction to the current price
                if (buy.paymentToken == types.NULL_ADDRESS) {
                    value = await this._getRequiredAmountForTakingSellOrder(sell);
                }
            } else {
                // User is neither - matching service
            }

            await this._validateMatch({
                buy, sell, accountAddress, shouldValidateBuy, shouldValidateSell,
            });

            let txHash;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const txnData = {from: accountAddress, value};
            const args = [
                [
                    buy.exchange,
                    buy.maker,
                    buy.taker,
                    buy.feeRecipient,
                    buy.target,
                    buy.staticTarget,
                    buy.paymentToken,
                    sell.exchange,
                    sell.maker,
                    sell.taker,
                    sell.feeRecipient,
                    sell.target,
                    sell.staticTarget,
                    sell.paymentToken,
                ], [
                    buy.makerRelayerFee,
                    buy.takerRelayerFee,
                    buy.makerProtocolFee,
                    buy.takerProtocolFee,
                    buy.basePrice,
                    buy.extra,
                    buy.listingTime,
                    buy.expirationTime,
                    buy.salt,
                    sell.makerRelayerFee,
                    sell.takerRelayerFee,
                    sell.makerProtocolFee,
                    sell.takerProtocolFee,
                    sell.basePrice,
                    sell.extra,
                    sell.listingTime,
                    sell.expirationTime,
                    sell.salt,
                ], [
                    buy.feeMethod,
                    buy.side,
                    buy.saleKind,
                    buy.howToCall,
                    sell.feeMethod,
                    sell.side,
                    sell.saleKind,
                    sell.howToCall,
                ],
                buy.calldata,
                sell.calldata,
                buy.replacementPattern,
                sell.replacementPattern,
                buy.staticExtradata,
                sell.staticExtradata,
                [
                    buy.v || 0,
                    sell.v || 0],
                [
                    buy.r || types.NULL_BLOCK_HASH,
                    buy.s || types.NULL_BLOCK_HASH,
                    sell.r || types.NULL_BLOCK_HASH,
                    sell.s || types.NULL_BLOCK_HASH,
                    metadata,
                ],
            ];

            // Estimate gas first
            try {
                // Typescript splat doesn't typecheck
                const gasEstimate = await this._wyvernProtocol.wyvernExchange.atomicMatch_.estimateGasAsync(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8], args[9], args[10], txnData);

                txnData.gas = this._correctGasAmount(gasEstimate);
            } catch (error) {
                console.error(`Failed atomic match with args: `, args, error);
                throw new Error(`Oops, the Ethereum network rejected this transaction :( The OpenSea devs have been alerted, but this problem is typically due an item being locked or untransferrable. The exact error was "${error instanceof Error ? error.message.substr(0, types.MAX_ERROR_LENGTH) : "unknown"}..."`);
            }

            // Then do the transaction
            try {
                txHash = await this._wyvernProtocol.wyvernExchange.atomicMatch_.sendTransactionAsync(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8], args[9], args[10], txnData);
            } catch (error) {
                console.error(error);
                throw new Error(`Failed to authorize transaction: "${error instanceof Error && error.message ? error.message : "user denied"}..."`);
            }
            return txHash;
        }

        // Throws
        async _buyOrderValidationAndApprovals({order, counterOrder, accountAddress}) {
            const tokenAddress = order.paymentToken;

            if (tokenAddress != types.NULL_ADDRESS) {
                const balance = await this.getTokenBalance({
                    accountAddress, tokenAddress,
                });

                /* NOTE: no buy-side auctions for now, so sell.saleKind === 0 */
                let minimumAmount = util.makeBigNumber(order.basePrice);
                if (counterOrder) {
                    minimumAmount = await this._getRequiredAmountForTakingSellOrder(counterOrder);
                }

                // Check WETH balance
                if (balance.toNumber() < minimumAmount.toNumber()) {
                    if (tokenAddress == WyvernSchemas.tokens[this._networkName].canonicalWrappedEther.address) {
                        throw new Error("Insufficient balance. You may need to wrap Ether.");
                    } else {
                        throw new Error("Insufficient balance.");
                    }
                }

                // Check token approval
                // This can be done at a higher level to show UI
                await this.approveFungibleToken({
                    accountAddress, tokenAddress, minimumAmount,
                });
            }

            // Check order formation
            const buyValid = await this._wyvernProtocol.wyvernExchange.validateOrderParameters_.callAsync([order.exchange, order.maker, order.taker, order.feeRecipient, order.target, order.staticTarget, order.paymentToken,], [order.makerRelayerFee, order.takerRelayerFee, order.makerProtocolFee, order.takerProtocolFee, order.basePrice, order.extra, order.listingTime, order.expirationTime, order.salt,], order.feeMethod, order.side, order.saleKind, order.howToCall, order.calldata, order.replacementPattern, order.staticExtradata, {from: accountAddress});
            if (!buyValid) {
                console.error(order);
                throw new Error(`Failed to validate buy order parameters. Make sure you're on the right network!`);
            }
        }

        _getClientsForRead(retries = 1) {
            if (retries > 0) {
                // Use injected provider by default
                return {
                    web3: this.web3, wyvernProtocol: this._wyvernProtocol,
                };
            } else {
                // Use provided provider as fallback
                return {
                    web3: this.web3, wyvernProtocol: this._wyvernProtocol,
                };
            }
        }

        _getMetadata(order, referrerAddress) {
            const referrer = referrerAddress || order.metadata.referrerAddress;
            if (referrer && isValidAddress(referrer)) {
                return referrer;
            }
            return undefined;
        }

        async _getRequiredAmountForTakingSellOrder(sell) {
            const currentPrice = await this.getCurrentPrice(sell);
            const estimatedPrice = util.estimateCurrentPrice(sell);

            const maxPrice = BigNumber.max(currentPrice, estimatedPrice);

            // TODO Why is this not always a big number?
            sell.takerRelayerFee = util.makeBigNumber(sell.takerRelayerFee);
            const feePercentage = sell.takerRelayerFee.div(types.INVERSE_BASIS_POINT);
            const fee = feePercentage.times(maxPrice);
            return fee.plus(maxPrice).ceil();
        }

        _getTimeParameters(expirationTimestamp, listingTimestamp = 0, waitingForBestCounterOrder = false) {
            // Validation
            const minExpirationTimestamp = Math.round(Date.now() / 1000 + types.MIN_EXPIRATION_SECONDS);
            const minListingTimestamp = Math.round(Date.now() / 1000);
            if (expirationTimestamp != 0 && expirationTimestamp < minExpirationTimestamp) {
                throw new Error(`Expiration time must be at least ${types.MIN_EXPIRATION_SECONDS} seconds from now, or zero (non-expiring).`);
            }
            if (listingTimestamp && listingTimestamp < minListingTimestamp) {
                throw new Error("Listing time cannot be in the past.");
            }
            if (listingTimestamp && expirationTimestamp != 0 && listingTimestamp >= expirationTimestamp) {
                throw new Error("Listing time must be before the expiration time.");
            }
            if (waitingForBestCounterOrder && expirationTimestamp == 0) {
                throw new Error("English auctions must have an expiration time.");
            }
            if (waitingForBestCounterOrder && listingTimestamp) {
                throw new Error(`Cannot schedule an English auction for the future.`);
            }
            if (parseInt(expirationTimestamp.toString()) != expirationTimestamp) {
                throw new Error(`Expiration timestamp must be a whole number of seconds`);
            }

            if (waitingForBestCounterOrder) {
                listingTimestamp = expirationTimestamp;
                // Expire one week from now, to ensure server can match it
                // Later, this will expire closer to the listingTime
                expirationTimestamp = expirationTimestamp + types.ORDER_MATCHING_LATENCY_SECONDS;
            } else {
                // Small offset to account for latency
                listingTimestamp = listingTimestamp || Math.round(Date.now() / 1000 - 100);
            }

            return {
                listingTime: util.makeBigNumber(listingTimestamp),
                expirationTime: util.makeBigNumber(expirationTimestamp),
            };
        }

        _getSchema(schemaName) {
            const schemaName_ = schemaName || types.WyvernSchemaName.ERC721;
            const schema = WyvernSchemas.schemas[this._networkName].filter((s) => s.name === schemaName_)[0];

            if (!schema) {
                throw new Error(`Trading for this asset (${schemaName_}) is not yet supported. Please contact us or check back later!`);
            }
            return schema;
        }

        _makeMatchingOrder({order, accountAddress, recipientAddress}) {
            accountAddress = util.validateAndFormatWalletAddress(this.web3, accountAddress);
            recipientAddress = util.validateAndFormatWalletAddress(this.web3, recipientAddress);

            const computeOrderParams = () => {
                if (order.metadata.hasOwnProperty("asset")) {
                    const schema = this._getSchema(order.metadata.schema);
                    return order.side === types.OrderSide.Buy ? util.encodeSell(schema, order.metadata.asset, recipientAddress) : util.encodeBuy(schema, order.metadata.asset, recipientAddress);
                } else if (order.metadata.hasOwnProperty("bundle")) {
                    // We're matching a bundle order
                    const bundle = order.metadata.bundle;
                    const orderedSchemas = bundle.schemas ? bundle.schemas.map((schemaName) => this._getSchema(schemaName)) : // Backwards compat:
                        bundle.assets.map(() => this._getSchema("schema" in order.metadata ? order.metadata.schema : undefined));
                    const atomicized = order.side === types.OrderSide.Buy ? util.encodeAtomicizedSell(orderedSchemas, order.metadata.bundle.assets, recipientAddress, this._wyvernProtocol, this._networkName) : util.encodeAtomicizedBuy(orderedSchemas, order.metadata.bundle.assets, recipientAddress, this._wyvernProtocol, this._networkName);
                    return {
                        target: WyvernProtocol.getAtomicizerContractAddress(this._networkName),
                        calldata: atomicized.calldata,
                        replacementPattern: atomicized.replacementPattern,
                    };
                } else {
                    throw new Error("Invalid order metadata");
                }
            };

            const {target, calldata, replacementPattern} = computeOrderParams();
            const times = this._getTimeParameters(0);
            const feeRecipient = order.feeRecipient == types.NULL_ADDRESS ? types.OPENSEA_FEE_RECIPIENT : types.NULL_ADDRESS;

            const matchingOrder = {
                exchange: order.exchange,
                maker: accountAddress,
                taker: order.maker,
                quantity: order.quantity,
                makerRelayerFee: order.makerRelayerFee,
                takerRelayerFee: order.takerRelayerFee,
                makerProtocolFee: order.makerProtocolFee,
                takerProtocolFee: order.takerProtocolFee,
                makerReferrerFee: order.makerReferrerFee,
                waitingForBestCounterOrder: false,
                feeMethod: order.feeMethod,
                feeRecipient,
                side: (order.side + 1) % 2,
                saleKind: types.SaleKind.FixedPrice,
                target,
                howToCall: order.howToCall,
                calldata,
                replacementPattern,
                staticTarget: types.NULL_ADDRESS,
                staticExtradata: "0x",
                paymentToken: order.paymentToken,
                basePrice: order.basePrice,
                extra: util.makeBigNumber(0),
                listingTime: times.listingTime,
                expirationTime: times.expirationTime,
                salt: WyvernProtocol.generatePseudoRandomSalt(),
                metadata: order.metadata,
            }

            return {
                matchingOrder, hash: util.getOrderHash(matchingOrder),
            }
        }

        async _sellOrderValidationAndApprovals({order, accountAddress}) {
            const wyAssets = "bundle" in order.metadata ? order.metadata.bundle.assets : order.metadata.asset ? [order.metadata.asset] : [];
            const schemaNames = "bundle" in order.metadata && "schemas" in order.metadata.bundle ? order.metadata.bundle.schemas : "schema" in order.metadata ? [order.metadata.schema] : [];
            const tokenAddress = order.paymentToken;

            await this._approveAll({schemaNames, wyAssets, accountAddress});

            // For fulfilling bids,
            // need to approve access to fungible token because of the way fees are paid
            // This can be done at a higher level to show UI
            if (tokenAddress !== types.NULL_ADDRESS) {
                const minimumAmount = util.makeBigNumber(order.basePrice);
                await this.approveFungibleToken({
                    accountAddress, tokenAddress, minimumAmount,
                });
            }

            // Check sell parameters
            const sellValid = await this._wyvernProtocol.wyvernExchange.validateOrderParameters_.callAsync([order.exchange, order.maker, order.taker, order.feeRecipient, order.target, order.staticTarget, order.paymentToken,], [order.makerRelayerFee, order.takerRelayerFee, order.makerProtocolFee, order.takerProtocolFee, order.basePrice, order.extra, order.listingTime, order.expirationTime, order.salt,], order.feeMethod, order.side, order.saleKind, order.howToCall, order.calldata, order.replacementPattern, order.staticExtradata, {from: accountAddress});
            if (!sellValid) {
                console.error(order);
                throw new Error(`Failed to validate sell order parameters. Make sure you're on the right network!`);
            }
        }

        async _approveAll({schemaNames, wyAssets, accountAddress, proxyAddress}) {
            proxyAddress = proxyAddress || (await this._getProxy(accountAddress)) || undefined;
            if (!proxyAddress) {
                proxyAddress = await this._initializeProxy(accountAddress);
            }
            const contractsWithApproveAll = new Set();

            return Promise.all(wyAssets.map(async (wyAsset, i) => {
                const schemaName = schemaNames[i];
                // Verify that the taker owns the asset
                let isOwner;
                try {
                    isOwner = await this._ownsAssetOnChain({
                        accountAddress, proxyAddress, wyAsset, schemaName,
                    });
                } catch (error) {
                    // let it through for assets we don't support yet
                    isOwner = true;
                }
                if (!isOwner) {
                    const minAmount = "quantity" in wyAsset ? wyAsset.quantity : 1;
                    console.error(`Failed on-chain ownership check: ${accountAddress} on ${schemaName}:`, wyAsset);
                    throw new Error(`You don't own enough to do that (${minAmount} base units of ${wyAsset.address}${wyAsset.id ? " token " + wyAsset.id : ""})`);
                }
                switch (schemaName) {
                    case types.WyvernSchemaName.ERC721:
                    case types.WyvernSchemaName.ERC721v3:
                    case types.WyvernSchemaName.ERC1155:
                    case types.WyvernSchemaName.LegacyEnjin:
                    case types.WyvernSchemaName.ENSShortNameAuction:
                        // Handle NFTs and SFTs
                        // eslint-disable-next-line no-case-declarations
                        return await this.approveSemiOrNonFungibleToken({
                            tokenId: wyAsset.id.toString(),
                            tokenAddress: wyAsset.address,
                            accountAddress,
                            proxyAddress,
                            schemaName,
                            skipApproveAllIfTokenAddressIn: contractsWithApproveAll,
                        });
                    case types.WyvernSchemaName.ERC20:
                        // Handle FTs
                        // eslint-disable-next-line no-case-declarations
                        if (contractsWithApproveAll.has(wyAsset.address)) {
                            // Return null to indicate no tx occurred
                            return null;
                        }
                        contractsWithApproveAll.add(wyAsset.address);
                        return await this.approveFungibleToken({
                            tokenAddress: wyAsset.address, accountAddress, proxyAddress,
                        });
                    // For other assets, including contracts:
                    // Send them to the user's proxy
                    // if (where != WyvernAssetLocation.Proxy) {
                    //   return this.transferOne({
                    //     schemaName: schema.name,
                    //     asset: wyAsset,
                    //     isWyvernAsset: true,
                    //     fromAddress: accountAddress,
                    //     toAddress: proxy
                    //   })
                    // }
                    // return true
                }
            }));
        }

        /**
         * Approve a fungible token (e.g. W-ETH) for use in trades.
         * Called internally, but exposed for dev flexibility.
         * Checks to see if the minimum amount is already approved, first.
         * @param param0 __namedParameters Object
         * @param accountAddress The user's wallet address
         * @param tokenAddress The contract address of the token being approved
         * @param proxyAddress The user's proxy address. If unspecified, uses the Wyvern token transfer proxy address.
         * @param minimumAmount The minimum amount needed to skip a transaction. Defaults to the max-integer.
         * @returns Transaction hash if a new transaction occurred, otherwise null
         */
        async approveFungibleToken({
                                       accountAddress,
                                       tokenAddress,
                                       proxyAddress,
                                       minimumAmount = WyvernProtocol.MAX_UINT_256,
                                   }) {
            proxyAddress = proxyAddress || WyvernProtocol.getTokenTransferProxyAddress(this._networkName);

            const approvedAmount = await this._getApprovedTokenCount({
                accountAddress, tokenAddress, proxyAddress,
            });

            if (approvedAmount.greaterThanOrEqualTo(minimumAmount)) {
                return null;
            }

            const hasOldApproveMethod = [types.ENJIN_COIN_ADDRESS, types.MANA_ADDRESS].includes(tokenAddress.toLowerCase());

            if (minimumAmount.greaterThan(0) && hasOldApproveMethod) {
                // Older erc20s require initial approval to be 0
                await this.unapproveFungibleToken({
                    accountAddress, tokenAddress, proxyAddress,
                });
            }

            const txHash = await util.sendRawTransaction(this.web3, {
                from: accountAddress, to: tokenAddress, data: util.encodeCall(getMethod(ERC20, "approve"), // Always approve maximum amount, to prevent the need for followup
                    // transactions (and because old ERC20s like MANA/ENJ are non-compliant)
                    [proxyAddress, WyvernProtocol.MAX_UINT_256.toString()]),
            });

            await this._confirmTransaction(txHash, types.EventType.ApproveCurrency, "Approving currency for trading", async () => {
                const newlyApprovedAmount = await this._getApprovedTokenCount({
                    accountAddress, tokenAddress, proxyAddress,
                });
                return newlyApprovedAmount.greaterThanOrEqualTo(minimumAmount);
            });
            return txHash;
        }

        /**
         * Un-approve a fungible token (e.g. W-ETH) for use in trades.
         * Called internally, but exposed for dev flexibility.
         * Useful for old ERC20s that require a 0 approval count before
         * changing the count
         * @param param0 __namedParameters Object
         * @param accountAddress The user's wallet address
         * @param tokenAddress The contract address of the token being approved
         * @param proxyAddress The user's proxy address. If unspecified, uses the Wyvern token transfer proxy address.
         * @returns Transaction hash
         */
        async unapproveFungibleToken({
                                         accountAddress, tokenAddress, proxyAddress,
                                     }) {
            proxyAddress = proxyAddress || WyvernProtocol.getTokenTransferProxyAddress(this._networkName);

            const txHash = await util.sendRawTransaction(this.web3, {
                from: accountAddress,
                to: tokenAddress,
                data: util.encodeCall(getMethod(ERC20, "approve"), [proxyAddress, 0]),
            });

            await this._confirmTransaction(txHash, types.EventType.UnapproveCurrency, "Resetting Currency Approval", async () => {
                const newlyApprovedAmount = await this._getApprovedTokenCount({
                    accountAddress, tokenAddress, proxyAddress,
                });
                return newlyApprovedAmount.isZero();
            });
            return txHash;
        }

        /**
         * Approve a non-fungible token for use in trades.
         * Requires an account to be initialized first.
         * Called internally, but exposed for dev flexibility.
         * Checks to see if already approved, first. Then tries different approval methods from best to worst.
         * @param param0 __namedParameters Object
         * @param tokenId Token id to approve, but only used if approve-all isn't
         *  supported by the token contract
         * @param tokenAddress The contract address of the token being approved
         * @param accountAddress The user's wallet address
         * @param proxyAddress Address of the user's proxy contract. If not provided,
         *  will attempt to fetch it from Wyvern.
         * @param tokenAbi ABI of the token's contract. Defaults to a flexible ERC-721
         *  contract.
         * @param skipApproveAllIfTokenAddressIn an optional list of token addresses that, if a token is approve-all type, will skip approval
         * @param schemaName The Wyvern schema name corresponding to the asset type
         * @returns Transaction hash if a new transaction was created, otherwise null
         */
        async approveSemiOrNonFungibleToken({
                                                tokenId,
                                                tokenAddress,
                                                accountAddress,
                                                proxyAddress,
                                                tokenAbi = ERC721,
                                                skipApproveAllIfTokenAddressIn = new Set(),
                                                schemaName = types.WyvernSchemaName.ERC721,
                                            }) {
            const schema = this._getSchema(schemaName);
            const tokenContract = this.web3.eth.contract(tokenAbi);
            const contract = await tokenContract.at(tokenAddress);

            if (!proxyAddress) {
                proxyAddress = (await this._getProxy(accountAddress)) || undefined;
                if (!proxyAddress) {
                    throw new Error("Uninitialized account");
                }
            }

            const approvalAllCheck = async () => {
                // NOTE:
                // Use this long way of calling so we can check for method existence on a bool-returning method.
                const isApprovedForAllRaw = await util.rawCall(this.web3, {
                    from: accountAddress,
                    to: contract.address,
                    data: contract.isApprovedForAll.getData(accountAddress, proxyAddress),
                });
                return parseInt(isApprovedForAllRaw);
            };
            const isApprovedForAll = await approvalAllCheck();

            if (isApprovedForAll == 1) {
                // Supports ApproveAll
                return null;
            }

            if (isApprovedForAll == 0) {
                // Supports ApproveAll
                //  not approved for all yet

                if (skipApproveAllIfTokenAddressIn.has(tokenAddress)) {
                    return null;
                }
                skipApproveAllIfTokenAddressIn.add(tokenAddress);

                try {
                    const txHash = await util.sendRawTransaction(this.web3, {
                        from: accountAddress,
                        to: contract.address,
                        data: contract.setApprovalForAll.getData(proxyAddress, true),
                    });
                    await this._confirmTransaction(txHash, types.EventType.ApproveAllAssets, "Approving all tokens of this type for trading", async () => {
                        const result = await approvalAllCheck();
                        return result == 1;
                    });
                    return txHash;
                } catch (error) {
                    console.error(error);
                    throw new Error("Couldn't get permission to approve these tokens for trading. Their contract might not be implemented correctly. Please contact the developer!");
                }
            }
        }


        /**
         * Initialize the proxy for a user's wallet.
         * Proxies are used to make trades on behalf of the order's maker so that
         *  trades can happen when the maker isn't online.
         * Internal method exposed for dev flexibility.
         * @param accountAddress The user's wallet address
         */
        async _initializeProxy(accountAddress) {
            const txnData = {from: accountAddress};
            const gasEstimate = await this._wyvernProtocol.wyvernProxyRegistry.registerProxy.estimateGasAsync(txnData);
            const transactionHash = await this._wyvernProtocol.wyvernProxyRegistry.registerProxy.sendTransactionAsync({
                ...txnData, gas: this._correctGasAmount(gasEstimate),
            });

            await this._confirmTransaction(transactionHash, types.EventType.InitializeAccount, "Initializing proxy for account", async () => {
                const polledProxy = await this._getProxy(accountAddress);
                return !!polledProxy;
            });

            const proxyAddress = await this._getProxy(accountAddress, 10);
            if (!proxyAddress) {
                throw new Error("Failed to initialize your account :( Please restart your wallet/browser and try again!");
            }

            return proxyAddress;
        }

        async _confirmTransaction(transactionHash, event, description, testForSuccess) {
            if (transactionHash == types.NULL_BLOCK_HASH) {
                // This was a smart contract wallet that doesn't know the transaction
                if (!testForSuccess) {
                    return;
                }
                return await this._pollCallbackForConfirmation(event, description, testForSuccess);
            }
            // Normal wallet
            try {
                await util.confirmTransaction(this.web3, transactionHash);
            } catch (error) {
                throw error;
            }
        }

        async _getProxy(accountAddress, retries = 0) {
            let proxyAddress = await this._wyvernProtocol.wyvernProxyRegistry.proxies.callAsync(accountAddress);

            if (proxyAddress == "0x") {
                throw new Error("Couldn't retrieve your account from the blockchain - make sure you're on the correct Ethereum network!");
            }

            if (!proxyAddress || proxyAddress === types.NULL_ADDRESS) {
                if (retries > 0) {
                    await delay(1000);
                    return await this._getProxy(accountAddress, retries - 1);
                }
                proxyAddress = null;
            }
            return proxyAddress;
        }

        /**
         * For a fungible token to use in trades (like W-ETH), get the amount
         *  approved for use by the Wyvern transfer proxy.
         * Internal method exposed for dev flexibility.
         * @param param0 __namedParameters Object
         * @param accountAddress Address for the user's wallet
         * @param tokenAddress Address for the token's contract
         * @param proxyAddress User's proxy address. If undefined, uses the token transfer proxy address
         */
        async _getApprovedTokenCount({accountAddress, tokenAddress, proxyAddress}) {
            if (!tokenAddress) {
                tokenAddress = WyvernSchemas.tokens[this._networkName].canonicalWrappedEther.address;
            }
            const addressToApprove = proxyAddress || WyvernProtocol.getTokenTransferProxyAddress(this._networkName);
            const approved = await util.rawCall(this.web3, {
                from: accountAddress,
                to: tokenAddress,
                data: WyvernSchemas.encodeCall(getMethod(ERC20, "allowance"), [accountAddress, addressToApprove,]),
            });
            return util.makeBigNumber(approved);
        }

        /**
         * Check if an account, or its proxy, owns an asset on-chain
         * @param accountAddress Account address for the wallet
         * @param proxyAddress Proxy address for the account
         * @param wyAsset asset to check. If fungible, the `quantity` attribute will be the minimum amount to own
         * @param schemaName WyvernSchemaName for the asset
         */
        async _ownsAssetOnChain({accountAddress, proxyAddress, wyAsset, schemaName}) {
            const asset = {
                tokenId: wyAsset.id || null, tokenAddress: wyAsset.address, schemaName,
            };

            const minAmount = new BigNumber("quantity" in wyAsset ? wyAsset.quantity : 1);

            const accountBalance = await this.getAssetBalance({
                accountAddress, asset,
            });
            if (accountBalance.greaterThanOrEqualTo(minAmount)) {
                return true;
            }

            proxyAddress = proxyAddress || (await this._getProxy(accountAddress));
            if (proxyAddress) {
                const proxyBalance = await this.getAssetBalance({
                    accountAddress: proxyAddress, asset,
                });
                if (proxyBalance.greaterThanOrEqualTo(minAmount)) {
                    return true;
                }
            }

            return false;
        }


        async _pollCallbackForConfirmation(event, description, testForSuccess) {
            return new Promise(async (resolve, reject) => {
                const initialRetries = 60;

                const testResolve = async (retries) => {
                    const wasSuccessful = await testForSuccess();
                    if (wasSuccessful) {
                        return resolve();
                    } else if (retries <= 0) {
                        return reject();
                    }

                    await delay(5000);
                    return testResolve(retries - 1);
                };

                return (await testResolve(initialRetries));
            });
        }

        /**
         * Validate against Wyvern that a buy and sell order can match
         * @param param0 __namedParameters Object
         * @param buy The buy order to validate
         * @param sell The sell order to validate
         * @param accountAddress Address for the user's wallet
         * @param shouldValidateBuy Whether to validate the buy order individually.
         * @param shouldValidateSell Whether to validate the sell order individually.
         * @param retries How many times to retry if validation fails
         */
        async _validateMatch({
                                 buy, sell, accountAddress, shouldValidateBuy = false, shouldValidateSell = false,
                             }, retries = 1) {
            try {
                if (shouldValidateBuy) {
                    const buyValid = await this._validateOrder(buy);

                    if (!buyValid) {
                        throw new Error("Invalid buy order. It may have recently been removed. Please refresh the page and try again!");
                    }
                }

                if (shouldValidateSell) {
                    const sellValid = await this._validateOrder(sell);
                    if (!sellValid) {
                        throw new Error("Invalid sell order. It may have recently been removed. Please refresh the page and try again!");
                    }
                }

                await util.requireOrdersCanMatch(this._getClientsForRead(retries).wyvernProtocol, {
                    buy, sell, accountAddress
                });

                await util.requireOrderCalldataCanMatch(this._getClientsForRead(retries).wyvernProtocol, {
                    buy, sell
                });

                return true;
            } catch (error) {
                if (retries <= 0) {
                    throw new Error(`Error matching this listing: ${error instanceof Error ? error.message : ""}. Please contact the maker or try again later!`);
                }
                await delay(500);
                return await this._validateMatch({
                    buy, sell, accountAddress, shouldValidateBuy, shouldValidateSell
                }, retries - 1);
            }
        }

        async _validateOrder(order) {
            const isValid = await this._wyvernProtocol.wyvernExchange.validateOrder_.callAsync([order.exchange, order.maker, order.taker, order.feeRecipient, order.target, order.staticTarget, order.paymentToken,], [order.makerRelayerFee, order.takerRelayerFee, order.makerProtocolFee, order.takerProtocolFee, order.basePrice, order.extra, order.listingTime, order.expirationTime, order.salt,], order.feeMethod, order.side, order.saleKind, order.howToCall, order.calldata, order.replacementPattern, order.staticExtradata, order.v || 0, order.r || types.NULL_BLOCK_HASH, order.s || types.NULL_BLOCK_HASH);

            return isValid;
        }

        /**
         * Compute the gas amount for sending a txn
         * Will be slightly above the result of estimateGas to make it more reliable
         * @param estimation The result of estimateGas for a transaction
         */
        _correctGasAmount(estimation) {
            return Math.ceil(estimation * types.DEFAULT_GAS_INCREASE_FACTOR);
        }


    }

    if (

        typeof module === 'object') {
        module.exports = NftAutoBuy;
    } else {
        exports.Mt = NftAutoBuy;
    }
})(typeof module === 'undefined' || module, this);

