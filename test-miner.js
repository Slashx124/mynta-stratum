'use strict';

const net = require('net');
const crypto = require('crypto');

const STRATUM_HOST = '127.0.0.1';
const STRATUM_PORT = 3333;
const WORKER_NAME = 'mtGdRQrs9vFb965QCZnF7SDCX4Cms5TUhD.testworker';

let kawpow;
try {
    kawpow = require('@mintpond/hasher-kawpow');
} catch (e) {
    console.error('Failed to load KawPoW hasher:', e.message);
    process.exit(1);
}

let msgId = 1;
let extraNonce1 = null;
let currentJob = null;
let subscriptionId = null;
let targetBuf = null;
let mining = false;
let sharesSubmitted = 0;
let blocksFound = 0;

const socket = new net.Socket();
let buffer = '';

function send(obj) {
    const msg = JSON.stringify(obj) + '\n';
    socket.write(msg);
}

function handleMessage(msg) {
    if (msg.id === 1) {
        // Subscribe response
        if (msg.result) {
            subscriptionId = msg.result[0];
            extraNonce1 = msg.result[1];
            console.log(`Subscribed: subscriptionId=${subscriptionId}, extraNonce1=${extraNonce1}`);
            // Authorize
            send({ id: ++msgId, method: 'mining.authorize', params: [WORKER_NAME, 'x'] });
        } else {
            console.error('Subscribe failed:', msg.error);
        }
    } else if (msg.id === 2) {
        // Authorize response
        if (msg.result === true) {
            console.log('Authorized successfully');
        } else {
            console.error('Authorization failed:', msg.error);
        }
    } else if (msg.id && msg.id > 2) {
        // Share submit response
        if (msg.result === true) {
            sharesSubmitted++;
            console.log(`Share #${sharesSubmitted} ACCEPTED`);
        } else {
            console.error(`Share REJECTED:`, msg.error);
        }
    } else if (msg.method === 'mining.notify') {
        const params = msg.params;
        currentJob = {
            jobId: params[0],
            headerHash: params[1],
            seedHash: params[2],
            target: params[3],
            cleanJobs: params[4],
            height: params[5],
            nbits: params[6]
        };
        targetBuf = Buffer.from(currentJob.target, 'hex');
        console.log(`New job: id=${currentJob.jobId} height=${currentJob.height} target=${currentJob.target.substring(0, 16)}...`);

        if (!mining) {
            mining = true;
            setTimeout(startMining, 100);
        }
    } else if (msg.method === 'mining.set_difficulty') {
        console.log(`Difficulty set to: ${msg.params[0]}`);
    }
}

function startMining() {
    if (!currentJob || !extraNonce1) {
        setTimeout(startMining, 500);
        return;
    }

    console.log(`\nStarting CPU mining at height ${currentJob.height}...`);
    const job = currentJob;
    const headerHashBuf = Buffer.from(job.headerHash, 'hex');
    const mixOutBuf = Buffer.alloc(32);
    const hashOutBuf = Buffer.alloc(32);

    // Build nonce: random 4 bytes + extraNonce1 (4 bytes) in LE
    const extraNonce1Buf = Buffer.from(extraNonce1, 'hex');
    // Reverse extraNonce1 for LE
    const extraNonce1LE = Buffer.alloc(extraNonce1Buf.length);
    for (let i = 0; i < extraNonce1Buf.length; i++) {
        extraNonce1LE[i] = extraNonce1Buf[extraNonce1Buf.length - 1 - i];
    }

    // Target as BigInt for comparison (target is in BE hex from stratum)
    const targetBi = BigInt('0x' + job.target);

    let nonceCounter = crypto.randomInt(0, 0x7FFFFFFF);
    const startTime = Date.now();
    let hashCount = 0;
    const BATCH_SIZE = 10;

    function mineChunk() {
        if (currentJob !== job) {
            console.log('Job changed, switching...');
            setTimeout(startMining, 10);
            return;
        }

        for (let i = 0; i < BATCH_SIZE; i++) {
            nonceCounter = (nonceCounter + 1) >>> 0;

            // Build 8-byte nonce: 4 bytes miner nonce (LE) + 4 bytes extraNonce1 (LE)
            const nonceBuf = Buffer.alloc(8);
            nonceBuf.writeUInt32LE(nonceCounter, 0);
            extraNonce1LE.copy(nonceBuf, 4);

            hashCount++;

            let isValid;
            try {
                kawpow.hashOne(headerHashBuf, nonceBuf, job.height, mixOutBuf, hashOutBuf);
            } catch (e) {
                continue;
            }

            // hashOut is BE from native hasher
            const hashHex = hashOutBuf.toString('hex');
            const hashBi = BigInt('0x' + hashHex);

            if (hashBi <= targetBi) {
                blocksFound++;
                const elapsed = (Date.now() - startTime) / 1000;
                console.log(`\n*** BLOCK FOUND #${blocksFound}! ***`);
                console.log(`  Hash: ${hashHex.substring(0, 32)}...`);
                console.log(`  Nonce: 0x${nonceBuf.toString('hex')}`);
                console.log(`  Hashes: ${hashCount} in ${elapsed.toFixed(1)}s`);

                // Submit: [worker, jobId, nonce, headerHash, mixHash]
                // Stratum's _toBufferLE reverses the hex, so send nonce as BE
                const nonceReversed = Buffer.from(nonceBuf).reverse();
                const nonceHex = '0x' + nonceReversed.toString('hex');
                const headerHashHex = '0x' + headerHashBuf.toString('hex');
                const mixHashHex = '0x' + mixOutBuf.toString('hex');

                send({
                    id: ++msgId,
                    method: 'mining.submit',
                    params: [WORKER_NAME, job.jobId, nonceHex, headerHashHex, mixHashHex]
                });

                // Wait for new job after submission
                setTimeout(() => {
                    if (blocksFound >= 5) {
                        console.log(`\nMined ${blocksFound} blocks, test complete!`);
                        setTimeout(() => process.exit(0), 2000);
                    } else {
                        startMining();
                    }
                }, 3000);
                return;
            }
        }

        // Report hashrate periodically
        if (hashCount % 100 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const hashrate = hashCount / elapsed;
            process.stdout.write(`\rHashing... ${hashCount} hashes, ${hashrate.toFixed(1)} H/s`);
        }

        setImmediate(mineChunk);
    }

    mineChunk();
}

socket.on('data', (data) => {
    buffer += data.toString();
    let lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
        if (line.trim()) {
            try {
                handleMessage(JSON.parse(line));
            } catch (e) {
                console.error('Parse error:', line.substring(0, 100));
            }
        }
    }
});

socket.on('error', (err) => {
    console.error('Socket error:', err.message);
    process.exit(1);
});

socket.on('close', () => {
    console.log('Disconnected from stratum');
    process.exit(0);
});

socket.connect(STRATUM_PORT, STRATUM_HOST, () => {
    console.log('Connected to stratum server');
    send({ id: msgId, method: 'mining.subscribe', params: ['test-miner/1.0'] });
});
