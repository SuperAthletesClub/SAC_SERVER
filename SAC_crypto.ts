import Moralis from "moralis";
import MySQL from "../MySQL";
import AptosWalletClient from "./SAC_aptos-wallet";
import { AptosClient, CoinClient, AptosAccount, Provider, AptosToken, HexString, Network } from "aptos";
import config from "../config";
import { getPrivateKey } from "./SACWallet";

const db = MySQL.write();
const APTOS_NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1";
const APTOS_FAUCET_URL = "https://faucet.net.aptoslabs.com";
const aptosAccount = new AptosWalletClient(APTOS_NODE_URL, APTOS_FAUCET_URL);

const aptos = new AptosClient(config.aptos_rpc);
const coinClient = new CoinClient(aptos);

const aptosProvider = new Provider(Network.TESTNET);
const aptosTokenClient = new AptosToken(aptosProvider);

let moralis_init = null;
async function initMoralis() {
    if (moralis_init == null) {
        moralis_init = false;
        await Moralis.start({
            apiKey: config.moralis_key,
        });
        moralis_init = true;
    }

    while (moralis_init === false) await new Promise(r => setTimeout(r, 1000));
}

export function isExponentialExpression(value) {
    console.log(value);
    return /\d+(?:\.\d+)?(?:e[+-]\d+)$/.test(value);
}

export async function aptosBalance(address: string) {
    try {
        await initMoralis();

        const response = await Moralis.AptosApi.wallets.getCoinBalancesByWallets({
            limit: 10,
            ownerAddresses: [address],
            network: config.apt_networkId,
        });

        return response.result.map(e => ({
            coinType: e.coinType,
            amount: e.amount.value,
        }));
    } catch (err) {
        console.log(err);
    }
    return null;
}

export async function aptosAllNfts(addaress: string) {
    let current_token: any[] = [];
    let offset = 0;
    while (1) {
        let arrs = await aptosProvider.getTokenOwnedFromCollectionAddress(HexString.ensure(addaress), config["apt_sac_contract"], {
            options: {
                offset: offset,
                limit: 100,
            },
            tokenStandard: "v2",
        });

        current_token = [
            ...current_token,
            ...arrs.current_token_ownerships_v2.map(e => ({
                tokenId: e.token_data_id,
                name: e.current_token_data?.token_name,
                amount: e.amount,
            })),
        ];

        if (arrs.current_token_ownerships_v2.length < 100) break;
        offset += 100;
    }
    return current_token;
}

export async function coinBalance(address, network) {
    if (network == "eth") {
        let v = await eth_web3.eth.getBalance(address);
        return Math.floor(Number(eth_web3.utils.fromWei(v, "ether")) * 1000000) / 1000000;
    } else if (network == "bfc") {
        let v = await bfc_web3.eth.getBalance(address);
        return Math.floor(Number(bfc_web3.utils.fromWei(v, "ether")) * 1000000) / 1000000;
    } else if (network == "apt") {
        let res = await aptosBalance(address);
        if (res) {
            let apt = res.find(v => v.coinType == "0x1::aptos_coin::AptosCoin");
            if (apt) {
                return Number(apt.amount.toDecimal(8));
            }
        }
        return 0;
    }
    throw `not support [coinbalance] [${network}]`;
}

function tokenAddress(network, token) {
    return config[`${network}_${token}_contract`];
}

export async function tokenBalance(address, network, token) {
    if (network == token) return await coinBalance(address, network);

    if (network == "eth") {
        return await web3BalanceOf(eth_web3, address, tokenAddress(network, token));
    } else if (network == "bfc") {
        return await web3BalanceOf(bfc_web3, address, tokenAddress(network, token));
    } else if (network == "apt") {
        let res = await aptosBalance(address);
        let apt = res.find(v => v.coinType == tokenAddress(network, token));
        if (apt) {
            return Number(apt.amount.toDecimal(8));
        }
        return 0;
    }

    throw `not support [tokenBalance] [${network}]`;
}

export async function aptTransferNFT(fromPK: string, toAddress: string, tokenId: number) {
    const ra = aptosAccount.getAccountFromMnemonic(fromPK, "0");
    const alice = new AptosAccount(ra.data.signingKey.secretKey);

    let token = await db.one("SELECT apt_data_id FROM TB_NFT_METADATA WHERE tokenId=?", [tokenId]);

    const trx = await aptosTokenClient.transferTokenOwnership(alice, HexString.ensure(token.apt_data_id), toAddress);
    await aptos.waitForTransaction(trx);

    let res = (await aptos.getTransactionByHash(trx)) as any;
    return {
        version: res.version,
        hash: res.hash,
        state_change_hash: res.state_change_hash,
        event_root_hash: res.event_root_hash,
        state_checkpoint_hash: res.state_checkpoint_hash,
        gas_used: res.gas_used,
        apt_gas_used: res.gas_used / 1000000,
        success: res.success,
        vm_status: res.vm_status,
    };
}

export async function aptosSend(mnemonic, to, value) {
    const ra = aptosAccount.getAccountFromMnemonic(mnemonic, "0");
    console.log("aptosSend>", mnemonic, to, value);

    const alice = new AptosAccount(ra.data.signingKey.secretKey);
    const amount = Math.floor(value * 10 ** 8);
    const prev_balance = await coinClient.checkBalance(alice);

    console.log(prev_balance, amount, prev_balance >= amount);
    if (prev_balance >= amount) {
        const trx = await coinClient.transfer(alice, to, amount, { gasUnitPrice: BigInt(100) });
        await aptos.waitForTransaction(trx);
        const next_balance = await coinClient.checkBalance(alice);

        if (prev_balance > next_balance) {
            return trx;
        }
    }
    return null;
}

export async function transferCoin(userId, network, toAddress, value) {
    let wallet = await getPrivateKey(userId);

    if (network == "eth") {
        let result = await ethSend(wallet.eth.privateKey, toAddress, value);

        let gas = BigInt(result.effectiveGasPrice) * BigInt(result.gasUsed);
        return {
            gasUsed: eth_web3.utils.fromWei(gas.toString(), "ether"),
            hash: result.transactionHash,
        };
    } else if (network == "bfc") {
        let result = await bfcSend(wallet.eth.privateKey, toAddress, value);
        let gas = BigInt(result.effectiveGasPrice) * BigInt(result.gasUsed);
        return {
            gasUsed: eth_web3.utils.fromWei(gas.toString(), "ether"),
            hash: result.transactionHash,
        };
    } else if (network == "apt") {
        let hash = await aptosSend(wallet.aptos.privateKey, toAddress, value);
        return {
            gasUsed: 0.05, // TODO
            hash: hash,
        };
    }
    return null;
}

export async function withdrawalCoin(reqId, network, token, userId, toAddress, amount, usingVault = false) {
    if (amount < 0) return;

    let fromAddress = "";
    let error = null;
    try {
        let wallet = await getPrivateKey(userId);
        if (wallet) {
            let hash = await (async function () {
                if (network == "eth") {
                    // ...
                } else if (network == "bfc") {
                    // ...
                } else if (network == "apt") {
                    if (token == "apt") {
                        fromAddress = wallet.aptos.address;
                        return await aptosSend(wallet.aptos.privateKey, toAddress, amount);
                    }
                }
            })();
            if (hash) {
                await db.query(
                    `
                    UPDATE TB_USER_WITHDRAWAL_REQUEST SET hash=? WHERE reqId=?
                `,
                    [hash, reqId]
                );
                return hash;
            }
        }
    } catch (err) {
        console.log(err);
        error = err;
    }

    await db.query(
        `
        INSERT INTO TB_USER_WITHDRAWAL_ERROR (network, token, userId, fromAddress, toAddress, amount, errorStr, addedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW());
    `,
        [network, token, userId, fromAddress, toAddress, amount, error ? error.toString() : ""]
    );
    return null;
}
