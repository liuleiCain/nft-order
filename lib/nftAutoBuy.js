(function (module, exports) {
    const ErrorInfo = {
        "ERROR": 100,
        "NOT_DATA": 101,
        "BUY_ERROR": 102,
        "START_BUY_NFT": 200,
        "SUCCEED": 300,
        "TASK_END": 301,
        "BUY_SUCCESS": 302
    }
    const axios = require('axios');
    const EventEmitter = require('events')
    const HDWalletProvider = require("@truffle/hdwallet-provider")
    const BN = require('bn.js');
    const util = require("../src/util.js")
    const types = require('../src/type')
    const openSea = require("./openSea")
    const assert = require("assert")

    class NftAutoBuy {
        constructor(networkName, taskStorage) {
            this.emitter = new EventEmitter()
            this.taskList = {}
            this._networkName = networkName

            if (Object.values(types.Network).indexOf(networkName) === -1) {
                assert(false, "Network name is not existed")
            }

            if (typeof taskStorage === "object" && taskStorage.length > 0) {
                taskStorage.forEach(function (item) {
                    if (!this._checkTaskError(item)) {
                        this.addTask(item)
                    }
                }, this)
            }
        }

        async addTask(task) {
            try {
                let that = this
                let checkTaskError = this._checkTaskError(task)
                if (checkTaskError) {
                    throw new Error(checkTaskError)
                }
                if (this.checkTaskIsExist(task.contract)) {
                    throw new Error("Task already exists")
                }
                let taskName = this.getTaskName(task.contract)

                this.taskList[taskName] = task
                this.taskList[taskName]._web3Provider = new HDWalletProvider({
                    privateKeys: [task.privateKey],
                    providerOrUrl: task.rpcUrl
                })
                this.taskList[taskName]._opensea = new openSea(this._networkName, this.taskList[taskName]._web3Provider)
                task.orderPrice = new BN((task.orderPrice * Math.pow(10, 18)).toString())
                this.taskList[taskName].orderSuccessAmount = task.orderSuccessAmount || 0
                this.taskList[taskName].timeoutHandle = setTimeout(async function () {
                    await that._getGemOrdersList(taskName)
                }, task.interval)

                return {code: ErrorInfo.SUCCEED}
            } catch (e) {
                console.error(e)
                return {code: ErrorInfo.ERROR}
            }
        }

        removeTask(contract) {
            try {
                if (!this.checkTaskIsExist(contract)) {
                    throw new Error("Task not exists")
                }
                let taskName = this.getTaskName(contract)
                clearTimeout(this.taskList[taskName].timeoutHandle)
                delete this.taskList[taskName]
            } catch (e) {
                return {code: ErrorInfo.ERROR, msg: e.message}
            }
        }

        emit(name, code, data) {
            let param = {
                code: code
            }
            if (data) {
                param.data = data
            }
            this.emitter.emit(name, param)
        }

        checkTaskIsExist(contract) {
            let taskName = this.getTaskName(contract)
            return this.taskList.hasOwnProperty(taskName)
        }

        getTaskName(contract) {
            return contract.toString().toLowerCase()
        }

        getTask(contract) {
            let taskName = this.getTaskName(contract)
            return this.taskList[taskName]
        }

        async _getGemOrdersList(taskName) {
            let that = this
            let task = this.taskList[taskName]
            try {
                if (task.orderSuccessAmount >= task.orderAmount) {
                    this.emit(task.contract, ErrorInfo.TASK_END)
                    return;
                }

                let {data} = await axios({
                    method: "POST",
                    url: "https://gem.simon4545.workers.dev/",
                    data: {
                        "filters": {
                            "traits": {},
                            "traitsRange": {},
                            "searchText": "",
                            "address": task.contract,
                            "price": {"symbol": "ETH", "high": task.orderPrice.toString(10)}
                        }, "sort": {"currentEthPrice": "asc"}, "fields": {
                            "id": 1,
                            "currentBasePrice": 1,
                            "paymentToken": 1,
                            "marketplace": 1,
                            "tokenId": 1,
                            "priceInfo": 1,
                            "sellOrders": 1,
                            "startingPrice": 1
                        }, "offset": 0, "limit": 10, "markets": [], "status": ["buy_now"]
                    }
                })
                if (!data || !data.hasOwnProperty("data") || data.data.length <= 0) {
                    throw new Error("No matching order")
                }

                let account = task._web3Provider.getAddress(0)
                for (let v of data.data) {
                    let hash = await this._checkAndBuyNft(account, task.contract, v.id)
                    if (!hash) continue;

                    this.taskList[taskName].orderSuccessAmount++
                    this.emit(task.contract, ErrorInfo.BUY_SUCCESS, {hash: hash})

                    if (this.taskList[taskName].orderSuccessAmount >= this.taskList[taskName].orderAmount) break;
                }

                if (this.taskList[taskName].orderSuccessAmount >= this.taskList[taskName].orderAmount) {
                    this.emit(task.contract, ErrorInfo.TASK_END)
                } else {
                    this.taskList[taskName].timeoutHandle = setTimeout(async function () {
                        await that._getGemOrdersList(taskName)
                    }, task.interval)
                }
            } catch (e) {
                console.error(e)
                this.emit(task.contract, ErrorInfo.NOT_DATA)
                this.taskList[taskName].timeoutHandle = setTimeout(async function () {
                    await that._getGemOrdersList(taskName)
                }, task.interval)
            }
        }

        /*
        * @notice Check if there is a matching nft order and buy it if there is one
        * @param account User's account address
        * @param contract NFT contract address
        * @param tokenId MFT token id
        * @param interval Time to obtain order data regularly
        */
        async _checkAndBuyNft(account, contract, tokenId) {
            try {
                this.emit(contract, ErrorInfo.START_BUY_NFT, {
                    contract: contract,
                    tokenId: tokenId
                })
                let taskName = this.getTaskName(contract)
                let url = this._networkName === types.Network.Main ? `${types.API_BASE_MAINNET}/api/v1/asset/${contract}/${tokenId}/` : `${types.API_BASE_RINKEBY}/api/v1/asset/${contract}/${tokenId}/`
                let {data} = await axios({
                    method: "GET",
                    url: url,
                    headers: {
                        "x-api-key": "",
                        "Accept": "application/json"
                    }
                })

                if (!data.hasOwnProperty("orders") || data.orders.length <= 0) {
                    throw new Error("No order matched to auction")
                }

                let order = this._checkPriceMatch(this.taskList[taskName].orderPrice, data.orders)
                if (!order) {
                    throw new Error("No order with the right price matched")
                }

                return await this._sendAuctionRequest(this.taskList[taskName], order, account);
            } catch (e) {
                console.error(e)
                this.emit(contract, ErrorInfo.BUY_ERROR, {
                    tokenId: tokenId
                })
                return false
            }
        }

        async _sendAuctionRequest(taskHandle, order, accountAddress, recipientAddress, referrerAddress) {
            const {matchingOrder} = taskHandle._opensea._makeMatchingOrder({
                order, accountAddress, recipientAddress: recipientAddress || accountAddress,
            });

            const {buy, sell} = util.assignOrdersToSides(order, matchingOrder);
            const metadata = taskHandle._opensea._getMetadata(order, referrerAddress);
            return await taskHandle._opensea._atomicMatch({
                buy, sell, accountAddress, metadata,
            });
        }

        _checkPriceMatch(orderPrice, orders) {
            try {
                let order = null;
                let sellMinPrice = null;

                for (let v of orders) {
                    let currentPrice = new BN(parseInt(v.current_price).toString(10))
                    if (v.side === 1) {
                        if (parseInt(v.expiration_time) * 1000 <= Date.now() || currentPrice.gt(orderPrice) || (sellMinPrice && sellMinPrice.lt(currentPrice))) {
                            continue
                        }
                        order = v;
                        sellMinPrice = currentPrice
                    }
                }
                if (!order) throw new Error("No order")

                order.maker = order.maker.address
                order.taker = order.taker.address
                order.makerRelayerFee = order.maker_relayer_fee
                order.takerRelayerFee = order.taker_relayer_fee
                order.makerProtocolFee = order.maker_protocol_fee
                order.takerProtocolFee = order.taker_protocol_fee
                order.makerReferrerFee = order.maker_referrer_fee
                order.feeRecipient = order.fee_recipient.address
                order.feeMethod = order.fee_method
                order.saleKind = order.sale_kind
                order.howToCall = order.how_to_call
                order.replacementPattern = order.replacement_pattern
                order.staticTarget = order.static_target
                order.staticExtradata = order.static_extradata
                order.paymentToken = order.payment_token
                order.basePrice = order.base_price
                order.listingTime = order.listing_time
                order.expirationTime = order.expiration_time

                return order
            } catch (e) {
                console.error(e)
                return false
            }
        }

        _checkTaskError(task) {
            try {
                if ((!task.hasOwnProperty("privateKey") || typeof task.privateKey !== "string" || task.privateKey === "")) {
                    throw new Error("Private key error")
                }
                if (!task.hasOwnProperty("contract") || typeof task.contract !== "string" || task.contract === "") {
                    throw new Error("Contract address error")
                }
                if ((!task.hasOwnProperty("rpcUrl") || typeof task.rpcUrl !== "string" || task.rpcUrl === "")) {
                    throw new Error("Rpc url error")
                }
                if (!task.hasOwnProperty("orderPrice") || typeof task.orderPrice !== "number" || task.orderPrice <= 0) {
                    throw new Error("Order price error")
                }
                if (!task.hasOwnProperty("orderAmount") || typeof task.orderAmount !== "number" || task.orderAmount <= 0) {
                    throw new Error("Order amount error")
                }
                if ((!task.hasOwnProperty("interval") || typeof task.interval !== "number" || task.interval <= 0)) {
                    throw new Error("Interval timestamp error")
                }
                return false
            } catch (e) {
                return e.message;
            }
        }
    }

    if (typeof module === 'object') {
        module.exports = NftAutoBuy;
    } else {
        exports.Mt = NftAutoBuy;
    }
})(typeof module === 'undefined' || module, this);

