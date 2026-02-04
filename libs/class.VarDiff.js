'use strict';

const precon = require('@mintpond/mint-precon');

/**
 * Variable Difficulty Manager
 * 
 * Adjusts client difficulty based on their hash rate to target a specific share submission rate.
 * This ensures optimal performance for miners of all sizes.
 * 
 * All timestamps are in milliseconds (Date.now()) for consistency and precision.
 */
class VarDiff {

    /**
     * Constructor.
     * 
     * @param args
     * @param args.enabled {boolean} Enable vardiff
     * @param args.minDiff {number} Minimum difficulty
     * @param args.maxDiff {number} Maximum difficulty
     * @param args.targetShareTime {number} Target seconds between shares
     * @param args.retargetTime {number} Seconds between difficulty adjustments
     * @param args.variancePercent {number} Acceptable variance percentage
     * @param args.adjustmentFactor {number} Optional - Factor for difficulty adjustment (default: 2 for double/half)
     * @param args.useProportional {boolean} Optional - Use proportional adjustment instead of fixed factor
     */
    constructor(args) {
        precon.boolean(args.enabled, 'enabled');
        precon.positiveNumber(args.minDiff, 'minDiff');
        precon.positiveNumber(args.maxDiff, 'maxDiff');
        precon.positiveNumber(args.targetShareTime, 'targetShareTime');
        precon.positiveNumber(args.retargetTime, 'retargetTime');
        precon.positiveNumber(args.variancePercent, 'variancePercent');

        const _ = this;
        _._enabled = args.enabled;
        _._minDiff = args.minDiff;
        _._maxDiff = args.maxDiff;
        _._targetShareTime = args.targetShareTime;
        _._retargetTime = args.retargetTime;
        _._variancePercent = args.variancePercent;
        
        // Configurable adjustment settings
        _._adjustmentFactor = args.adjustmentFactor || 2; // Default: double/half
        _._useProportional = args.useProportional !== undefined ? args.useProportional : true; // Default: proportional
        
        // Validate min < max
        if (_._minDiff >= _._maxDiff) {
            throw new Error('minDiff must be less than maxDiff');
        }
    }

    /**
     * Determine if vardiff is enabled.
     * @returns {boolean}
     */
    get enabled() { return this._enabled; }

    /**
     * Get minimum difficulty.
     * @returns {number}
     */
    get minDiff() { return this._minDiff; }

    /**
     * Get maximum difficulty.
     * @returns {number}
     */
    get maxDiff() { return this._maxDiff; }

    /**
     * Get target share time in seconds.
     * @returns {number}
     */
    get targetShareTime() { return this._targetShareTime; }

    /**
     * Get retarget time in seconds.
     * @returns {number}
     */
    get retargetTime() { return this._retargetTime; }

    /**
     * Get variance percent.
     * @returns {number}
     */
    get variancePercent() { return this._variancePercent; }

    /**
     * Get adjustment factor.
     * @returns {number}
     */
    get adjustmentFactor() { return this._adjustmentFactor; }

    /**
     * Check if proportional adjustment is enabled.
     * @returns {boolean}
     */
    get useProportional() { return this._useProportional; }

    /**
     * Check if a client needs difficulty adjustment and return the new difficulty if needed.
     * All timestamps are expected in milliseconds.
     * 
     * @param client {Client}
     * @returns {{shouldAdjust: boolean, newDiff: number, avgInterval: number, reason: string}|null}
     */
    checkAdjustment(client) {
        precon.notNull(client, 'client');

        const _ = this;

        if (!_._enabled) {
            return null;
        }

        // Need at least 10 shares to make an accurate assessment
        if (!client.shareTimestamps || client.shareTimestamps.length < 10) {
            return null;
        }

        const now = Date.now();

        // Check if enough time has passed since last adjustment (both in milliseconds)
        const timeSinceLastUpdate = now - client.lastDifficultyUpdate;
        if (timeSinceLastUpdate < _._retargetTime * 1000) {
            return null;
        }

        // Calculate average time between recent shares (optimized - no intermediate arrays)
        const timestamps = client.shareTimestamps;
        const startIdx = Math.max(0, timestamps.length - 10);
        const recentCount = timestamps.length - startIdx;
        
        if (recentCount < 2) {
            return null;
        }

        // Calculate intervals directly without creating intermediate array
        let totalInterval = 0;
        for (let i = startIdx + 1; i < timestamps.length; i++) {
            totalInterval += timestamps[i] - timestamps[i - 1];
        }
        
        // Convert to seconds (timestamps are in milliseconds)
        const avgInterval = (totalInterval / (recentCount - 1)) / 1000;
        const targetTime = _._targetShareTime;
        const variance = _._variancePercent / 100;

        const lowerBound = targetTime * (1 - variance);
        const upperBound = targetTime * (1 + variance);

        let newDiff = client.diff;
        let reason = null;

        // Shares coming too fast - increase difficulty
        if (avgInterval < lowerBound) {
            if (_._useProportional) {
                // Proportional adjustment: scale difficulty based on how far off we are
                // If avgInterval is half of target, double the difficulty
                const ratio = targetTime / avgInterval;
                // Clamp ratio to prevent extreme adjustments (max 4x change)
                const clampedRatio = Math.min(Math.max(ratio, 0.25), 4);
                newDiff = client.diff * clampedRatio;
            } else {
                // Fixed factor adjustment (legacy behavior)
                newDiff = client.diff * _._adjustmentFactor;
            }
            reason = 'shares too fast';
        }
        // Shares coming too slow - decrease difficulty
        else if (avgInterval > upperBound) {
            if (_._useProportional) {
                // Proportional adjustment
                const ratio = targetTime / avgInterval;
                // Clamp ratio to prevent extreme adjustments
                const clampedRatio = Math.min(Math.max(ratio, 0.25), 4);
                newDiff = client.diff * clampedRatio;
            } else {
                // Fixed factor adjustment (legacy behavior)
                newDiff = client.diff / _._adjustmentFactor;
            }
            reason = 'shares too slow';
        }

        // Apply bounds
        if (newDiff !== client.diff) {
            newDiff = Math.max(_._minDiff, Math.min(_._maxDiff, newDiff));
            
            // Round to reasonable precision (avoid floating point noise)
            newDiff = _._roundDifficulty(newDiff);
            
            // Only adjust if there's a meaningful change (> 1% difference)
            if (Math.abs(newDiff - client.diff) / client.diff < 0.01) {
                return null;
            }
            
            return {
                shouldAdjust: true,
                newDiff: newDiff,
                avgInterval: avgInterval,
                reason: reason
            };
        }

        return null;
    }

    /**
     * Calculate estimated hash rate based on share submissions.
     * All timestamps are expected in milliseconds.
     * 
     * @param client {Client}
     * @returns {number} Hash rate in H/s
     */
    estimateHashRate(client) {
        precon.notNull(client, 'client');

        const _ = this;

        if (!client.shareTimestamps || client.shareTimestamps.length < 2) {
            return 0;
        }

        const timestamps = client.shareTimestamps;
        const startIdx = Math.max(0, timestamps.length - 10);
        const recentCount = timestamps.length - startIdx;

        if (recentCount < 2) {
            return 0;
        }

        // Calculate time span in seconds (timestamps are in milliseconds)
        const timeSpanMs = timestamps[timestamps.length - 1] - timestamps[startIdx];
        const timeSpanSeconds = timeSpanMs / 1000;

        if (timeSpanSeconds <= 0) {
            return 0;
        }

        // Number of shares in this span (excluding the first one which marks the start)
        const shareCount = recentCount - 1;
        
        // Hash rate = (difficulty * 2^32) * shares / time
        // This gives us the average hash rate to produce these shares at this difficulty
        const totalDifficulty = client.diff * shareCount;
        const hashRate = (totalDifficulty * Math.pow(2, 32)) / timeSpanSeconds;

        return hashRate;
    }

    /**
     * Get the initial difficulty for a new client.
     * Uses the port's configured difficulty, clamped to vardiff bounds.
     * 
     * @param portDiff {number} The difficulty configured for the port
     * @returns {number}
     */
    getInitialDiff(portDiff) {
        const _ = this;
        
        // Use the configured port difficulty, but ensure it's within vardiff bounds
        if (portDiff !== undefined && portDiff !== null) {
            return Math.max(_._minDiff, Math.min(_._maxDiff, portDiff));
        }
        
        // Fallback: start at a reasonable middle-ground
        // Use geometric mean of min and max for a balanced starting point
        const geometricMean = Math.sqrt(_._minDiff * _._maxDiff);
        return _._roundDifficulty(geometricMean);
    }

    /**
     * Round difficulty to reasonable precision to avoid floating point noise.
     * @param diff {number}
     * @returns {number}
     * @private
     */
    _roundDifficulty(diff) {
        if (diff >= 1) {
            // For difficulty >= 1, round to 6 significant figures
            return parseFloat(diff.toPrecision(6));
        } else {
            // For difficulty < 1, round to 6 decimal places
            return parseFloat(diff.toFixed(6));
        }
    }
}

module.exports = VarDiff;
