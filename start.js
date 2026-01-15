'use strict';

const fs = require('fs');
const path = require('path');
const Stratum = require('./libs/class.Stratum');

// Load configuration from config.json
let configPath = path.join(process.cwd(), 'config.json');

// If config doesn't exist in cwd, check next to executable
if (!fs.existsSync(configPath)) {
    configPath = path.join(path.dirname(process.execPath), 'config.json');
}

// If still not found, check script directory
if (!fs.existsSync(configPath)) {
    configPath = path.join(__dirname, 'config.json');
}

if (!fs.existsSync(configPath)) {
    console.error('ERROR: config.json not found!');
    console.error('Please create a config.json file with the following structure:');
    console.error(JSON.stringify({
        coinbaseAddress: "YOUR_MYNTA_ADDRESS",
        blockBrand: "Mynta Solo Miner",
        host: "0.0.0.0",
        port: { number: 3333, diff: 1 },
        rpc: {
            host: "127.0.0.1",
            port: 8766,
            user: "myntarpc",
            password: "YOUR_RPC_PASSWORD"
        },
        jobUpdateInterval: 55,
        blockPollIntervalMs: 250
    }, null, 2));
    process.exit(1);
}

let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('Loaded configuration from:', configPath);
} catch (e) {
    console.error('ERROR: Failed to parse config.json:', e.message);
    process.exit(1);
}

// Validate required fields
if (!config.coinbaseAddress) {
    console.error('ERROR: coinbaseAddress is required in config.json');
    process.exit(1);
}
if (!config.rpc || !config.rpc.host || !config.rpc.port) {
    console.error('ERROR: rpc configuration is required in config.json');
    process.exit(1);
}

const stratum = new Stratum({
    coinbaseAddress: config.coinbaseAddress,
    blockBrand: config.blockBrand || 'Mynta Solo Miner',
    host: config.host || "0.0.0.0",
    port: config.port || { number: 3333, diff: 1 },
    rpc: config.rpc,
    jobUpdateInterval: config.jobUpdateInterval || 55,
    blockPollIntervalMs: config.blockPollIntervalMs || 250
});

stratum.init();

console.log(`Mynta Stratum Proxy v1.0.0`);
console.log(`Mining address: ${config.coinbaseAddress}`);
console.log(`RPC endpoint: ${config.rpc.host}:${config.rpc.port}`);

stratum.on(Stratum.EVENT_CLIENT_CONNECT, ev => {
    console.log(`Client connected: ${ev.client.socket.remoteAddress}`);
});

stratum.on(Stratum.EVENT_CLIENT_DISCONNECT, ev => {
    console.log(`Client disconnected: ${ev.client.socket.remoteAddress} ${ev.reason}`);
});

stratum.on(Stratum.EVENT_SHARE_SUBMITTED, ev => {
    if (ev.share.isValidBlock) {
        console.log(`Valid block submitted by ${ev.share.client.workerName}`)
    }
    else if (ev.share.isValidShare) {
        console.log(`Valid share submitted by ${ev.share.client.workerName}`)
    }
    else {
        console.log(`Invalid share submitted by ${ev.share.client.workerName} ${ev.share.error.message}`)
    }
});

// Make sure Error can be JSON serialized
if (!Error.prototype.toJSON) {
    Error.prototype.toJSON = function () {
        const jsonObj = {};

        Object.getOwnPropertyNames(this).forEach(key => {
            jsonObj[key] = this[key];
        }, this);

        return jsonObj;
    }
}

// Keep process running
process.on('SIGINT', () => {
    console.log('Shutting down stratum proxy...');
    process.exit(0);
});
