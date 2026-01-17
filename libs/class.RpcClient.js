'use strict';

const
    http = require('http'),
    precon = require('@mintpond/mint-precon');

// Get logger from global or create fallback
const getLogger = () => global.stratumLogger || {
    debug: () => {},
    info: console.log,
    warn: console.warn,
    error: console.error
};


class RpcClient {

    /**
     * Constructor.
     *
     * @param args
     * @param args.host {string}
     * @param args.port {number}
     * @param [args.user] {string}
     * @param [args.password] {string}
     * @param [args.timeout] {number} Request timeout in milliseconds (default: 30000)
     * @param [args.retryAttempts] {number} Number of retry attempts (default: 3)
     * @param [args.retryDelay] {number} Delay between retries in milliseconds (default: 5000)
     */
    constructor(args) {
        precon.string(args.host, 'host');
        precon.minMaxInteger(args.port, 1, 65535, 'port');
        precon.opt_string(args.user, 'user');
        precon.opt_string(args.password, 'password');

        const _ = this;
        _._host = args.host;
        _._port = args.port;
        _._user = args.user || '';
        _._password = args.password || '';
        _._timeout = args.timeout || 30000;
        _._retryAttempts = args.retryAttempts || 3;
        _._retryDelay = args.retryDelay || 5000;

        _._msgId = 0;
        _._isConnected = false;
        _._consecutiveFailures = 0;
    }


    /**
     * Get connection status
     * @returns {boolean}
     */
    get isConnected() { return this._isConnected; }

    /**
     * Get consecutive failure count
     * @returns {number}
     */
    get consecutiveFailures() { return this._consecutiveFailures; }


    /**
     * Send an RPC method to the wallet daemon.
     *
     * @param args
     * @param args.method     {string}   The RPC method name.
     * @param [args.params]   {Array}    Array containing method parameter arguments.
     * @param [args.callback(err, rpcResult)] {function} Function to callback when RPC response is received.
     * @param [args.retryCount] {number} Internal retry counter.
     */
    cmd(args) {
        precon.string(args.method, 'method');
        precon.opt_array(args.params, 'params');

        const _ = this;
        const logger = getLogger();
        const method = args.method;
        const params = args.params || [];
        const callback = args.callback;
        const retryCount = args.retryCount || 0;
        
        const request = {
            method: method,
            params: params,
            id: _._msgId++
        };

        logger.debug(`RPC request: ${method}`, params.length > 0 ? `params: ${JSON.stringify(params).substring(0, 100)}` : '');

        _._sendRequest(request, (err, result) => {
            if (err) {
                _._consecutiveFailures++;
                _._isConnected = false;

                // Check if we should retry
                if (_._shouldRetry(err) && retryCount < _._retryAttempts) {
                    const nextRetry = retryCount + 1;
                    logger.warn(`RPC ${method} failed (attempt ${nextRetry}/${_._retryAttempts}): ${err.message || err}`);
                    logger.debug(`Retrying in ${_._retryDelay}ms...`);
                    
                    setTimeout(() => {
                        _.cmd({
                            method: method,
                            params: params,
                            callback: callback,
                            retryCount: nextRetry
                        });
                    }, _._retryDelay);
                    return;
                }

                logger.error(`RPC ${method} failed after ${retryCount + 1} attempt(s): ${err.message || err}`);
                callback && callback(err, null);
            } else {
                _._consecutiveFailures = 0;
                _._isConnected = true;
                logger.debug(`RPC ${method} success`);
                callback && callback(null, result);
            }
        });
    }


    /**
     * Validate a wallet address.
     *
     * @param args
     * @param args.address {string}
     * @param [args.callback] {function(isValid:boolean, results:object)}
     */
    validateAddress(args) {
        precon.string(args.address, 'address');
        precon.opt_funct(args.callback, 'callback');

        const _ = this;
        const logger = getLogger();
        const address = args.address;
        const callback = args.callback;

        _.cmd({
            method: 'validateaddress',
            params: [address],
            callback: (err, results) => {
                if (err) {
                    logger.error('validateaddress failed:', err);
                    callback && callback(false, null);
                    return;
                }

                callback && callback(!err && results && results.isvalid, results);
            }
        });
    }


    /**
     * Test RPC connection
     * @param callback {function(err:*, info:object)}
     */
    testConnection(callback) {
        const _ = this;
        const logger = getLogger();
        
        _.cmd({
            method: 'getblockchaininfo',
            params: [],
            callback: (err, result) => {
                if (err) {
                    logger.error('RPC connection test failed:', err.message || err);
                    callback && callback(err, null);
                } else {
                    logger.debug('RPC connection test successful');
                    callback && callback(null, result);
                }
            }
        });
    }


    /**
     * Determine if an error is retryable
     * @param err
     * @returns {boolean}
     * @private
     */
    _shouldRetry(err) {
        if (!err) return false;
        
        const retryableCodes = [
            'ECONNREFUSED',
            'ECONNRESET', 
            'ETIMEDOUT',
            'ENOTFOUND',
            'ENETUNREACH',
            'EHOSTUNREACH',
            'EPIPE',
            'EAI_AGAIN'
        ];
        
        // Retry on connection errors
        if (err.code && retryableCodes.includes(err.code)) {
            return true;
        }
        
        // Retry on timeout
        if (err.message && err.message.includes('timeout')) {
            return true;
        }
        
        // Don't retry on auth errors or RPC errors
        if (err.isAuthError || err.isRpcError) {
            return false;
        }
        
        return false;
    }


    _sendRequest(request, callback) {
        const _ = this;
        const logger = getLogger();
        
        let serialized;
        try {
            serialized = JSON.stringify(request);
        } catch (err) {
            logger.error('Failed to serialize RPC request:', err);
            callback && callback(err, null);
            return;
        }
        
        const options = {
            hostname: _._host,
            port: _._port,
            method: 'POST',
            auth: `${_._user}:${_._password}`,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(serialized)
            },
            timeout: _._timeout
        };

        let callbackCalled = false;
        const safeCallback = (err, result) => {
            if (callbackCalled) return;
            callbackCalled = true;
            callback && callback(err, result);
        };

        let req;
        try {
            req = http.request(options, res => {
                let data = '';
                res.setEncoding('utf8');

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        _._parseResponse({
                            res: res,
                            json: data,
                            callback: safeCallback
                        });
                    } catch (err) {
                        logger.error('Error parsing RPC response:', err);
                        safeCallback(err, null);
                    }
                });

                res.on('error', err => {
                    logger.error('RPC response error:', err);
                    safeCallback(err, null);
                });
            });
        } catch (err) {
            logger.error('Failed to create HTTP request:', err);
            safeCallback(err, null);
            return;
        }

        // Handle request timeout
        req.on('timeout', () => {
            logger.warn(`RPC request timeout after ${_._timeout}ms`);
            req.destroy();
            const timeoutError = new Error(`RPC request timeout after ${_._timeout}ms`);
            timeoutError.code = 'ETIMEDOUT';
            safeCallback(timeoutError, null);
        });

        req.on('error', err => {
            logger.debug(`RPC request error: ${err.code || err.message}`);
            safeCallback(err, null);
        });

        try {
            req.end(serialized);
        } catch (err) {
            logger.error('Failed to send RPC request:', err);
            safeCallback(err, null);
        }
    }


    _parseResponse(args) {
        const _ = this;
        const logger = getLogger();
        const res = args.res;
        const json = args.json;
        const callback = args.callback;

        // Handle HTTP-level errors
        if (res.statusCode === 401) {
            logger.error('RPC authentication failed - check rpcuser/rpcpassword');
            const authError = new Error('RPC authentication failed - invalid username or password');
            authError.isAuthError = true;
            authError.statusCode = 401;
            callback(authError, null);
            return;
        }

        if (res.statusCode === 403) {
            logger.error('RPC access forbidden - check rpcallowip settings');
            const forbiddenError = new Error('RPC access forbidden - IP not allowed');
            forbiddenError.isAuthError = true;
            forbiddenError.statusCode = 403;
            callback(forbiddenError, null);
            return;
        }

        if (res.statusCode >= 500) {
            logger.error(`RPC server error: HTTP ${res.statusCode}`);
            const serverError = new Error(`RPC server error: HTTP ${res.statusCode}`);
            serverError.statusCode = res.statusCode;
            callback(serverError, null);
            return;
        }

        const parsedJson = _._tryParseJson(json);

        if (parsedJson.error) {
            logger.debug('Failed to parse RPC JSON response');
            callback(parsedJson.error, null);
        }
        else if (parsedJson.parsed.error) {
            // RPC-level error (like method not found, invalid params, etc.)
            const rpcError = new Error(parsedJson.parsed.error.message || 'RPC error');
            rpcError.isRpcError = true;
            rpcError.code = parsedJson.parsed.error.code;
            logger.debug(`RPC error: ${rpcError.message}`);
            callback(rpcError, null);
        }
        else {
            callback(null, parsedJson.parsed.result);
        }
    }


    _tryParseJson(json) {
        const _ = this;
        let result;

        try {
            result = {
                error: null,
                parsed: JSON.parse(json)
            };
        }
        catch (err) {
            // Handle NaN values in JSON (non-standard but some daemons output this)
            if (json && json.indexOf(':-nan') !== -1) {
                const fixedJson = json.replace(/:-nan,/g, ':0');
                result = _._tryParseJson(fixedJson);
            }
            else if (json && json.indexOf(':nan') !== -1) {
                const fixedJson = json.replace(/:nan,/g, ':0');
                result = _._tryParseJson(fixedJson);
            }
            else {
                result = {
                    error: err,
                    parsed: null
                };
            }
        }

        return result;
    }
}


module.exports = RpcClient;
