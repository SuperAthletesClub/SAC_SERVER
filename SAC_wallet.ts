import fs from "fs";
import AptosWalletClient from "./aptos-wallet";
import aes256 from "aes256";
import config from "../config";
import { log } from "../util/logger";
import MySQL from "../MySQL";
import {
    aptTransferNFT,
    aptosAllNfts,
    aptosSend,
    coinBalance,
    tokenBalance,
    transferCoin,
} from "./SAC_crtpto";
import { numCommas } from "./string";

const db = MySQL.write();
const APTOS_NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1";
const APTOS_FAUCET_URL = "https://faucet.net.aptoslabs.com";
const aptosClient = new AptosWalletClient(APTOS_NODE_URL, APTOS_FAUCET_URL);

export enum TokenType {
    eth = "eth",
    esat = "esat",
    bsat = "bsat",
    bfc = "bfc",
    usdc = "usdc",
    usdt = "usdt",
    apt = "apt",
}

export enum NetworkType {
    eth = "eth",
    bfc = "bfc",
    apt = "apt",
}

function encrypt(str, key) {
    return aes256.encrypt(key, str);
}

function decrypt(encrypted, key) {
    return aes256.decrypt(key, encrypted);
}

export function TokenTypeToNetwork(type: TokenType) {
    switch (type) {
        case TokenType.eth:
            return "eth";
        case TokenType.esat:
            return "eth";
        case TokenType.bsat:
            return "bfc";
        case TokenType.bfc:
            return "bfc";
        case TokenType.usdc:
            return "eth";
        case TokenType.usdt:
            return "eth";
        case TokenType.apt:
            return "apt";
    }
}
export function TokenTypeToTokenName(type: TokenType) {
    switch (type) {
        case TokenType.eth:
            return "eth";
        case TokenType.esat:
            return "sat";
        case TokenType.bsat:
            return "sat";
        case TokenType.bfc:
            return "bfc";
        case TokenType.usdc:
            return "usdc";
        case TokenType.usdt:
            return "usdt";
        case TokenType.apt:
            return "apt";
    }
}
let _reentrancy = {};
async function preventReentrancy(key, func) {
    // ...
}

export async function assignWalletToUser(userId: number) {
    try {
        const aptWallet = await aptosClient.createNewAccount();
        const ethWallet = EthWallet.generate();

        const walletInfo = {
            eth: {
                address: ethWallet.getAddressString(),
                privateKey: ethWallet.getPrivateKeyString(),
            },
            aptos: {
                address: aptWallet.data.accountAddress.hexString,
                privateKey: aptWallet.mnemonic,
            },
        };

        let encrypted = encrypt(JSON.stringify(walletInfo), config.db_write_pass);
        return walletInfo;
    } catch (err) {
        log("error", "assign to wallet error : " + err);
    }

    return false;
}

export async function getPrivateKey(userId: number) {
    let r = await db.one("SELECT * FROM TB_USER_WALLET WHERE userId=?", [userId]);
    if (r) {
        const data = decrypt(r.encryptedData, config.db_write_pass);
        if (data) {
            let json = JSON.parse(data);
            return json;
        }
    }
    return null;
}

export async function refreshNFTWallet(ethAddress, aptosAddress) {
    const ethNft = await ethAllNfts(ethAddress);
    const bfcNft = await bfcAllNfts(ethAddress);
    const aptNft = await aptosAllNfts(aptosAddress);

    const allNFTs = [
        ...ethNft.map(v => ["eth", v, ethAddress]),
        ...bfcNft.map(v => ["bfc", v, ethAddress]),
        ...aptNft.map(v => ["apt", v.name.split("#")[1], aptosAddress]),
    ];

    if (allNFTs.length) {
        // ...
    }
}

var userRefreshed: any = {};
export async function refreshWallet(userId: number, force = false) {
    if (force == false) {
        const refresh = userRefreshed[userId];
        if (refresh && refresh > Date.now()) {
            return;
        } else {
            userRefreshed[userId] = Date.now() + 1000 * 60 * 5;
        }
    }

    let userWallet = await getPrivateKey(userId);

    const eth = await coinBalance(userWallet["eth"].address, "eth");
    const eusdt = await tokenBalance(userWallet["eth"].address, "eth", "usdt");
    const eusdc = await tokenBalance(userWallet["eth"].address, "eth", "usdc");
    const esat = await tokenBalance(userWallet["eth"].address, "eth", "sat");

    const bfc = await coinBalance(userWallet["eth"].address, "bfc");
    const bsat = await tokenBalance(userWallet["eth"].address, "bfc", "sat");

    const apt = await coinBalance(userWallet["aptos"].address, "apt");

    await refreshNFTWallet(userWallet["eth"].address, userWallet["aptos"].address);

    return {
        eth,
        eusdt,
        eusdc,
        esat,
        bfc,
        bsat,
        apt,
    };
}


export async function withdrawal(user: User, name: TokenType, amount: number, toaddress: string) {
    if (amount <= 0) return false;
    return await preventReentrancy("withdrawal", async function (logger, uid) {
        const userId = user.userId;
        const network = TokenTypeToNetwork(name);
        const token = TokenTypeToTokenName(name);
        const walletNetwork = network == "bfc" ? "eth" : network == "apt" ? "aptos" : network;
        const networkGas = TransferNetworkFee[network];

        let userWallet = await getPrivateKey(userId);

        let insertId = insert.insertId;
        const currCoin = await coinBalance(userWallet[walletNetwork].address, network);
        const currToken = await tokenBalance(userWallet[walletNetwork].address, network, token);

        let tx = "";
        let gasUsed = 0;
        if (token == network) {
            if (currCoin >= amount + networkGas) {
                await logger(`start transfer coin -> ${userId}, ${network}, ${toaddress}, ${name}, ${amount}`);
                let result = await transferCoin(userId, network, toaddress, amount);
                await logger(`success transfer coin -> ${JSON.stringify(result)}`);

                tx = result.hash;
                gasUsed = Number(result.gasUsed);
            } else {
                throw `not enough coin [withdrawal] ${userId} : ${name} : ${amount}`;
            }
        }

        await refreshWallet(userId, true);
        if (tx) {
            // ...
        }
        await logger(`withdrawal success -> ${insertId}`);

        return true;
    });
}

export async function toWallet(userId: number, name: TokenType, amount: number) {
    if (amount <= 0) return false;
    return await preventReentrancy("toWallet", async function (logger, uid) {

        const network = TokenTypeToNetwork(name);
        const token = TokenTypeToTokenName(name);
        const vaultAddress = config["sat_vault_address_" + network];
        const vaultPk = config["sat_vault_pk_" + network];
        if (vaultAddress == null) throw "vaultAddress is null";

        const walletNetwork = network == "bfc" ? "eth" : network == "apt" ? "aptos" : network;
        const walletFee = ToWalletFee[network];
        let userWallet = await getPrivateKey(userId);

        let hashes = [];
        let feeAmount = 0;
        if (token == network) {
            if (curToken[network] >= amount + walletFee) {
                await logger(`send coin -> ${userId}, ${name}, ${amount}`);
                await updateSpending(userId, network, token, (amount + walletFee) * -1, uid, `to wallet:${userId}, ${name}, ${amount}`, logger, true);

                let r = null;
                if (network == "eth") {
                    r = await ethSend(vaultPk, userWallet[walletNetwork].address, amount);
                } else if (network == "bfc") {
                    r = await bfcSend(vaultPk, userWallet[walletNetwork].address, amount);
                } else if (network == "apt") {
                    r = await aptosSend(vaultPk, userWallet[walletNetwork].address, amount);
                } else {
                    throw "not support network";
                }

                feeAmount = walletFee;

                await logger(`send coin success -> ${JSON.stringify(r)}`);
            } else {
                throw `not enough coin [toWallet] ${userId} : ${name} : amount=${amount} : walletFee=${walletFee}`;
            }
        } 

        await refreshWallet(userId, true);

        return true;
    });
}

export async function toSpending(userId: number, name: TokenType, amount: number) {
    if (amount <= 0) return false;

    return await preventReentrancy("toSpending", async function (logger, uid) {

        const network = TokenTypeToNetwork(name);
        const token = TokenTypeToTokenName(name);
        const vaultAddress = config["sat_vault_address_" + network];
        if (vaultAddress == null) throw "vaultAddress is null";

        let walletNetwork = network == "bfc" ? "eth" : network == "apt" ? "aptos" : network;
        let userWallet = await getPrivateKey(userId);
        const currCoin = await coinBalance(userWallet[walletNetwork].address, network);
        const currToken = await tokenBalance(userWallet[walletNetwork].address, network, token);

        const networkGas = TransferNetworkFee[network];
        const spendFee = ToSpendFee[network];

        let hashes = [];
        let feeAmount = 0;
        if (token == network) {
            if (currCoin >= amount + spendFee) {
                await logger(`start transfer coin -> ${userId}, ${network}, ${vaultAddress}, ${name}, ${amount}`);
                let result = await transferCoin(userId, network, vaultAddress, amount);
                await logger(`success transfer coin -> ${JSON.stringify(result)}`);

                await updateSpending(userId, network, network, amount, uid, `to spending:${userId}, ${name}, ${amount}`, logger, true);
                await logger(`update spending table 1`);

                let gasUsed = Number(result.gasUsed);
                feeAmount = Math.floor((spendFee - gasUsed - networkGas) * 1000000) / 1000000;

                feeAmount += gasUsed;
            } else {
                throw `not enough coin [toSpending] ${userId} : ${name} : ${amount}`;
            }
        }

        await refreshWallet(userId, true);

        return true;
    });
}


export async function withdrawalNFT(userId, tokenId, network, toAddress) {
    return await preventReentrancy("withdrawal nft", async function (logger, uuid) {
        const walletNetwork = network == "bfc" ? "eth" : network == "apt" ? "aptos" : network;
        const userWallet = await getPrivateKey(userId);
        await refreshNFTWallet(userWallet.eth.address, userWallet.aptos.address);

        let token = await db.one(
            `
            SELECT * 
            FROM TB_NFT_NETWORK_OWNER
            WHERE address=? AND network=? AND tokenId=?
        `,
            [userWallet[walletNetwork].address, network, tokenId]
        );

        if (token) {
            const nftFee = WithdrawalNFTFee[network];
            const vaultAddress = config["sat_vault_address_" + network];
            const networkGas = TransferNetworkFee[network];

            let gasUsed = 0;
            if (network == "eth") {
                let rs = await ethTransferNFT(userWallet[walletNetwork].privateKey, toAddress, tokenId);
                gasUsed = rs.ethGasUsed;
            } else if (network == "bfc") {
                let rs = await bfcTransferNFT(userWallet[walletNetwork].privateKey, toAddress, tokenId);
                gasUsed = rs.ethGasUsed;
            } else if (network == "apt") {
                let rs = await aptTransferNFT(userWallet[walletNetwork].privateKey, toAddress, tokenId);
                gasUsed = rs.apt_gas_used;
            }

            await refreshNFTWallet(userWallet.eth.address, userWallet.aptos.address);
            await refreshNFTWallet(config.sat_vault_address_eth, config.sat_vault_address_apt);

            return true;
        } else {
            throw `it's not my nft : (${userId}, ${tokenId}, ${network}, ${toAddress})`;
        }
    });
}

export async function toSpendingNFT(userId, tokenId) {
    return await preventReentrancy("to spending nft", async function (logger, uuid) {
        const userWallet = await getPrivateKey(userId);
        await refreshNFTWallet(userWallet.eth.address, userWallet.aptos.address);

        let u = await db.one(`SELECT * FROM TB_USER_NFTS WHERE tokenId=?`, [tokenId]);
        if (u) {
            await sendMessage(DiscordChannel.SF__FATAL_CHANNEL, `**[ERROR] NFT ALREADY OFFCHAIN!**\n${userId} / ${tokenId}`);
            throw "nft already offchain!";
        }

        const network = token.network;
        const nftFee = ToSpendingNFTFee[network];
        const vaultAddress = config["sat_vault_address_" + network];
        const networkGas = TransferNetworkFee[network];

        let gasUsed = 0;
        if (network == "eth") {
            let rs = await ethTransferNFT(userWallet.eth.privateKey, vaultAddress, tokenId);
            gasUsed = rs.ethGasUsed;
        } else if (network == "bfc") {
            let rs = await bfcTransferNFT(userWallet.eth.privateKey, vaultAddress, tokenId);
            gasUsed = rs.ethGasUsed;
        } else if (network == "bfc") {
            let rs = await aptTransferNFT(userWallet.aptos.privateKey, vaultAddress, tokenId);
            gasUsed = rs.apt_gas_used;
        }

        let transferFee = Math.floor((nftFee - gasUsed - networkGas) * 1000000) / 1000000;
        await logger(`start transfer fee -> ${transferFee}`);
        let gasTx = await transferCoin(userId, network, vaultAddress, transferFee);
        await logger(`success transfer fee -> ${JSON.stringify(gasTx)}`);

        await refreshNFTWallet(userWallet.eth.address, userWallet.aptos.address);
        await refreshNFTWallet(config.sat_vault_address_eth, config.sat_vault_address_apt);

        return true;
    });
}

export async function toWalletNFT(userId, tokenId, network) {
    return await preventReentrancy("to wallet nft", async function (logger, uuid) {
        let nfts = []; // ...

        let onchain = nfts.find(
            v =>
                v.address != null &&
                v.address.toLowerCase() != config["sat_vault_address_apt"].toLowerCase() &&
                v.address.toLowerCase() != config["sat_vault_address_eth"].toLowerCase() &&
                v.address.toLowerCase() != config["sat_vault_address_bfc"].toLowerCase()
        );

        const vaultAddress = config["sat_vault_address_" + network];
        const vaultPK = config["sat_vault_pk_" + network];

        let nft = nfts.find(v => v.userId == userId && v.network == network && v.address == vaultAddress);
        if (nft == null) nft = nfts.find(v => v.userId == userId && v.network == null && v.address == null);

        let walletNetwork = network == "bfc" ? "eth" : network == "apt" ? "aptos" : network;
        let userWallet = await getPrivateKey(userId);
        let wallet = userWallet[walletNetwork];
        let curToken = ""; //...

        if (nft) {
            if (nft.address == null) {
                const nftFee = ToWalletNFTFee.noneMinted[network];
                if (curToken[network] >= nftFee) {
                    await updateSpending(userId, network, network, nftFee * -1, uuid, "towallet mint:" + tokenId + ":network:" + network, logger);

                    let gasUsed = 0;
                    if (network == "eth") {
                        let rs = await ethMintNFT(wallet.address, tokenId);
                        gasUsed = rs.ethGasUsed;
                    } else if (network == "bfc") {
                        let rs = await bfcMintNFT(wallet.address, tokenId);
                        gasUsed = rs.ethGasUsed;
                    } else if (network == "apt") {
                        throw "apt nft already minted";
                    }
                } else {
                    throw `not enoguh coin [${nft.address == null}] toWalletNFT( ${userId}, ${tokenId}, ${network} ) => ${curToken[network]} >= ${nftFee}`;
                }
            } else {
                const nftFee = ToWalletNFTFee.minted[network];
                if (curToken[network] >= nftFee) {
                    await updateSpending(userId, network, network, nftFee * -1, uuid, "towallet mint:" + tokenId + ":network:" + network, logger);

                    let gasUsed = 0;
                    if (network == "eth") {
                        let rs = await ethTransferNFT(vaultPK, wallet.address, tokenId);
                        gasUsed = rs.ethGasUsed;
                    } else if (network == "bfc") {
                        let rs = await bfcTransferNFT(vaultPK, wallet.address, tokenId);
                        gasUsed = rs.ethGasUsed;
                    } else if (network == "bfc") {
                        let rs = await aptTransferNFT(vaultPK, wallet.address, tokenId);
                        gasUsed = rs.apt_gas_used;
                    }
                } else {
                    throw `not enoguh coin [${nft.address == null}] toWalletNFT( ${userId}, ${tokenId}, ${network} ) => ${curToken[network]} >= ${nftFee}`;
                }
            }

            await refreshNFTWallet(userWallet.eth.address, userWallet.aptos.address);
            await refreshNFTWallet(config.sat_vault_address_eth, config.sat_vault_address_apt);

            return true;
        } else {
            throw `something wrong / nft : ${JSON.stringify(nft)}`;
        }
    });
}