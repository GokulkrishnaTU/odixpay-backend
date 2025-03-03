const express = require('express');
const Web3 = require('web3');
const { ethers } = require('ethers');
const axios = require('axios');
const bip39 = require('bip39');
const { hdkey } = require('ethereumjs-wallet');
const cors = require('cors'); // Import the cors middleware

const app = express();

// Use CORS middleware
app.use(cors());

app.use(express.json());

// Web3 provider setup
const web3 = new Web3('https://mainnet.infura.io/v3/8c4fb08423064f668b7ba9bc188cdf9f');

// Alchemy API key for transaction history
const alchemyApiKey = 'UgRZ8QLunamZGox9VmCGXlr-2QU6yDC-';

// Create a new Ethereum wallet
app.post('/create_wallet', (req, res) => {

    const mnemonic = bip39.generateMnemonic();
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const hdWallet = hdkey.fromMasterSeed(seed);
    const wallet = hdWallet.derivePath("m/44'/60'/0'/0/0").getWallet();
    const address = wallet.getAddressString();
    const privateKey = wallet.getPrivateKeyString();

    res.json({
        words: mnemonic,
        address: address,
        private_key: privateKey
    });
});

// Get wallet details from mnemonic words
app.post('/wallet_detail', (req, res) => {
    const { words } = req.body;
    const seed = bip39.mnemonicToSeedSync(words);
    const hdWallet = hdkey.fromMasterSeed(seed);
    const wallet = hdWallet.derivePath("m/44'/60'/0'/0/0").getWallet();
    const address = wallet.getAddressString();
    const privateKey = wallet.getPrivateKeyString();

    res.json({
        address: address,
        private_key: privateKey
    });
});

// Get token address by name
app.get('/get_token_address/:tokenName', async (req, res) => {
    const { tokenName } = req.params;
    const url = `https://api.coingecko.com/api/v3/coins/${tokenName.toLowerCase()}`;
    try {
        const response = await axios.get(url);
        const data = response.data;
        if (data.platforms && data.platforms.ethereum) {
            const tokenAddress = web3.utils.toChecksumAddress(data.platforms.ethereum);
            res.json({ token_address: tokenAddress });
        } else {
            res.status(404).json({ error: `Token '${tokenName}' not found or not supported on Ethereum.` });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get balance of an address
app.get('/get_balance/:address', async (req, res) => {
    const { address } = req.params;
    const { tokenName } = req.query;

    try {
        const ethBalance = await web3.eth.getBalance(address);
        const ethBalanceInEther = web3.utils.fromWei(ethBalance, 'ether');

        let tokenBalance = null;
        if (tokenName) {
            let tokenAddress;
            if (tokenName.startsWith("0x")) {
                tokenAddress = tokenName;
            } else {
                const tokenResponse = await axios.get(`https://api.coingecko.com/api/v3/coins/${tokenName.toLowerCase()}`);
                tokenAddress = web3.utils.toChecksumAddress(tokenResponse.data.platforms.ethereum);
            }

            const ERC20_ABI = [
                {
                    "constant": true,
                    "inputs": [{"name": "_owner", "type": "address"}],
                    "name": "balanceOf",
                    "outputs": [{"name": "balance", "type": "uint256"}],
                    "type": "function"
                },
                {
                    "constant": true,
                    "inputs": [],
                    "name": "decimals",
                    "outputs": [{"name": "", "type": "uint8"}],
                    "type": "function"
                }
            ];

            const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
            const balance = await contract.methods.balanceOf(address).call();
            const decimals = await contract.methods.decimals().call();
            tokenBalance = balance / (10 ** decimals);
        }

        res.json({
            ETH: parseFloat(ethBalanceInEther),
            ERC20: tokenBalance
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



app.post('/transfer', async (req, res) => {
    const { privateKey, recipientAddress, amount, tokenAddress } = req.body;
    console.log('privateKey: ', privateKey);
    console.log('req.body: ', req.body);

    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        console.log('account: ', account);
        const nonce = await web3.eth.getTransactionCount(account.address);

        let tx;
        if (tokenAddress) {
            const tokenABI = [
                // Include the full ABI here (as provided in your Python code)
                // Ensure the `decimals` function is correct
                {
                    "constant": true,
                    "inputs": [],
                    "name": "decimals",
                    "outputs": [{"name": "", "type": "uint8"}], // Change to uint8 if needed
                    "payable": false,
                    "stateMutability": "view",
                    "type": "function"
                },
                {
                    "constant": false,
                    "inputs": [
                        {"name": "_to", "type": "address"},
                        {"name": "_value", "type": "uint256"}
                    ],
                    "name": "transfer",
                    "outputs": [{"name": "", "type": "bool"}],
                    "payable": false,
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
                // Add other necessary functions from the ABI
            ];

            const contract = new web3.eth.Contract(tokenABI, tokenAddress);
            const decimals = await contract.methods.decimals().call();
            const amountInUnits = amount * (10 ** decimals);

            console.log('Decimals:', decimals);
            console.log('Amount in units:', amountInUnits);

            tx = {
                from: account.address,
                to: tokenAddress,
                gas: 200000, // Increased gas limit
                gasPrice: web3.utils.toWei('30', 'gwei'),
                nonce: nonce,
                data: contract.methods.transfer(recipientAddress, amountInUnits).encodeABI()
            };

            console.log('Transaction:', tx);
        } else {
            tx = {
                from: account.address,
                to: recipientAddress,
                value: web3.utils.toWei(amount.toString(), 'ether'),
                gas: 50000,
                gasPrice: web3.utils.toWei('30', 'gwei'),
                nonce: nonce
            };
        }

        const signedTx = await account.signTransaction(tx);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        res.json({ transaction_hash: receipt.transactionHash });
    } catch (error) {
        console.log('error: ', error);
        res.status(500).json({ error: error.message });
    }
});

// Get transaction details
app.get('/transaction_details/:txid', async (req, res) => {
    const { txid } = req.params;

    try {
        const tx = await web3.eth.getTransaction(txid);
        const txReceipt = await web3.eth.getTransactionReceipt(txid);

        const result = {
            tx_hash: txid,
            status: txReceipt.status ? "Success" : "Failed",
            gas_used: txReceipt.gasUsed,
            transfers: []
        };

        if (tx.value > 0) {
            result.transfers.push({
                type: "ETH",
                from: tx.from,
                to: tx.to,
                amount: web3.utils.fromWei(tx.value, 'ether'),
                gas_price: web3.utils.fromWei(tx.gasPrice, 'gwei'),
                gas_used: txReceipt.gasUsed,
                status: txReceipt.status ? "Success" : "Failed"
            });
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get transaction history of an address

app.get('/transaction_history', async (req, res) => {
    const { address } = req.query; // Extract address from query params
    console.log('address: ', address);

    try {
        const url = `https://eth-mainnet.alchemyapi.io/v2/${alchemyApiKey}`;
        const headers = { "Content-Type": "application/json" };

        const incomingData = {
            jsonrpc: "2.0",
            method: "alchemy_getAssetTransfers",
            params: [{
                fromBlock: "0x0",
                toBlock: "latest",
                toAddress: address,
                category: ["external", "erc20", "erc721"],
                withMetadata: true,
                excludeZeroValue: true
            }],
            id: 1
        };

        const outgoingData = {
            jsonrpc: "2.0",
            method: "alchemy_getAssetTransfers",
            params: [{
                fromBlock: "0x0",
                toBlock: "latest",
                fromAddress: address,
                category: ["external", "erc20", "erc721"],
                withMetadata: true,
                excludeZeroValue: true
            }],
            id: 2
        };

        const incomingResponse = await axios.post(url, incomingData, { headers });
        const outgoingResponse = await axios.post(url, outgoingData, { headers });

        const transactions = [];

        incomingResponse.data.result.transfers.forEach(tx => {
            transactions.push({
                tx_hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                asset: tx.asset || "ETH",
                category: tx.category,
                timestamp: tx.metadata.blockTimestamp,
                direction: "incoming"
            });
        });

        outgoingResponse.data.result.transfers.forEach(tx => {
            transactions.push({
                tx_hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                asset: tx.asset || "ETH",
                category: tx.category,
                timestamp: tx.metadata.blockTimestamp,
                direction: "outgoing"
            });
        });

        transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});