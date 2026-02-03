'use strict';

const
    EventEmitter = require('events'),
    precon = require('@mintpond/mint-precon'),
    RpcClient = require('./class.RpcClient'),
    Server = require('./class.Server'),
    Client = require('./class.Client'),
    Share = require('./class.Share'),
    JobManager = require('./class.JobManager'),
    VarDiff = require('./class.VarDiff');

// Get logger from global or create fallback
const getLogger = () => global.stratumLogger || {
    debug: () => {},
    info: console.log,
    warn: console.warn,
    error: console.error
};

// Default startup retry settings
const DEFAULT_STARTUP_RETRY_ATTEMPTS = 5;
const DEFAULT_STARTUP_RETRY_DELAY = 5000; // 5 seconds


class Stratum extends EventEmitter {

    /**
     * Constructor.
     *
     * @param config
     */
    constructor(config) {

        super();

        const _ = this;
        _._config = config;

        _._isInit = false;
        _._isDestroyed = false;
        _._server = null;
        _._jobManager = null;
        _._rpcClient = null;
        _._varDiff = null;
    }


    /**
     * The name of event emitted when a client connects.
     * @returns {string}
     */
    static get EVENT_CLIENT_CONNECT() { return 'clientConnect'; }

    /**
     * The name of event emitted when a client successfully subscribes.
     * @returns {string}
     */
    static get EVENT_CLIENT_SUBSCRIBE() { return 'clientSubscribe'; }

    /**
     * The name of event emitted when a client successfully authorizes their worker.
     * @returns {string}
     */
    static get EVENT_CLIENT_AUTHORIZE() { return 'clientAuthorize'; }

    /**
     * The name of event emitted when a client times out due to inactivity.
     * @returns {string}
     */
    static get EVENT_CLIENT_TIMEOUT() { return 'clientTimeout'; }

    /**
     * The name of event emitted when a client has a socket error unrelated to disconnect.
     * @returns {string}
     */
    static get EVENT_CLIENT_SOCKET_ERROR() { return 'clientSocketError'; }

    /**
     * The name of event emitted when a share is submitted.
     * @returns {string}
     */
    static get EVENT_SHARE_SUBMITTED() { return 'shareSubmitted'; }

    /**
     * The name of event emitted when a client disconnects.
     * @returns {string}
     */
    static get EVENT_CLIENT_DISCONNECT() { return 'clientDisconnect'; }

    /**
     * The name of event emitted when a client sends a malformed message.
     * @returns {string}
     */
    static get EVENT_CLIENT_MALFORMED_MESSAGE() { return 'clientMalformedMessage' }

    /**
     * The name of event emitted when a client sends a message with an unknown stratum method.
     * @returns {string}
     */
    static get EVENT_CLIENT_UNKNOWN_STRATUM_METHOD() { return 'clientUnknownStratumMethod' }

    /**
     * The name of event emitted when a new block is detected.
     * @returns {string}
     */
    static get EVENT_NEW_BLOCK() { return 'newBlock'; }

    /**
     * The name of event emitted when a job is broadcast.
     * @returns {string}
     */
    static get EVENT_NEXT_JOB() { return 'nextJob'; }

    /**
     * The name of event emitted when RPC connection is lost.
     * @returns {string}
     */
    static get EVENT_RPC_DISCONNECTED() { return 'rpcDisconnected'; }

    /**
     * The name of event emitted when RPC connection is restored.
     * @returns {string}
     */
    static get EVENT_RPC_CONNECTED() { return 'rpcConnected'; }


    /**
     * Determine if the stratum is initialized and started.
     * @returns {boolean}
     */
    get isInitialized() { return this._isInit; };

    /**
     * Get the stratum server.
     * @returns {null|Server}
     */
    get server() { return this._server; };

    /**
     * Get the job manager.
     * @returns {null|JobManager}
     */
    get jobManager() { return this._jobManager; }

    /**
     * Get the coin node RPC client.
     * @returns {null|RpcClient}
     */
    get rpcClient() { return this._rpcClient; }

    /**
     * Get the stratum configuration.
     * @returns {{...}}
     */
    get config() { return this._config; }


    /**
     * Start the stratum.
     * 
     * @param [callback] {function(err:*)} Called when initialization completes or fails.
     */
    init(callback) {
        precon.opt_funct(callback, 'callback');

        const _ = this;
        const logger = getLogger();

        if (_._isInit) {
            logger.warn('Stratum is already initialized');
            callback && callback(null);
            return;
        }

        if (_._isDestroyed) {
            const err = new Error('Cannot initialize destroyed stratum instance');
            logger.error(err.message);
            callback && callback(err);
            return;
        }

        logger.debug('Initializing stratum...');

        // Create components
        _._server = _._createServer();
        _._jobManager = _._createJobManager();
        _._rpcClient = _._createRpcClient();
        _._varDiff = _._createVarDiff();

        // Set up server event forwarding
        _._server.on(Server.EVENT_CLIENT_CONNECT, _._reEmit(Stratum.EVENT_CLIENT_CONNECT));
        _._server.on(Server.EVENT_CLIENT_DISCONNECT, _._reEmit(Stratum.EVENT_CLIENT_DISCONNECT));
        _._server.on(Server.EVENT_CLIENT_SUBSCRIBE, _._reEmit(Stratum.EVENT_CLIENT_SUBSCRIBE));
        _._server.on(Server.EVENT_CLIENT_AUTHORIZE, _._reEmit(Stratum.EVENT_CLIENT_AUTHORIZE));
        _._server.on(Server.EVENT_CLIENT_TIMEOUT, _._reEmit(Stratum.EVENT_CLIENT_TIMEOUT));
        _._server.on(Server.EVENT_CLIENT_SOCKET_ERROR, _._reEmit(Stratum.EVENT_CLIENT_SOCKET_ERROR));
        _._server.on(Server.EVENT_CLIENT_MALFORMED_MESSAGE, _._reEmit(Stratum.EVENT_CLIENT_MALFORMED_MESSAGE));
        _._server.on(Server.EVENT_CLIENT_UNKNOWN_STRATUM_METHOD, _._reEmit(Stratum.EVENT_CLIENT_UNKNOWN_STRATUM_METHOD));

        // Handle server errors
        _._server.on(Server.EVENT_SERVER_ERROR, (ev) => {
            logger.error('Server error event:', ev.error.message);
        });

        // Test RPC connection first with retries
        _._initWithRetry(callback);
    }


    /**
     * Initialize with retry logic
     * @param callback
     * @param attempt
     * @private
     */
    _initWithRetry(callback, attempt = 1) {
        const _ = this;
        const logger = getLogger();
        const maxAttempts = _._config.startupRetryAttempts || DEFAULT_STARTUP_RETRY_ATTEMPTS;
        const retryDelay = _._config.startupRetryDelay || DEFAULT_STARTUP_RETRY_DELAY;

        logger.info(`Connecting to Mynta daemon (attempt ${attempt}/${maxAttempts})...`);

        // Test RPC connection
        _._rpcClient.testConnection((err, info) => {
            if (err) {
                if (attempt < maxAttempts && !_._isDestroyed) {
                    logger.warn(`RPC connection failed: ${err.message}`);
                    logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
                    
                    setTimeout(() => {
                        _._initWithRetry(callback, attempt + 1);
                    }, retryDelay);
                    return;
                }

                // Max retries reached
                logger.error(`Failed to connect to Mynta daemon after ${attempt} attempts`);
                logger.error('Please ensure:');
                logger.error('  1. Mynta daemon (myntad or mynta-qt) is running');
                logger.error('  2. RPC is enabled (server=1 in mynta.conf)');
                logger.error('  3. RPC credentials match config.json');
                logger.error(`  4. RPC is accessible at ${_._config.rpc.host}:${_._config.rpc.port}`);
                
                callback && callback(err);
                return;
            }

            logger.info('Connected to Mynta daemon');
            if (info) {
                logger.debug(`Chain: ${info.chain}, Blocks: ${info.blocks}, Headers: ${info.headers}`);
            }

            _.emit(Stratum.EVENT_RPC_CONNECTED, { info: info });

            // Initialize job manager
            _._jobManager.init((jobErr) => {
                if (jobErr) {
                    logger.error('Failed to get initial block template:', jobErr.message || jobErr);
                    logger.error('The daemon may still be syncing or IBD (Initial Block Download) is in progress.');
                    callback && callback(jobErr);
                    return;
                }

                logger.debug('Job manager initialized');

                // Start server
                _._server.start((serverErr) => {
                    if (serverErr) {
                        logger.error('Failed to start stratum server:', serverErr.message);
                        callback && callback(serverErr);
                        return;
                    }

                    // Set up job broadcasting
                    _._jobManager.on(JobManager.EVENT_NEXT_JOB, _._onNextJob.bind(_));

                    _._isInit = true;
                    logger.info('Stratum server initialized successfully');
                    callback && callback(null);
                });
            });
        });
    }


    /**
     * Stop the stratum.
     *
     * @param [callback] {function} Function to call after the stratum is stopped.
     */
    destroy(callback) {
        precon.opt_funct(callback, 'callback');

        const _ = this;
        const logger = getLogger();

        if (_._isDestroyed) {
            callback && callback();
            return;
        }

        _._isDestroyed = true;
        logger.info('Destroying stratum instance...');

        // Destroy job manager first
        if (_._jobManager) {
            try {
                _._jobManager.destroy();
            } catch (err) {
                logger.error('Error destroying job manager:', err.message);
            }
        }

        // Stop server
        if (_._server) {
            _._server.stop(() => {
                logger.debug('Server stopped');
                callback && callback();
            });
        } else {
            callback && callback();
        }
    }


    /**
     * Notify the stratum of a new block on the network.
     *
     * This is only needed if block polling is disabled.
     */
    blockNotify() {
        const _ = this;
        _.jobManager && _.jobManager.blockNotify();
    }


    /**
     * Determine if a worker can be authorized or should be rejected.
     *
     * @param client {Client}
     * @param callback {function(err:*,isAuthorized:boolean)}
     */
    canAuthorizeWorker(client, callback) {
        callback(null, true);
    }


    /**
     * Handle a share submitted by a client.
     *
     * @param client {Client} The client that submitted the share.
     * @param share  {Share}  The share data.
     */
    submitShare(client, share) {
        precon.instanceOf(client, Client, 'client');
        precon.instanceOf(share, Share, 'share');

        const _ = this;
        const logger = getLogger();

        // Record share timestamp for vardiff if valid
        if (share.isValidShare) {
            client.recordShare();
            
            // Check if difficulty adjustment is needed
            const adjustment = _._varDiff.checkAdjustment(client);
            if (adjustment && adjustment.shouldAdjust) {
                const oldDiff = client.diff;
                client.diff = adjustment.newDiff;
                client.lastDifficultyUpdate = Date.now();
                
                logger.info(`Vardiff adjustment for ${client.workerName}: ${oldDiff.toFixed(6)} -> ${adjustment.newDiff.toFixed(6)} (${adjustment.reason}, avg interval: ${adjustment.avgInterval.toFixed(2)}s)`);
                
                // Send difficulty change to client
                _._server.sendDifficultyUpdate(client);
            }
            
            // Log estimated hash rate
            if (client.shareTimestamps.length >= 10) {
                const hashRate = _._varDiff.estimateHashRate(client);
                const hashRateFormatted = hashRate > 1e9 
                    ? (hashRate / 1e9).toFixed(2) + ' GH/s'
                    : hashRate > 1e6
                    ? (hashRate / 1e6).toFixed(2) + ' MH/s'
                    : hashRate > 1e3
                    ? (hashRate / 1e3).toFixed(2) + ' KH/s'
                    : hashRate.toFixed(2) + ' H/s';
                
                logger.debug(`${client.workerName} estimated hashrate: ${hashRateFormatted}`);
            }
        }

        if (share.isValidBlock) {
            logger.info(`Submitting block to daemon...`);

            _._submitBlock(share, (err) => {

                if (err) {
                    logger.error('Block submission failed:', err.message || err);
                    _._emitShare(share);
                    return;
                }

                logger.info('Block submitted successfully, verifying...');

                _.jobManager.updateJob(() => {
                    _._checkBlockAccepted(share, (checkErr, result) => {

                        if (checkErr || !result.isAccepted) {
                            share.isValidBlock = false;
                            logger.warn('Block was not accepted by the network');
                        }
                        else {
                            share.blockTxId = result.block.txId;
                            logger.info(`Block accepted! TxID: ${share.blockTxId}`);
                        }

                        _._emitShare(share);
                    });
                });
            });
        }
        else {
            _._emitShare(share);
        }
    }


    _createServer() {
        const _ = this;
        return new Server({ stratum: _ });
    }


    _createJobManager() {
        const _ = this;
        return new JobManager({ stratum: _ });
    }


    _createRpcClient() {
        const _ = this;
        const rpc = _._config.rpc;
        return new RpcClient({
            host: rpc.host,
            port: rpc.port,
            user: rpc.user,
            password: rpc.password,
            timeout: rpc.timeout || 30000,
            retryAttempts: rpc.retryAttempts || 3,
            retryDelay: rpc.retryDelay || 5000
        });
    }

    _createVarDiff() {
        const _ = this;
        const vardiffConfig = _._config.vardiff || {};
        
        return new VarDiff({
            enabled: vardiffConfig.enabled !== false, // Default to enabled if not specified
            minDiff: vardiffConfig.minDiff || 0.001,
            maxDiff: vardiffConfig.maxDiff || 1000000,
            targetShareTime: vardiffConfig.targetShareTime || 15,
            retargetTime: vardiffConfig.retargetTime || 90,
            variancePercent: vardiffConfig.variancePercent || 30
        });
    }


    _submitBlock(share, callback) {
        const _ = this;
        const logger = getLogger();

        _._rpcClient.cmd({
            method: 'submitblock',
            params: [share.blockHex],
            callback: (err, result) => {
                if (err) {
                    logger.error('Error submitting block to node:', err.message || err);
                    callback(err);
                }
                else if (result) {
                    // Non-null result means rejection
                    logger.error('Node rejected block:', result);
                    callback(new Error(`Block rejected: ${result}`));
                }
                else {
                    // null result means success
                    callback(null);
                }
            }
        });
    }


    _checkBlockAccepted(share, callback) {
        const _ = this;
        const logger = getLogger();

        _._rpcClient.cmd({
            method: 'getblock',
            params: [share.blockId],
            callback: (err, block) => {
                if (err) {
                    logger.error('Failed to verify block submission:', err.message || err);
                    callback(err, {
                        isAccepted: false
                    });
                }
                else {
                    logger.debug('Block verified on chain');
                    callback(null, {
                        isAccepted: true,
                        block: block
                    });
                }
            }
        });
    }


    _emitShare(share) {
        const _ = this;

        try {
            _.emit(Stratum.EVENT_SHARE_SUBMITTED, {
                client: share.client,
                share: share
            });
        } catch (err) {
            const logger = getLogger();
            logger.error('Error emitting share event:', err);
        }
    }


    _onNextJob(ev) {
        const _ = this;
        const logger = getLogger();

        try {
            precon.notNull(ev.job, 'job');
            precon.boolean(ev.isNewBlock, 'isNewBlock');

            const job = ev.job;
            const isNewBlock = ev.isNewBlock;

            _.emit(Stratum.EVENT_NEXT_JOB, { job: job, isNewBlock: isNewBlock });

            if (isNewBlock)
                _.emit(Stratum.EVENT_NEW_BLOCK, { job: job });

            _._server.sendMiningJob({
                job: job,
                isNewBlock: isNewBlock
            });
        } catch (err) {
            logger.error('Error processing next job:', err);
        }
    }


    _reEmit(eventName, handlerFn) {
        const _ = this;
        return function(ev) {
            try {
                handlerFn && handlerFn(ev);
                _.emit(eventName, ev);
            } catch (err) {
                const logger = getLogger();
                logger.error(`Error in event handler for ${eventName}:`, err);
            }
        };
    }
}

module.exports = Stratum;
