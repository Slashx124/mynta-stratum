'use strict';

/**
 * Test utilities for mynta-stratum
 * Provides mock objects, helpers, and cross-platform testing utilities
 */

const net = require('net');
const http = require('http');
const EventEmitter = require('events');
const path = require('path');
const os = require('os');

// Platform detection
const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const IS_MACOS = process.platform === 'darwin';

/**
 * Mock logger that captures log output for testing
 */
class MockLogger {
    constructor() {
        this.logs = {
            debug: [],
            info: [],
            warn: [],
            error: []
        };
    }

    debug(...args) { this.logs.debug.push(args); }
    info(...args) { this.logs.info.push(args); }
    warn(...args) { this.logs.warn.push(args); }
    error(...args) { this.logs.error.push(args); }

    clear() {
        this.logs = { debug: [], info: [], warn: [], error: [] };
    }

    hasLog(level, substring) {
        return this.logs[level].some(args => 
            args.some(arg => String(arg).includes(substring))
        );
    }

    getAll() {
        return [
            ...this.logs.debug,
            ...this.logs.info,
            ...this.logs.warn,
            ...this.logs.error
        ];
    }
}

/**
 * Mock RPC server for testing without a real daemon
 */
class MockRpcServer {
    constructor(options = {}) {
        this.port = options.port || 0;
        this.user = options.user || 'testuser';
        this.password = options.password || 'testpass';
        this.server = null;
        this.requests = [];
        this.responses = {};
        this.blockHeight = options.blockHeight || 1000;
        this.blockTemplate = this._generateBlockTemplate();
    }

    _generateBlockTemplate() {
        return {
            capabilities: ['proposal'],
            version: 536870912,
            rules: ['csv', 'segwit'],
            vbavailable: {},
            vbrequired: 0,
            previousblockhash: '0000000000000000000000000000000000000000000000000000000000000001',
            transactions: [],
            coinbaseaux: { flags: '' },
            coinbasevalue: 5000000000,
            longpollid: 'test-longpoll-id',
            target: '00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            mintime: Math.floor(Date.now() / 1000) - 60,
            mutable: ['time', 'transactions', 'prevblock'],
            noncerange: '00000000ffffffff',
            sigoplimit: 80000,
            sizelimit: 4000000,
            weightlimit: 4000000,
            curtime: Math.floor(Date.now() / 1000),
            bits: '1d00ffff',
            height: this.blockHeight,
            default_witness_commitment: '6a24aa21a9ede2f61c3f71d1defd3fa999dfa36953755c690689799962b48bebd836974e8cf9'
        };
    }

    setResponse(method, response) {
        this.responses[method] = response;
    }

    start(callback) {
        this.server = http.createServer((req, res) => {
            // Verify auth
            const auth = req.headers.authorization;
            if (auth) {
                const expected = 'Basic ' + Buffer.from(`${this.user}:${this.password}`).toString('base64');
                if (auth !== expected) {
                    res.writeHead(401);
                    res.end();
                    return;
                }
            }

            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const request = JSON.parse(body);
                    this.requests.push(request);

                    let result = null;
                    let error = null;

                    // Check for custom response
                    if (this.responses[request.method] !== undefined) {
                        const customResponse = this.responses[request.method];
                        if (customResponse instanceof Error) {
                            error = { code: -1, message: customResponse.message };
                        } else if (typeof customResponse === 'function') {
                            result = customResponse(request.params);
                        } else {
                            result = customResponse;
                        }
                    } else {
                        // Default responses
                        switch (request.method) {
                            case 'getblockchaininfo':
                                result = {
                                    chain: 'main',
                                    blocks: this.blockHeight,
                                    headers: this.blockHeight,
                                    bestblockhash: '0000000000000000000000000000000000000000000000000000000000000001',
                                    difficulty: 1,
                                    mediantime: Math.floor(Date.now() / 1000),
                                    verificationprogress: 1,
                                    initialblockdownload: false,
                                    chainwork: '0000000000000000000000000000000000000000000000000000000000000001',
                                    size_on_disk: 1000000,
                                    pruned: false
                                };
                                break;

                            case 'getblocktemplate':
                                result = this.blockTemplate;
                                break;

                            case 'validateaddress':
                                const addr = request.params[0];
                                result = {
                                    isvalid: addr && addr.startsWith('M'),
                                    address: addr,
                                    scriptPubKey: '76a914000000000000000000000000000000000000000088ac',
                                    ismine: false,
                                    iswatchonly: false,
                                    isscript: false,
                                    iswitness: false
                                };
                                break;

                            case 'submitblock':
                                // Success returns null
                                result = null;
                                break;

                            case 'getblock':
                                result = {
                                    hash: request.params[0],
                                    confirmations: 1,
                                    height: this.blockHeight,
                                    version: 536870912,
                                    versionHex: '20000000',
                                    merkleroot: '0000000000000000000000000000000000000000000000000000000000000001',
                                    time: Math.floor(Date.now() / 1000),
                                    txid: '0000000000000000000000000000000000000000000000000000000000000001'
                                };
                                break;

                            default:
                                error = { code: -32601, message: 'Method not found' };
                        }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        result: result,
                        error: error,
                        id: request.id
                    }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: { code: -1, message: err.message } }));
                }
            });
        });

        this.server.listen(this.port, '127.0.0.1', () => {
            this.port = this.server.address().port;
            callback && callback(null, this.port);
        });
    }

    stop(callback) {
        if (this.server) {
            this.server.close(callback);
            this.server = null;
        } else {
            callback && callback();
        }
    }

    clearRequests() {
        this.requests = [];
    }
}

/**
 * Mock stratum miner client for testing the stratum server
 */
class MockMinerClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.host = options.host || '127.0.0.1';
        this.port = options.port || 3333;
        this.workerName = options.workerName || 'MTestAddress.worker1';
        this.password = options.password || 'x';
        this.socket = null;
        this.buffer = '';
        this.subscriptionId = null;
        this.extraNonce1 = null;
        this.extraNonce2Size = 4;
        this.difficulty = 1;
        this.jobs = [];
        this.messageId = 1;
        this.isConnected = false;
        this.isSubscribed = false;
        this.isAuthorized = false;
    }

    connect(callback) {
        this.socket = net.createConnection({
            host: this.host,
            port: this.port
        }, () => {
            this.isConnected = true;
            this.emit('connected');
            callback && callback(null);
        });

        this.socket.on('data', data => {
            this.buffer += data.toString();
            this._processBuffer();
        });

        this.socket.on('error', err => {
            this.emit('error', err);
            callback && callback(err);
        });

        this.socket.on('close', () => {
            this.isConnected = false;
            this.emit('close');
        });
    }

    _processBuffer() {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    this._handleMessage(message);
                } catch (err) {
                    this.emit('error', new Error(`Invalid JSON: ${line}`));
                }
            }
        }
    }

    _handleMessage(message) {
        this.emit('message', message);

        if (message.method) {
            // Server notification
            switch (message.method) {
                case 'mining.set_difficulty':
                    this.difficulty = message.params[0];
                    this.emit('difficulty', this.difficulty);
                    break;
                case 'mining.notify':
                    const job = {
                        jobId: message.params[0],
                        headerHash: message.params[1],
                        seedHash: message.params[2],
                        target: message.params[3],
                        cleanJobs: message.params[4]
                    };
                    this.jobs.push(job);
                    this.emit('job', job);
                    break;
            }
        } else if (message.id !== undefined) {
            // Response to our request
            this.emit(`response:${message.id}`, message);
        }
    }

    send(method, params, callback) {
        const id = this.messageId++;
        const message = JSON.stringify({ id, method, params }) + '\n';

        if (callback) {
            this.once(`response:${id}`, response => {
                if (response.error) {
                    callback(new Error(response.error[1] || response.error.message || 'Unknown error'), null);
                } else {
                    callback(null, response.result);
                }
            });
        }

        this.socket.write(message);
        return id;
    }

    subscribe(callback) {
        this.send('mining.subscribe', ['TestMiner/1.0.0'], (err, result) => {
            if (err) {
                callback && callback(err);
                return;
            }

            // Handle different response formats
            // Format 1: [[["mining.set_difficulty", "id"], ["mining.notify", "id"]], extraNonce1, extraNonce2Size]
            // Format 2: [subscriptionId, extraNonce1] (simplified KawPoW format)
            if (Array.isArray(result)) {
                if (result.length >= 3 && Array.isArray(result[0])) {
                    // Full format
                    this.subscriptionId = result[0][0] ? result[0][0][1] : result[0];
                    this.extraNonce1 = result[1];
                    this.extraNonce2Size = result[2] || 4;
                } else if (result.length >= 2) {
                    // Simplified format
                    this.subscriptionId = result[0];
                    this.extraNonce1 = result[1];
                    this.extraNonce2Size = 4;
                }
                
                this.isSubscribed = true;
                this.emit('subscribed', { subscriptionId: this.subscriptionId, extraNonce1: this.extraNonce1 });
            }

            callback && callback(null, result);
        });
    }

    authorize(callback) {
        this.send('mining.authorize', [this.workerName, this.password], (err, result) => {
            if (err) {
                callback && callback(err);
                return;
            }

            this.isAuthorized = result === true;
            if (this.isAuthorized) {
                this.emit('authorized', this.workerName);
            }

            callback && callback(null, result);
        });
    }

    submitShare(jobId, nonce, headerHash, mixHash, callback) {
        this.send('mining.submit', [
            this.workerName,
            jobId,
            nonce,
            headerHash,
            mixHash
        ], callback);
    }

    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.isConnected = false;
        this.isSubscribed = false;
        this.isAuthorized = false;
    }
}

/**
 * Test configuration generator
 * Note: The coinbaseAddress must be a valid base58 address starting with 'M'
 * Using a test address format that matches Mynta's address encoding
 */
function createTestConfig(overrides = {}) {
    return {
        // This is a valid-looking base58 address starting with M
        // Real Mynta addresses are base58check encoded
        coinbaseAddress: 'MBxGKnCTDJaLjQhYQQSPQEiZ7gR8yXk2Dp',
        blockBrand: 'Test Solo Miner',
        host: '127.0.0.1',
        port: {
            number: 0, // Use 0 for random available port
            diff: 1
        },
        rpc: {
            host: '127.0.0.1',
            port: 8766,
            user: 'testuser',
            password: 'testpass',
            timeout: 5000,
            retryAttempts: 1,
            retryDelay: 100
        },
        jobUpdateInterval: 55,
        blockPollIntervalMs: 250,
        startupRetryAttempts: 1,
        startupRetryDelay: 100,
        debug: true,
        logFile: null,
        ...overrides
    };
}

/**
 * Wait for an event with timeout
 */
function waitForEvent(emitter, eventName, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for event: ${eventName}`));
        }, timeout);

        emitter.once(eventName, (...args) => {
            clearTimeout(timer);
            resolve(args);
        });
    });
}

/**
 * Wait for a condition with timeout
 */
function waitFor(conditionFn, timeout = 5000, interval = 50) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = () => {
            if (conditionFn()) {
                resolve();
            } else if (Date.now() - startTime > timeout) {
                reject(new Error('Timeout waiting for condition'));
            } else {
                setTimeout(check, interval);
            }
        };

        check();
    });
}

/**
 * Get a random available port
 */
function getRandomPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

/**
 * Delay helper
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cross-platform path normalization
 */
function normalizePath(p) {
    return path.normalize(p);
}

/**
 * Platform-specific test skipping
 */
function skipOnWindows(testFn) {
    if (IS_WINDOWS) {
        return function() { console.log('Skipped on Windows'); };
    }
    return testFn;
}

function skipOnLinux(testFn) {
    if (IS_LINUX) {
        return function() { console.log('Skipped on Linux'); };
    }
    return testFn;
}

function windowsOnly(testFn) {
    if (!IS_WINDOWS) {
        return function() { console.log('Windows-only test skipped'); };
    }
    return testFn;
}

module.exports = {
    // Platform info
    IS_WINDOWS,
    IS_LINUX,
    IS_MACOS,
    
    // Classes
    MockLogger,
    MockRpcServer,
    MockMinerClient,
    
    // Helpers
    createTestConfig,
    waitForEvent,
    waitFor,
    getRandomPort,
    delay,
    normalizePath,
    
    // Platform-specific
    skipOnWindows,
    skipOnLinux,
    windowsOnly
};
