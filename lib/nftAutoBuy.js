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
    const {OpenSeaPort} = require("opensea-js")
    const {OrderSide} = require('opensea-js/lib/types')
    const axios = require('axios');
    const EventEmitter = require('events')
    const BN = require('bn.js');
    const HDWalletProvider = require("@truffle/hdwallet-provider")

    class NftAutoBuy {
        constructor(networkName, taskStorage) {
            this.emitter = new EventEmitter()
            this.taskList = {}
            this._networkName = networkName

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
                task.orderPrice = new BN((task.orderPrice * Math.pow(10, 18)).toString())
                this.taskList[taskName].orderSuccessAmount = task.orderSuccessAmount || 0
                this.taskList[taskName]._web3Provider = new HDWalletProvider({
                    privateKeys: [task.privateKey],
                    providerOrUrl: task.rpcUrl
                })
                this.taskList[taskName]._seaport = new OpenSeaPort(this.taskList[taskName]._web3Provider, {
                    networkName: this._networkName,
                    apiKey: ""
                })
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
                        },
                        "sort": {"currentEthPrice": "asc"},
                        "fields": {
                            "id": 1,
                            "currentBasePrice": 1,
                            "paymentToken": 1,
                            "marketplace": 1,
                            "tokenId": 1,
                            "priceInfo": 1,
                            "sellOrders": 1,
                            "startingPrice": 1
                        },
                        "offset": 0,
                        "limit": 5,
                        "markets": [],
                        "status": ["buy_now"]
                    }
                })
                if (!data || !data.hasOwnProperty("data") || data.data.length <= 0) {
                    throw new Error("No matching order")
                }

                let account = task._web3Provider.getAddress(0)
                for (let v of data.data) {
                    let hash = await this._checkAndBuyNft(taskName, account, task.contract, v.id)
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
        async _checkAndBuyNft(taskName, account, contract, tokenId) {
            let task = this.taskList[taskName]
            try {
                this.emit(contract, ErrorInfo.START_BUY_NFT, {
                    contract: contract,
                    tokenId: tokenId
                })
                let taskName = this.getTaskName(contract)

                //get sell order
                let order = await task._seaport.api.getOrder({
                    side: OrderSide.Sell,
                    asset_contract_address: contract,
                    token_id: tokenId,
                    order_by: "eth_price",
                    order_direction: "asc"
                })
                if (!order) {
                    throw new Error("No order matched to auction")
                }

                // check order price is match
                let res = this._checkPriceMatch(this.taskList[taskName].orderPrice, order)
                if (!res) {
                    throw new Error("No order with the right price matched")
                }

                return await task._seaport.fulfillOrder({
                    order,
                    accountAddress: account // The address of your wallet, which will sign the transaction
                })
            } catch (e) {
                console.error(e)
                this.emit(contract, ErrorInfo.BUY_ERROR, {
                    tokenId: tokenId
                })
                return false
            }
        }

        _checkPriceMatch(orderPrice, order) {
            try {
                let currentPrice = order.currentPrice.toString(10)
                currentPrice = new BN(currentPrice)
                return currentPrice.lte(orderPrice) || false
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

