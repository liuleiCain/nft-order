const {ethers} = require("ethers");
const ethABI = require("ethereumjs-abi");
const types = require('../src/type')
const {WyvernProtocol} = require('wyvern-js')
const {BigNumber} = require("bignumber.js")

module.exports = {
    async getAccountAddress(pk) {
        try {
            const wallet = new ethers.Wallet(pk)
            return wallet.getAddress()
        } catch (e) {
            return false
        }
    }, makeBigNumber(arg) {
        // Zero sometimes returned as 0x from contracts
        if (arg === "0x") {
            arg = 0;
        }
        // fix "new BigNumber() number type has more than 15 significant digits"
        arg = arg.toString();
        return new BigNumber(arg);
    },

    assignOrdersToSides(order, matchingOrder) {
        const isSellOrder = order.side == types.OrderSide.Sell;

        let buy;
        let sell;
        if (!isSellOrder) {
            buy = order;
            sell = {
                ...matchingOrder, v: buy.v, r: buy.r, s: buy.s,
            };
        } else {
            sell = order;
            buy = {
                ...matchingOrder, v: sell.v, r: sell.r, s: sell.s,
            };
        }

        return {buy, sell};

    }, async confirmTransaction(web3, txHash) {
        return new Promise((resolve, reject) => {
            this.track(web3, txHash, (didSucceed) => {
                if (didSucceed) {
                    resolve("Transaction complete!");
                } else {
                    reject(new Error(`Transaction failed :( You might have already completed this action. See more on the mainnet at etherscan.io/tx/${txHash}`));
                }
            });
        });
    }, track(web3, txHash, onFinalized) {
        if (this.txCallbacks[txHash]) {
            this.txCallbacks[txHash].push(onFinalized);
        } else {
            this.txCallbacks[txHash] = [onFinalized];
            const poll = async () => {
                const tx = await web3.eth.getTransaction(txHash);
                if (tx && tx.blockHash && tx.blockHash !== types.NULL_BLOCK_HASH) {
                    const receipt = await web3.eth.getTransactionReceipt(txHash);
                    if (!receipt) {
                        console.warn("No receipt found for ", txHash);
                    }
                    const status = receipt ? parseInt((receipt.status || "0").toString()) == 1 : true;
                    this.txCallbacks[txHash].map((f) => f(status));
                    delete this.txCallbacks[txHash];
                } else {
                    setTimeout(poll, 1000);
                }
            };
            poll().catch();
        }
    }, encodeAtomicizedSell(schemas, assets, address, wyvernProtocol, networkName) {
        const atomicizer = wyvernProtocol.wyvernAtomicizer;

        const {
            atomicizedCalldata, atomicizedReplacementPattern
        } = encodeAtomicizedCalldata(atomicizer, schemas, assets, address, types.OrderSide.Sell);

        return {
            calldata: atomicizedCalldata,
            replacementPattern: atomicizedReplacementPattern,
            target: WyvernProtocol.getAtomicizerContractAddress(networkName),
        };
    }, encodeAtomicizedBuy(schemas, assets, address, wyvernProtocol, networkName) {
        const atomicizer = wyvernProtocol.wyvernAtomicizer;

        const {
            atomicizedCalldata, atomicizedReplacementPattern
        } = encodeAtomicizedCalldata(atomicizer, schemas, assets, address, types.OrderSide.Buy);

        return {
            calldata: atomicizedCalldata,
            replacementPattern: atomicizedReplacementPattern,
            target: WyvernProtocol.getAtomicizerContractAddress(networkName),
        };
    }, encodeSell(schema, asset, address) {
        const transfer = schema.functions.transfer(asset);
        return {
            target: transfer.target,
            calldata: this.encodeDefaultCall(transfer, address),
            replacementPattern: WyvernProtocol.encodeReplacementPattern(transfer),
        };
    }, encodeBuy(schema, asset, address) {
        const transfer = schema.functions.transfer(asset);
        const replaceables = transfer.inputs.filter((i) => i.kind === types.FunctionInputKind.Replaceable);
        const ownerInputs = transfer.inputs.filter((i) => i.kind === types.FunctionInputKind.Owner);

        // Validate
        if (replaceables.length !== 1) {
            throw new Error("Only 1 input can match transfer destination, but instead " + replaceables.length + " did");
        }

        // Compute calldata
        const parameters = transfer.inputs.map((input) => {
            switch (input.kind) {
                case types.FunctionInputKind.Replaceable:
                    return address;
                case types.FunctionInputKind.Owner:
                    return WyvernProtocol.generateDefaultValue(input.type);
                default:
                    try {
                        return input.value.toString();
                    } catch (e) {
                        console.error(schema);
                        console.error(asset);
                        throw e;
                    }
            }
        });
        const calldata = this.encodeCall(transfer, parameters);

        // Compute replacement pattern
        let replacementPattern = "0x";
        if (ownerInputs.length > 0) {
            replacementPattern = WyvernProtocol.encodeReplacementPattern(transfer, types.FunctionInputKind.Owner);
        }

        return {
            target: transfer.target, calldata, replacementPattern,
        };
    }, encodeCall(abi, parameters) {
        const inputTypes = abi.inputs.map((i) => i.type);
        return ("0x" + Buffer.concat([ethABI.methodID(abi.name, inputTypes), ethABI.rawEncode(inputTypes, parameters),]).toString("hex"));
    }, encodeDefaultCall(abi, address) {
        const parameters = abi.inputs.map((input) => {
            switch (input.kind) {
                case types.FunctionInputKind.Replaceable:
                    return WyvernProtocol.generateDefaultValue(input.type);
                case types.FunctionInputKind.Owner:
                    return address;
                case types.FunctionInputKind.Asset:
                default:
                    return input.value;
            }
        });
        return this.encodeCall(abi, parameters);
    }, getWyvernAsset(schema, asset, quantity = new BigNumber(1)) {
        const tokenId = asset.tokenId != null ? asset.tokenId.toString() : undefined;

        return schema.assetFromFields({
            ID: tokenId, Quantity: quantity.toString(), Address: asset.tokenAddress.toLowerCase(), Name: asset.name,
        });
    }, getOrderHash(order) {
        const orderWithStringTypes = {
            ...order,
            maker: order.maker.toLowerCase(),
            taker: order.taker.toLowerCase(),
            feeRecipient: order.feeRecipient.toLowerCase(),
            side: order.side.toString(),
            saleKind: order.saleKind.toString(),
            howToCall: order.howToCall.toString(),
            feeMethod: order.feeMethod.toString(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return WyvernProtocol.getOrderHashHex(orderWithStringTypes);
    }, validateAndFormatWalletAddress(web3, address) {
        if (!address) {
            throw new Error("No wallet address found");
        }
        if (!web3.isAddress(address)) {
            throw new Error("Invalid wallet address");
        }
        if (address == types.NULL_ADDRESS) {
            throw new Error("Wallet cannot be the null address");
        }
        return address.toLowerCase();
    }, async rawCall(web3, {from, to, data}) {
        try {
            return await web3.eth.call({
                from, to, data,
            });
        } catch (error) {
            // Backwards compatibility with Geth nodes
            return "0x";
        }
    }, /**
     * Send a transaction to the blockchain and optionally confirm it
     * @param web3 Web3 instance
     * @param param0 __namedParameters
     * @param from address sending transaction
     * @param to destination contract address
     * @param data data to send to contract
     * @param gasPrice gas price to use. If unspecified, uses web3 default (mean gas price)
     * @param value value in ETH to send with data. Defaults to 0
     * @param onError callback when user denies transaction
     */
    async sendRawTransaction(web3, {from, to, data, gasPrice, value = 0, gas}) {
        if (gas == null) {
            // This gas cannot be increased due to an error
            gas = await this.estimateGas(web3, {from, to, data, value});
        }

        try {
            const txHashRes = await web3.eth.sendTransaction({
                from, to, value, data, gas, gasPrice,
            });
            return txHashRes.toString();
        } catch (error) {
            throw error;
        }
    }, /**
     * Estimate Gas usage for a transaction
     * @param web3 Web3 instance
     * @param from address sending transaction
     * @param to destination contract address
     * @param data data to send to contract
     * @param value value in ETH to send with data
     */
    async estimateGas(web3, {from, to, data, value = 0}) {
        return await web3.eth.estimateGas({
            from, to, value, data,
        });
    }, /**
     * Estimates the price of an order
     * @param order The order to estimate price on
     * @param secondsToBacktrack The number of seconds to subtract on current time,
     *  to fix race conditions
     * @param shouldRoundUp Whether to round up fractional wei
     */
    estimateCurrentPrice(order, secondsToBacktrack = 30, shouldRoundUp = true) {
        let {basePrice, listingTime, expirationTime, extra} = order;
        const {side, takerRelayerFee, saleKind} = order;

        const now = new BigNumber(Math.round(Date.now() / 1000)).minus(secondsToBacktrack);
        basePrice = new BigNumber(basePrice);
        listingTime = new BigNumber(listingTime);
        expirationTime = new BigNumber(expirationTime);
        extra = new BigNumber(extra);

        let exactPrice = basePrice;

        if (saleKind === types.SaleKind.FixedPrice) {
            // Do nothing, price is correct
        } else if (saleKind === types.SaleKind.DutchAuction) {
            const diff = extra
                .times(now.minus(listingTime))
                .dividedBy(expirationTime.minus(listingTime));

            exactPrice = side == types.OrderSide.Sell ? /* Sell-side - start price: basePrice. End price: basePrice - extra. */
                basePrice.minus(diff) : /* Buy-side - start price: basePrice. End price: basePrice + extra. */
                basePrice.plus(diff);
        }

        // Add taker fee only for buyers
        if (side === types.OrderSide.Sell && !order.waitingForBestCounterOrder) {
            // Buyer fee increases sale price
            exactPrice = exactPrice.times(+takerRelayerFee / types.INVERSE_BASIS_POINT + 1);
        }

        return shouldRoundUp ? exactPrice.ceil() : exactPrice;
    }, /**
     * Debug the `ordersCanMatch` part of Wyvern
     * @param buy Buy order for debugging
     * @param sell Sell order for debugging
     */
    async requireOrdersCanMatch(client, {
        buy, sell, accountAddress,
    }) {
        const result = await client.wyvernExchange.ordersCanMatch_.callAsync([buy.exchange, buy.maker, buy.taker, buy.feeRecipient, buy.target, buy.staticTarget, buy.paymentToken, sell.exchange, sell.maker, sell.taker, sell.feeRecipient, sell.target, sell.staticTarget, sell.paymentToken,], [buy.makerRelayerFee, buy.takerRelayerFee, buy.makerProtocolFee, buy.takerProtocolFee, buy.basePrice, buy.extra, buy.listingTime, buy.expirationTime, buy.salt, sell.makerRelayerFee, sell.takerRelayerFee, sell.makerProtocolFee, sell.takerProtocolFee, sell.basePrice, sell.extra, sell.listingTime, sell.expirationTime, sell.salt,], [buy.feeMethod, buy.side, buy.saleKind, buy.howToCall, sell.feeMethod, sell.side, sell.saleKind, sell.howToCall,], buy.calldata, sell.calldata, buy.replacementPattern, sell.replacementPattern, buy.staticExtradata, sell.staticExtradata, {from: accountAddress});

        if (result) {
            return;
        }

        if (!(+buy.side == +SaleKindInterface.Side.Buy && +sell.side == +SaleKindInterface.Side.Sell)) {
            throw new Error("Must be opposite-side");
        }

        if (!(buy.feeMethod == sell.feeMethod)) {
            throw new Error("Must use same fee method");
        }

        if (!(buy.paymentToken == sell.paymentToken)) {
            throw new Error("Must use same payment token");
        }

        if (!(sell.taker == types.NULL_ADDRESS || sell.taker == buy.maker)) {
            throw new Error("Sell taker must be null or matching buy maker");
        }

        if (!(buy.taker == types.NULL_ADDRESS || buy.taker == sell.maker)) {
            throw new Error("Buy taker must be null or matching sell maker");
        }

        if (!((sell.feeRecipient == types.NULL_ADDRESS && buy.feeRecipient != types.NULL_ADDRESS) || (sell.feeRecipient != types.NULL_ADDRESS && buy.feeRecipient == types.NULL_ADDRESS))) {
            throw new Error("One order must be maker and the other must be taker");
        }

        if (!(buy.target == sell.target)) {
            throw new Error("Must match target");
        }

        if (!(buy.howToCall == sell.howToCall)) {
            throw new Error("Must match howToCall");
        }

        if (!SaleKindInterface.canSettleOrder(+buy.listingTime, +buy.expirationTime)) {
            throw new Error(`Buy-side order is set in the future or expired`);
        }

        if (!SaleKindInterface.canSettleOrder(+sell.listingTime, +sell.expirationTime)) {
            throw new Error(`Sell-side order is set in the future or expired`);
        }

        // Handle default, which is likely now() being diff than local time
        throw new Error("Error creating your order. Check that your system clock is set to the current date and time before you try again.");
    },

    /**
     * Debug the `orderCalldataCanMatch` part of Wyvern
     * @param buy Buy order for debugging
     * @param sell Sell Order for debugging
     */
    async requireOrderCalldataCanMatch(client, {buy, sell}) {
        const result = await client.wyvernExchange.orderCalldataCanMatch.callAsync(buy.calldata, buy.replacementPattern, sell.calldata, sell.replacementPattern);
        if (result) {
            return;
        }
        throw new Error("Unable to match offer data with auction data.");
    }
}

const SaleKindInterface = {
    Side: types.OrderSide, SaleKind: types.SaleKind,

    validateParameters(saleKind, expirationTime) {
        return saleKind === saleKind.FixedPrice || expirationTime > 0;
    },

    canSettleOrder(listingTime, expirationTime) {
        const now = Math.round(Date.now() / 1000);
        return listingTime < now && (expirationTime === 0 || now < expirationTime);
    },
};

function encodeAtomicizedCalldata(atomicizer, schemas, assets, address, side) {
    const encoder = side === types.OrderSide.Sell ? encodeSell : encodeBuy;

    try {
        const transactions = assets.map((asset, i) => {
            const schema = schemas[i];
            const {target, calldata} = encoder(schema, asset, address);
            return {
                calldata, abi: schema.functions.transfer(asset), address: target, value: new BigNumber(0),
            };
        });

        const atomicizedCalldata = atomicizer.atomicize.getABIEncodedTransactionData(transactions.map((t) => t.address), transactions.map((t) => t.value), transactions.map((t) => new BigNumber((t.calldata.length - 2) / 2)), // subtract 2 for '0x', divide by 2 for hex
            transactions.map((t) => t.calldata).reduce((x, y) => x + y.slice(2)) // cut off the '0x'
        );

        const kind = side === types.OrderSide.Buy ? types.FunctionInputKind.Owner : undefined;

        const atomicizedReplacementPattern = WyvernProtocol.encodeAtomicizedReplacementPattern(transactions.map((t) => t.abi), kind);

        if (!atomicizedCalldata || !atomicizedReplacementPattern) {
            throw new Error(`Invalid calldata: ${atomicizedCalldata}, ${atomicizedReplacementPattern}`);
        }
        return {
            atomicizedCalldata, atomicizedReplacementPattern,
        };
    } catch (error) {
        console.error({schemas, assets, address, side});
        throw new Error(`Failed to construct your order: likely something strange about this type of item. OpenSea has been notified. Please contact us in Discord! Original error: ${error}`);
    }
}
