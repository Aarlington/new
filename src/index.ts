import 'regenerator-runtime/runtime' // cf. https://flaviocopes.com/parcel-regeneratorruntime-not-defined/
import * as spl from "@solana/spl-token";
import * as s from "@solana/web3.js";
import Wallet from "@project-serum/sol-wallet-adapter"
import BN from "bn.js";
import * as elayout from "./layout";
import dotenv from "dotenv";


dotenv.config()

const systemProgramID = new s.PublicKey(process.env.SYSTEM_PROGRAM_ID!); // somehow this isn't part of @solana/web3.js?!
const escrowProgramId = new s.PublicKey(process.env.ESCROW_PROGRAM_ID!)
const salesTaxPubkey = new s.PublicKey(process.env.SALES_TAX_PUBKEY!)
// TODO: provide util function to get the assoc. token account from the mint+wallet
const makerTokenAccountPubkey = new s.PublicKey(process.env.MAKER_TOKEN_ACCOUNT_PUBKEY!)
// IMPORTANT: the token amount gets shifted by the number of decimal defined for the mint.
// So with 2 decimals in the mint, the amount will be 0.01. Thus, the UI code needs to
// work with the mint decimals to get the amount right.
//
// This assumes 2 decimals since that's what Sollet test tokens are shipped with.
// But the JS code needs to figure out the decimals for the mint!!
//
// The contract code will only accept an amount of 1.0
const tokenDepositAmount = 1000000000
const price = 100000000 // in lamports, here 0.1 SOL
// ---------------------


declare const window: any

const rpcUrl = s.clusterApiUrl('devnet')
const providerUrl = 'https://www.sollet.io'
window.wallet = new Wallet(providerUrl, rpcUrl)
window.solanaRPC = new s.Connection(rpcUrl, 'singleGossip');

// TODO need better error handling

window.connectToWallet = async function() {
    // Wallet adapter
    console.log(window.wallet)
    var pubkey = ''
    window.wallet.on('connect', (p: s.PublicKey) => {
        pubkey = p.toBase58()
        console.log('Connected to ' + pubkey)
        console.log(window.wallet)
        document.getElementById('wallet-pubkey')!.innerHTML = pubkey
    });
    window.wallet.on('disconnect', () => {
        console.log('Disconnected')
        document.getElementById('wallet-pubkey')!.innerHTML = 'not connected'
    });
    await window.wallet.connect();
}

async function finalizeTxn(instructions: Array<s.TransactionInstruction>, additionalSigners?: Array<s.Account>) {
    console.log("finalizing txn")
    const rpc = window.solanaRPC
    const wallet = window.wallet

    const tx = new s.Transaction();

    let { blockhash } = await rpc.getRecentBlockhash();
    console.log("recent blockhash", blockhash)
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey

    tx.add(...instructions);
    if (additionalSigners != undefined) {
        tx.sign(...additionalSigners)
    }

    let signedTx = await wallet.signTransaction(tx);
    console.log("tx signed", signedTx)
    const txId = await rpc.sendRawTransaction(signedTx.serialize(), { skipPreflight: false, preflightCommitment: 'singleGossip' });
    console.log("tx sent", txId)
    await rpc.confirmTransaction(txId);
    console.log("tx confirmed", txId)
}

window.sendMakerTxn = async function() {
    const rpc = window.solanaRPC
    const clientPubkey = window.wallet.publicKey

    const sourceMint = await getMintFromAccount(rpc, makerTokenAccountPubkey)
    console.log('SOURCEMINT', sourceMint.toString())

    const depositAccount = new s.Account()
    const createDepositAccountIx = s.SystemProgram.createAccount({
        programId: spl.TOKEN_PROGRAM_ID,
        space: spl.AccountLayout.span,
        lamports: await getExemptionRent(rpc, spl.AccountLayout.span),
        fromPubkey: clientPubkey,
        newAccountPubkey: depositAccount.publicKey
    });
    const initDepositAccountIx = spl.Token.createInitAccountInstruction(
            spl.TOKEN_PROGRAM_ID,
            sourceMint, // mint
            depositAccount.publicKey, // token account pubkey
            clientPubkey // designated token account owner
    );
    const transferSourceTokensToDepositAccIx = spl.Token.createTransferInstruction(
            spl.TOKEN_PROGRAM_ID,
            makerTokenAccountPubkey, // src pubkey
            depositAccount.publicKey, //dest pubkey
            clientPubkey, // owner pubkey
            [],
            tokenDepositAmount);

    const escrowAccount = new s.Account();
    console.log("ESCROW ACCOUNT: ", escrowAccount.publicKey.toBase58())
    window.escrowAccount = escrowAccount // XXX TODO only for testing!! the privkey mustn't be printed on the console.
    document.getElementById('escrow-account')!.innerHTML = escrowAccount.publicKey.toBase58()
    const createEscrowAccountIx = s.SystemProgram.createAccount({
        space: elayout.ESCROW_ACCOUNT_DATA_LAYOUT.span,
        lamports: await getExemptionRent(rpc, elayout.ESCROW_ACCOUNT_DATA_LAYOUT.span),
        fromPubkey: clientPubkey,
        newAccountPubkey: escrowAccount.publicKey,
        programId: escrowProgramId
    });

    const initEscrowIx = new s.TransactionInstruction({
        programId: escrowProgramId,
        keys: [
            { pubkey: clientPubkey, isSigner: true, isWritable: false },

            { pubkey: depositAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: sourceMint, isSigner: false, isWritable: false },

            { pubkey: escrowAccount.publicKey, isSigner: false, isWritable: true },

            { pubkey: s.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
        ],
        data: Buffer.from(Uint8Array.of(0, ...new BN(price).toArray("le", 8)))
    })

    const ixs = [
            createDepositAccountIx,
            initDepositAccountIx,
            transferSourceTokensToDepositAccIx,
            createEscrowAccountIx,
            initEscrowIx
    ]
    const addSigners = [
        depositAccount,
        escrowAccount
    ]

    await finalizeTxn(ixs, addSigners)

    const encodedEscrowState = (await rpc.getAccountInfo(escrowAccount.publicKey, 'singleGossip'))!.data;
    const decodedEscrowState = elayout.ESCROW_ACCOUNT_DATA_LAYOUT.decode(encodedEscrowState) as elayout.EscrowLayout;
    console.log(decodedEscrowState)
    console.log(new BN(decodedEscrowState.expectedAmount, 10, "le").toNumber())

}

window.sendTakerTxn = async function() {
    const rpc = window.solanaRPC
    const clientPubkey = window.wallet.publicKey

    try {
        var encodedEscrowState = (await rpc.getAccountInfo(window.escrowAccount.publicKey, 'singleGossip'))!.data;
    } catch (err) {
        throw new Error("Could not find escrow at given address!")
    }
    const decodedEscrowLayout = elayout.ESCROW_ACCOUNT_DATA_LAYOUT.decode(encodedEscrowState) as elayout.EscrowLayout;
    const escrowState = {
        escrowAccountPubkey: window.escrowAccount.publicKey,
        isInitialized: !!decodedEscrowLayout.isInitialized,
        initializerAccountPubkey: new s.PublicKey(decodedEscrowLayout.initializerPubkey),
        XTokenTempAccountPubkey: new s.PublicKey(decodedEscrowLayout.initializerTempTokenAccountPubkey),
        expectedAmount: new BN(decodedEscrowLayout.expectedAmount, 10, "le")
    };

    console.log("DEL:", decodedEscrowLayout)

    const PDA = await s.PublicKey.findProgramAddress([Buffer.from("escrow")], escrowProgramId);

    // later, it's better to query RPC for existence and then optionally include creation
    // of the assoc token account in the transaction. Otherwise the user might end up
    // with a lot of empty token accounts clutter if the txn fails.
    const mint = await getMintFromAccount(rpc, escrowState.XTokenTempAccountPubkey)
    const splToken = new spl.Token(rpc, mint, spl.TOKEN_PROGRAM_ID, clientPubkey)
    const tokenReceiveAccount = (await getOrCreateAssociatedAccountInfo(rpc, splToken, clientPubkey))!.address

    const takeIx = new s.TransactionInstruction({
        programId: escrowProgramId,
        data: Buffer.from(Uint8Array.of(1, ...new BN(tokenDepositAmount).toArray("le", 8))),
        keys: [
            { pubkey: clientPubkey, isSigner: true, isWritable: false },

            { pubkey: tokenReceiveAccount, isSigner: false, isWritable: true },

            { pubkey: escrowState.XTokenTempAccountPubkey, isSigner: false, isWritable: true},
            { pubkey: escrowState.initializerAccountPubkey, isSigner: false, isWritable: true},
            { pubkey: window.escrowAccount.publicKey, isSigner: false, isWritable: true },

            { pubkey: salesTaxPubkey, isSigner: false, isWritable: true},
            { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
            { pubkey: systemProgramID, isSigner: false, isWritable: false},

            { pubkey: PDA[0], isSigner: false, isWritable: false}
        ]
    })

    await finalizeTxn([takeIx])
}

async function getMintFromAccount(rpc: s.Connection, accPubkey: s.PublicKey) {
        const ai = await rpc.getParsedAccountInfo(accPubkey, 'singleGossip')
        const bl = <s.ParsedAccountData>ai.value!.data
        const mint: string | null = bl.parsed.info.mint
        if (mint === null) {
            throw new Error('Not a token mint account: ' + accPubkey)
        }
        return new s.PublicKey(mint)
}

async function getExemptionRent(rpc: s.Connection, size: number) {
        const r = await rpc.getMinimumBalanceForRentExemption(size, 'singleGossip')
        return r
}

// Ripped from spl-token.js, as we need to send this through the wallet adapter
async function getOrCreateAssociatedAccountInfo(rpc: s.Connection, t: spl.Token, clientPubkey: s.PublicKey) {
    // FIXME need to augment the ambient typedef instead of hard-coding this.
    // https://www.typescriptlang.org/docs/handbook/declaration-merging.html
    const FAILED_TO_FIND_ACCOUNT = 'Failed to find account';
    const INVALID_ACCOUNT_OWNER = 'Invalid account owner';

    const mint = t.publicKey

    // This is the optimum logic, considering TX fee, client-side computation,
    // RPC roundtrips and guaranteed idempotent.
    // Sadly we can't do this atomically;
    const associatedAddress = await spl.Token.getAssociatedTokenAddress(spl.ASSOCIATED_TOKEN_PROGRAM_ID, spl.TOKEN_PROGRAM_ID, mint, clientPubkey);
    try {
        return await t.getAccountInfo(associatedAddress);
    } catch (err) {
        // INVALID_ACCOUNT_OWNER can be possible if the associatedAddress has
        // already been received some lamports (= became system accounts).
        // Assuming program derived addressing is safe, this is the only case
        // for the INVALID_ACCOUNT_OWNER in this code-path
        if (err.message === FAILED_TO_FIND_ACCOUNT || err.message === INVALID_ACCOUNT_OWNER) {
            // as this isn't atomic, it's possible others can create associated
            // accounts meanwhile
            try {
                const owner = clientPubkey
                const payer = clientPubkey
                const createIx = spl.Token.createAssociatedTokenAccountInstruction(
                    spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                    spl.TOKEN_PROGRAM_ID,
                    mint,
                    associatedAddress,
                    owner,
                    payer)
                console.log(await finalizeTxn(new Array(createIx)))
            } catch (err) {// ignore all errors; for now there is no API compatible way to
                // selectively ignore the expected instruction error if the
                // associated account is existing already.
                console.log("Warning: ", err)
            } // Now this should always succeed
            return await t.getAccountInfo(associatedAddress);
        } else {
            throw err;
        }
    }
}
