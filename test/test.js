const {NftAutoBuy} = require('../index');
const Web3 = require("web3")

async function testNftAutoBuy() {
    const provider = new Web3.providers.HttpProvider('https://mainnet.infura.io/v3/2a4a86c77f1f468f83a5450a1d6be263')
    let NAB = new NftAutoBuy("main", provider)// only support main net
    let param = {
        privateKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        account: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        contract: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        rpcUrl: "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
        orderPrice: 1,
        orderAmount: 1,
        interval: 5000
    }

    let res = await NAB.addTask(param)
    console.log("addTask", res)

    if (res.code === 300) {
        NAB.emitter.on(param.contract, function (arg) {
            console.log(new Date().toLocaleString(), arg)
            if (arg.code === 300) {
                console.log("Del begin:", NAB.getTask(param.contract))
                NAB.removeTask(param.contract)
                console.log("Del end:", NAB.getTask(param.contract))
            }
        })
    }
}

testNftAutoBuy()
