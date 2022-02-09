const {ERC721} = require("../src/ERC721v3")
const {ERC20} = require("../src/ERC20")

function getMethod(abi, name) {
    const methodAbi = abi.find((x) => x.type == "function" && x.name == name);
    if (!methodAbi) {
        throw new Error(`ABI ${name} not found`);
    }
    // Have to cast since there's a bug in
    // web3 types on the 'type' field
    return methodAbi;
}

module.exports = {
    ERC20,
    ERC721,
    getMethod
}
