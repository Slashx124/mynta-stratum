'use strict';

const fs = require('fs');
const path = require('path');

// =============================================================================
// COMMAND LINE ARGUMENTS
// =============================================================================
const args = process.argv.slice(2);
const DEBUG_FLAG = args.includes('--debug') || args.includes('-d');
const LOG_FILE_ARG = args.find(a => a.startsWith('--log='));
const LOG_FILE_PATH = LOG_FILE_ARG ? LOG_FILE_ARG.split('=')[1] : null;

// =============================================================================
// LOGGER UTILITY
// =============================================================================
let logStream = null;
let DEBUG_MODE = DEBUG_FLAG;

function initLogFile(filePath) {
    if (!filePath) return;
    
    try {
        // Resolve path relative to executable or cwd
        let resolvedPath = filePath;
        if (!path.isAbsolute(filePath)) {
            resolvedPath = path.join(process.cwd(), filePath);
        }
        
        logStream = fs.createWriteStream(resolvedPath, { flags: 'a' });
        logStream.on('error', (err) => {
            console.error(`Failed to write to log file: ${err.message}`);
            logStream = null;
        });
    } catch (err) {
        console.error(`Failed to open log file: ${err.message}`);
    }
}

function formatLogMessage(level, args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
        if (arg instanceof Error) {
            return arg.stack || arg.message || String(arg);
        }
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    
    return `[${timestamp}] [${level}] ${message}`;
}

function writeLog(level, consoleMethod, args) {
    const formatted = formatLogMessage(level, args);
    consoleMethod(formatted);
    
    if (logStream) {
        logStream.write(formatted + '\n');
    }
}

const logger = {
    debug: (...args) => {
        if (DEBUG_MODE) {
            writeLog('DEBUG', console.log, args);
        }
    },
    info: (...args) => {
        writeLog('INFO', console.log, args);
    },
    warn: (...args) => {
        writeLog('WARN', console.warn, args);
    },
    error: (...args) => {
        writeLog('ERROR', console.error, args);
    }
};

// Export logger for use in other modules
global.stratumLogger = logger;

// =============================================================================
// GLOBAL ERROR HANDLERS
// =============================================================================
process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION:', err);
    logger.error('Stack trace:', err.stack || 'No stack trace available');
    
    // Give time for log to flush before exit
    if (logStream) {
        logStream.end(() => {
            process.exit(1);
        });
        // Force exit after 2 seconds if stream doesn't close
        setTimeout(() => process.exit(1), 2000);
    } else {
        setTimeout(() => process.exit(1), 100);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('UNHANDLED PROMISE REJECTION:', reason);
    if (reason instanceof Error) {
        logger.error('Stack trace:', reason.stack || 'No stack trace available');
    }
});

// Handle Windows-specific signals gracefully
process.on('SIGINT', () => {
    logger.info('Received SIGINT signal, shutting down gracefully...');
    gracefulShutdown();
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal, shutting down gracefully...');
    gracefulShutdown();
});

// Windows doesn't have SIGTERM, but we can handle the exit event
process.on('exit', (code) => {
    logger.info(`Process exiting with code: ${code}`);
});

// =============================================================================
// CONFIGURATION LOADING
// =============================================================================
function findConfigPath() {
    const locations = [
        path.join(process.cwd(), 'config.json'),
        path.join(path.dirname(process.execPath), 'config.json'),
        path.join(__dirname, 'config.json')
    ];
    
    for (const loc of locations) {
        if (fs.existsSync(loc)) {
            return loc;
        }
    }
    return null;
}

const configPath = findConfigPath();

if (!configPath) {
    logger.error('config.json not found!');
    logger.error('Please create a config.json file with the following structure:');
    console.error(JSON.stringify({
        coinbaseAddress: "YOUR_MYNTA_ADDRESS",
        blockBrand: "Mynta Solo Miner",
        host: "0.0.0.0",
        port: { number: 3333, diff: 1 },
        rpc: {
            host: "127.0.0.1",
            port: 8766,
            user: "myntarpc",
            password: "YOUR_RPC_PASSWORD",
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 5000
        },
        jobUpdateInterval: 55,
        blockPollIntervalMs: 250,
        debug: false,
        logFile: null
    }, null, 2));
    process.exit(1);
}

let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    logger.info('Loaded configuration from:', configPath);
} catch (e) {
    logger.error('Failed to parse config.json:', e.message);
    process.exit(1);
}

// Apply config-based debug mode (CLI flag takes precedence)
if (!DEBUG_FLAG && config.debug === true) {
    DEBUG_MODE = true;
}

// Initialize log file from config or CLI
const logFilePath = LOG_FILE_PATH || config.logFile;
if (logFilePath) {
    initLogFile(logFilePath);
    logger.info('Logging to file:', logFilePath);
}

// Export config for other modules
global.stratumConfig = config;

// =============================================================================
// CONFIGURATION VALIDATION
// =============================================================================
if (!config.coinbaseAddress) {
    logger.error('coinbaseAddress is required in config.json');
    process.exit(1);
}

if (!config.coinbaseAddress.startsWith('M')) {
    logger.warn('coinbaseAddress should start with "M" for Mynta addresses');
}

if (!config.rpc || !config.rpc.host || !config.rpc.port) {
    logger.error('rpc configuration is required in config.json');
    process.exit(1);
}

// =============================================================================
// STRATUM SERVER INITIALIZATION
// =============================================================================
const Stratum = require('./libs/class.Stratum');

let stratum = null;

function createStratum() {
    return new Stratum({
        coinbaseAddress: config.coinbaseAddress,
        blockBrand: config.blockBrand || 'Mynta Solo Miner',
        host: config.host || "0.0.0.0",
        port: config.port || { number: 3333, diff: 1 },
        rpc: {
            host: config.rpc.host,
            port: config.rpc.port,
            user: config.rpc.user,
            password: config.rpc.password,
            timeout: config.rpc.timeout || 30000,
            retryAttempts: config.rpc.retryAttempts || 3,
            retryDelay: config.rpc.retryDelay || 5000
        },
        jobUpdateInterval: config.jobUpdateInterval || 55,
        blockPollIntervalMs: config.blockPollIntervalMs || 250,
        debug: DEBUG_MODE
    });
}

function gracefulShutdown() {
    logger.info('Shutting down stratum proxy...');
    
    if (stratum) {
        stratum.destroy(() => {
            logger.info('Stratum server stopped');
            if (logStream) {
                logStream.end(() => process.exit(0));
            } else {
                process.exit(0);
            }
        });
        
        // Force exit after 5 seconds
        setTimeout(() => {
            logger.warn('Forced shutdown after timeout');
            process.exit(0);
        }, 5000);
    } else {
        process.exit(0);
    }
}

function startStratum() {
    stratum = createStratum();
    
    // Set up event handlers
    stratum.on(Stratum.EVENT_CLIENT_CONNECT, ev => {
        logger.info(`Client connected: ${ev.client.socket.remoteAddress}`);
        logger.debug('Client details:', JSON.stringify(ev.client.toJSON()));
    });

    stratum.on(Stratum.EVENT_CLIENT_DISCONNECT, ev => {
        logger.info(`Client disconnected: ${ev.client.socket.remoteAddress} - ${ev.reason || 'unknown reason'}`);
    });

    stratum.on(Stratum.EVENT_CLIENT_SUBSCRIBE, ev => {
        logger.debug(`Client subscribed: ${ev.client.subscriptionIdHex}`);
    });

    stratum.on(Stratum.EVENT_CLIENT_AUTHORIZE, ev => {
        logger.info(`Worker authorized: ${ev.client.workerName}`);
    });

    stratum.on(Stratum.EVENT_CLIENT_TIMEOUT, ev => {
        logger.warn(`Client timeout: ${ev.client.socket.remoteAddress}`);
    });

    stratum.on(Stratum.EVENT_CLIENT_SOCKET_ERROR, ev => {
        logger.error(`Client socket error: ${ev.client.socket.remoteAddress}`, ev);
    });

    stratum.on(Stratum.EVENT_CLIENT_MALFORMED_MESSAGE, ev => {
        logger.warn(`Malformed message from client: ${ev.client.socket.remoteAddress}`);
        logger.debug('Malformed message:', ev.message);
    });

    stratum.on(Stratum.EVENT_CLIENT_UNKNOWN_STRATUM_METHOD, ev => {
        logger.debug(`Unknown stratum method from client: ${ev.client.socket.remoteAddress}`, ev.message);
    });

    stratum.on(Stratum.EVENT_SHARE_SUBMITTED, ev => {
        if (ev.share.isValidBlock) {
            logger.info(`*** BLOCK FOUND! *** Submitted by ${ev.share.client.workerName} - Block ID: ${ev.share.blockId}`);
        } else if (ev.share.isValidShare) {
            logger.info(`Valid share from ${ev.share.client.workerName} - Diff: ${ev.share.shareDiff.toFixed(4)}`);
        } else {
            logger.warn(`Invalid share from ${ev.share.client.workerName}: ${ev.share.error ? ev.share.error.message : 'unknown error'}`);
            logger.debug('Share details:', JSON.stringify(ev.share.toJSON()));
        }
    });

    stratum.on(Stratum.EVENT_NEW_BLOCK, ev => {
        logger.info(`New block detected - Height: ${ev.job.height}`);
    });

    stratum.on(Stratum.EVENT_NEXT_JOB, ev => {
        logger.debug(`Job broadcast - ID: ${ev.job.idHex}, Height: ${ev.job.height}, New Block: ${ev.isNewBlock}`);
    });

    // Initialize stratum with error handling
    stratum.init((err) => {
        if (err) {
            logger.error('Failed to initialize stratum server:', err);
            logger.error('Check that Mynta daemon is running and RPC is accessible');
            process.exit(1);
        }
    });

    // Startup banner
    logger.info('='.repeat(60));
    logger.info('Mynta Stratum Proxy v1.0.0');
    logger.info('='.repeat(60));
    logger.info(`Mining address: ${config.coinbaseAddress}`);
    logger.info(`RPC endpoint: ${config.rpc.host}:${config.rpc.port}`);
    logger.info(`Stratum port: ${config.port?.number || 3333}`);
    if (DEBUG_MODE) {
        logger.info('Debug mode: ENABLED');
    }
    if (logFilePath) {
        logger.info(`Log file: ${logFilePath}`);
    }
    logger.info('='.repeat(60));
}

// =============================================================================
// ERROR PROTOTYPE EXTENSION (for JSON serialization)
// =============================================================================
if (!Error.prototype.toJSON) {
    Error.prototype.toJSON = function () {
        const jsonObj = {};
        Object.getOwnPropertyNames(this).forEach(key => {
            jsonObj[key] = this[key];
        }, this);
        return jsonObj;
    };
}

// =============================================================================
// START THE SERVER
// =============================================================================
startStratum();
