const {NftAutoBuy} = require('../index');

async function testNftAutoBuy() {
    let NAB = new NftAutoBuy("main")// only support main net
    let param = {
        privateKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        contract: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        rpcUrl: "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
        orderPrice: 0.1,
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
