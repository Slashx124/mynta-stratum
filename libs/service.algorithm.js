'use strict';

// Get logger from global or create fallback
const getLogger = () => global.stratumLogger || {
    debug: () => {},
    info: console.log,
    warn: console.warn,
    error: console.error
};

// Attempt to load the native KawPow hasher with error handling
let kawpow = null;
let hasherLoadError = null;

try {
    kawpow = require('@mintpond/hasher-kawpow');
} catch (err) {
    hasherLoadError = err;
    const logger = getLogger();
    logger.error('CRITICAL: Failed to load native KawPow hasher module:', err.message);
    logger.error('This may be due to:');
    logger.error('  1. Missing native bindings for this platform');
    logger.error('  2. Incompatible Node.js version');
    logger.error('  3. Corrupted or incomplete installation');
    logger.error('Share validation will fail until this is resolved.');
}

module.exports = {
    diff1: 0x00000000ffff0000000000000000000000000000000000000000000000000000,
    multiplier: Math.pow(2, 8),
    epochLen: 7500,
    
    /**
     * Check if the hasher module is available
     * @returns {boolean}
     */
    isAvailable: () => {
        return kawpow !== null;
    },
    
    /**
     * Get the hasher load error if any
     * @returns {Error|null}
     */
    getLoadError: () => {
        return hasherLoadError;
    },
    
    /**
     * Verify a KawPow share/block
     * @param headerHashBuf {Buffer} Header hash (32 bytes)
     * @param nonceBuf {Buffer} Nonce (8 bytes)
     * @param blockHeight {number} Block height
     * @param mixHashBuf {Buffer} Mix hash (32 bytes)
     * @param hashOutBuf {Buffer} Output buffer for result hash (32 bytes)
     * @returns {boolean} True if verification succeeded
     */
    verify: (headerHashBuf, nonceBuf, blockHeight, mixHashBuf, hashOutBuf) => {
        const logger = getLogger();
        
        // Check if hasher is available
        if (!kawpow) {
            logger.error('Cannot verify share: KawPow hasher not loaded');
            return false;
        }
        
        // Validate inputs before passing to native module
        if (!Buffer.isBuffer(headerHashBuf) || headerHashBuf.length !== 32) {
            logger.debug('Invalid headerHashBuf: expected 32-byte Buffer');
            return false;
        }
        
        if (!Buffer.isBuffer(nonceBuf) || nonceBuf.length !== 8) {
            logger.debug('Invalid nonceBuf: expected 8-byte Buffer');
            return false;
        }
        
        if (typeof blockHeight !== 'number' || blockHeight < 0 || !Number.isInteger(blockHeight)) {
            logger.debug('Invalid blockHeight: expected non-negative integer');
            return false;
        }
        
        if (!Buffer.isBuffer(mixHashBuf) || mixHashBuf.length !== 32) {
            logger.debug('Invalid mixHashBuf: expected 32-byte Buffer');
            return false;
        }
        
        if (!Buffer.isBuffer(hashOutBuf) || hashOutBuf.length !== 32) {
            logger.debug('Invalid hashOutBuf: expected 32-byte Buffer');
            return false;
        }
        
        // Call native verify with validated inputs
        return kawpow.verify(headerHashBuf, nonceBuf, blockHeight, mixHashBuf, hashOutBuf);
    }
};
