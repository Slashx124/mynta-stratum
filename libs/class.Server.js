'use strict';

const
    EventEmitter = require('events'),
    net = require('net'),
    precon = require('@mintpond/mint-precon'),
    JsonSocket = require('@mintpond/mint-socket').JsonSocket,
    Counter = require('@mintpond/mint-utils').Counter,
    Client = require('./class.Client');

// Get logger from global or create fallback
const getLogger = () => global.stratumLogger || {
    debug: () => {},
    info: console.log,
    warn: console.warn,
    error: console.error
};


class Server extends EventEmitter {

    /**
     * Constructor.
     *
     * @param args
     * @param args.stratum {Stratum}
     */
    constructor(args) {
        precon.notNull(args.stratum, 'stratum');

        super();

        const _ = this;
        _._stratum = args.stratum;

        _._config = _._stratum.config;
        _._extraNonceCounter = new Counter();
        _._isStarted = false;
        _._isStopped = false;
        _._server = null;
        _._clientMap = new Map();
    }


    /**
     * The name of event emitted when a client connects.
     * @returns {string}
     */
    static get EVENT_CLIENT_CONNECT() { return 'clientConnect' };

    /**
     * The name of event emitted when a client connects.
     * @returns {string}
     */
    static get EVENT_CLIENT_SUBSCRIBE() { return 'clientSubscribe' };

    /**
     * The name of event emitted when a client connects.
     * @returns {string}
     */
    static get EVENT_CLIENT_AUTHORIZE() { return 'clientAuthorize' };

    /**
     * The name of event emitted when a client is disconnected.
     * @returns {string}
     */
    static get EVENT_CLIENT_DISCONNECT() { return 'clientDisconnect' };

    /**
     * The name of event emitted when a client times out due to inactivity.
     * @returns {string}
     */
    static get EVENT_CLIENT_TIMEOUT() { return 'clientTimeout' };

    /**
     * The name of event emitted when a client has a socket error unrelated to disconnect
     * @returns {string}
     */
    static get EVENT_CLIENT_SOCKET_ERROR() { return 'clientSocketError' };

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
     * The name of event emitted when the server encounters an error.
     * @returns {string}
     */
    static get EVENT_SERVER_ERROR() { return 'serverError' }


    /**
     * Get connected client count
     * @returns {number}
     */
    get clientCount() { return this._clientMap.size; }


    /**
     * Start the server.
     *
     * @param [callback] {function(err:*)} Called after the server is started or if an error occurs.
     */
    start(callback) {
        precon.opt_funct(callback, 'callback');

        const _ = this;
        const logger = getLogger();

        if (_._isStarted) {
            const err = new Error('Stratum server is already started.');
            logger.error(err.message);
            callback && callback(err);
            return;
        }

        _._isStarted = true;

        const host = _._config.host;
        const port = _._config.port;

        try {
            _._server = net.createServer({allowHalfOpen: false}, _._onClientConnect.bind(_, port));
        } catch (err) {
            logger.error('Failed to create server:', err);
            callback && callback(err);
            return;
        }

        // Handle server-level errors
        _._server.on('error', (err) => {
            _._handleServerError(err, host, port);
            _.emit(Server.EVENT_SERVER_ERROR, { error: err });
            
            // If server hasn't started listening yet, callback with error
            if (!_._server.listening) {
                callback && callback(err);
            }
        });

        // Handle unexpected server close
        _._server.on('close', () => {
            if (!_._isStopped) {
                logger.warn('Server closed unexpectedly');
            }
        });

        _._server.listen({
            host: host,
            port: port.number
        }, () => {
            logger.info(`Stratum server listening on ${host}:${port.number}`);
            callback && callback(null);
        });
    }


    /**
     * Handle server errors with descriptive messages
     * @param err
     * @param host
     * @param port
     * @private
     */
    _handleServerError(err, host, port) {
        const _ = this;
        const logger = getLogger();

        switch (err.code) {
            case 'EADDRINUSE':
                logger.error(`Port ${port.number} is already in use.`);
                logger.error('Another application may be using this port, or a previous instance is still running.');
                logger.error('Try: 1) Close the other application, 2) Wait a moment and retry, or 3) Use a different port in config.json');
                break;
                
            case 'EACCES':
                logger.error(`Permission denied to bind to port ${port.number}.`);
                logger.error('Ports below 1024 require administrator/root privileges.');
                logger.error('Try using a port number above 1024 (e.g., 3333)');
                break;
                
            case 'EADDRNOTAVAIL':
                logger.error(`Address ${host}:${port.number} is not available.`);
                logger.error('The specified host address is not valid for this machine.');
                logger.error('Try using "0.0.0.0" to listen on all interfaces, or "127.0.0.1" for localhost only');
                break;
                
            case 'ENETUNREACH':
                logger.error('Network is unreachable.');
                logger.error('Check your network connection and firewall settings.');
                break;
                
            default:
                logger.error(`Server error: ${err.message}`);
                logger.error(`Error code: ${err.code || 'unknown'}`);
                break;
        }
    }


    /**
     * Stop the server.
     *
     * @param [callback] {function} Called after the server is stopped.
     */
    stop(callback) {
        precon.opt_funct(callback, 'callback');

        const _ = this;
        const logger = getLogger();

        if (_._isStopped) {
            callback && callback();
            return;
        }

        _._isStopped = true;

        // Disconnect all clients first
        const clientCount = _._clientMap.size;
        logger.debug(`Disconnecting ${clientCount} client(s)...`);
        
        for (const [subscriptionId, client] of _._clientMap) {
            try {
                client.disconnect('Server shutting down');
            } catch (err) {
                logger.debug(`Error disconnecting client ${subscriptionId}:`, err.message);
            }
            _._clientMap.delete(subscriptionId);
        }

        if (_._server) {
            _._server.close(() => {
                logger.info('Stratum server stopped.');
                callback && callback();
            });
            
            // Force callback after timeout if server doesn't close cleanly
            setTimeout(() => {
                logger.warn('Server close timeout - forcing shutdown');
                callback && callback();
            }, 5000);
        } else {
            callback && callback();
        }
    }


    /**
     * Broadcast job to all clients or to a specified array of Client's.
     *
     * @param args
     * @param args.job        {Job}     The job to broadcast.
     * @param args.isNewBlock {boolean} True if the job is for a new block or false to update current block.
     */
    sendMiningJob(args) {
        const _ = this;
        const logger = getLogger();
        
        let sentCount = 0;
        let errorCount = 0;
        
        _.forEachClient(client => {
            if (client.isAuthorized) {
                try {
                    client.setJob(args);
                    sentCount++;
                } catch (err) {
                    errorCount++;
                    logger.debug(`Failed to send job to client ${client.subscriptionIdHex}:`, err.message);
                }
            }
        });
        
        if (errorCount > 0) {
            logger.warn(`Failed to send job to ${errorCount} client(s)`);
        }
        
        logger.debug(`Job broadcast to ${sentCount} client(s)`);
    }


    forEachClient(iteratorFn) {
        precon.funct(iteratorFn, 'iteratorFn');

        const _ = this;
        for (const client of _._clientMap.values()) {
            iteratorFn(client);
        }
    }


    _onClientConnect(port, netSocket) {
        const _ = this;
        const logger = getLogger();

        // Validate socket before processing
        if (_._isStopped) {
            logger.debug('Rejecting connection - server is stopped');
            try {
                netSocket.destroy();
            } catch (e) { /* ignore */ }
            return;
        }

        if (!netSocket || !netSocket.remoteAddress) {
            logger.debug('Rejecting connection - invalid socket or no remote address');
            try {
                netSocket && netSocket.destroy();
            } catch (e) { /* ignore */ }
            return;
        }

        const remoteAddress = netSocket.remoteAddress;
        logger.debug(`New connection from ${remoteAddress}`);

        let extraNonce1Hex;
        try {
            extraNonce1Hex = _._extraNonceCounter.nextHex32();
        } catch (err) {
            logger.error('Failed to generate extraNonce:', err);
            netSocket.destroy();
            return;
        }

        let socket;
        try {
            socket = new JsonSocket({
                netSocket: netSocket
            });
        } catch (err) {
            logger.error('Failed to create JsonSocket:', err);
            netSocket.destroy();
            return;
        }

        let client;
        try {
            client = new Client({
                subscriptionIdHex: extraNonce1Hex,
                extraNonce1Hex: extraNonce1Hex,
                stratum: _._stratum,
                socket: socket,
                port: port
            });
        } catch (err) {
            logger.error('Failed to create Client:', err);
            netSocket.destroy();
            return;
        }

        // Set up client event handlers with error protection
        client.on(Client.EVENT_SUBSCRIBE, _._reEmit(Server.EVENT_CLIENT_SUBSCRIBE, client));
        client.on(Client.EVENT_AUTHORIZE, _._reEmit(Server.EVENT_CLIENT_AUTHORIZE, client));
        client.on(Client.EVENT_DISCONNECT, _._reEmit(Server.EVENT_CLIENT_DISCONNECT, client, () => {
            _._clientMap.delete(client.subscriptionIdHex);
            logger.debug(`Client removed from map: ${client.subscriptionIdHex} (${_._clientMap.size} remaining)`);
        }));
        client.on(Client.EVENT_TIMEOUT, _._reEmit(Server.EVENT_CLIENT_TIMEOUT, client));
        client.on(Client.EVENT_SOCKET_ERROR, _._reEmit(Server.EVENT_CLIENT_SOCKET_ERROR, client));
        client.on(Client.EVENT_MALFORMED_MESSAGE, _._reEmit(Server.EVENT_CLIENT_MALFORMED_MESSAGE, client));
        client.on(Client.EVENT_UNKNOWN_STRATUM_METHOD, _._reEmit(Server.EVENT_CLIENT_UNKNOWN_STRATUM_METHOD, client));

        _._clientMap.set(extraNonce1Hex, client);
        logger.debug(`Client added to map: ${extraNonce1Hex} (${_._clientMap.size} total)`);
        
        _.emit(Server.EVENT_CLIENT_CONNECT, { client: client });
    }


    _reEmit(eventName, client, handlerFn) {
        const _ = this;
        return function (ev) {
            try {
                handlerFn && handlerFn(client, ev);
                _.emit(eventName, { client: client, ...ev });
            } catch (err) {
                const logger = getLogger();
                logger.error(`Error in event handler for ${eventName}:`, err);
            }
        }
    }
}

module.exports = Server;
