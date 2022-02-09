const {NftAutoBuy} = require('../index');

async function testNftAutoBuy() {
    const HDWalletProvider = require("@truffle/hdwallet-provider")

    let NAB = new NftAutoBuy("main")// only support main net
    let param = {
        contract: "0xxxxxxxxxxxxxxxxxxxxx",
        orderPrice: 0.1,
        orderAmount: 1,
        web3Provider: new HDWalletProvider({
            privateKeys: ["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
            providerOrUrl: "https://mainnet.infura.io"
        }),
        interval: 5000
    }
    console.log(param.web3Provider.getAddress(0))

    let res = await NAB.addTask(param)
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
