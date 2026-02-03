'use strict';

const precon = require('@mintpond/mint-precon');

/**
 * Variable Difficulty Manager
 * 
 * Adjusts client difficulty based on their hash rate to target a specific share submission rate.
 * This ensures optimal performance for miners of all sizes.
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
     * Check if a client needs difficulty adjustment and return the new difficulty if needed.
     * 
     * @param client {Client}
     * @returns {{shouldAdjust: boolean, newDiff: number}|null}
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

        // Check if enough time has passed since last adjustment
        if (now - client.lastDifficultyUpdate < _._retargetTime * 1000) {
            return null;
        }

        // Calculate average time between recent shares
        const recentShares = client.shareTimestamps.slice(-10);
        const intervals = [];
        
        for (let i = 1; i < recentShares.length; i++) {
            intervals.push(recentShares[i] - recentShares[i - 1]);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length / 1000; // Convert to seconds
        const targetTime = _._targetShareTime;
        const variance = _._variancePercent / 100;

        let newDiff = client.diff;

        // Shares coming too fast - increase difficulty
        if (avgInterval < targetTime * (1 - variance)) {
            // Double the difficulty (miner is too fast)
            newDiff = Math.min(client.diff * 2, _._maxDiff);
        }
        // Shares coming too slow - decrease difficulty
        else if (avgInterval > targetTime * (1 + variance)) {
            // Halve the difficulty (miner is too slow)
            newDiff = Math.max(client.diff / 2, _._minDiff);
        }

        // Only adjust if there's an actual change
        if (newDiff !== client.diff) {
            return {
                shouldAdjust: true,
                newDiff: newDiff,
                avgInterval: avgInterval,
                reason: avgInterval < targetTime * (1 - variance) 
                    ? 'shares too fast' 
                    : 'shares too slow'
            };
        }

        return null;
    }

    /**
     * Calculate estimated hash rate based on share submissions.
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

        const recentShares = client.shareTimestamps.slice(-10);
        const timeSpan = (recentShares[recentShares.length - 1] - recentShares[0]) / 1000; // seconds

        if (timeSpan === 0) {
            return 0;
        }

        const sharesPerSecond = (recentShares.length - 1) / timeSpan;
        
        // Hash rate = (difficulty * 2^32) / share_time
        // For multiple shares: (sum of difficulties * 2^32) / total_time
        const totalDifficulty = client.diff * (recentShares.length - 1);
        const hashRate = (totalDifficulty * Math.pow(2, 32)) / timeSpan;

        return hashRate;
    }

    /**
     * Get the initial difficulty for a new client.
     * 
     * @returns {number}
     */
    getInitialDiff() {
        const _ = this;
        // Use the configured port difficulty, but ensure it's within vardiff bounds
        return Math.max(_._minDiff, Math.min(_._maxDiff, _._minDiff * 10));
    }
}

module.exports = VarDiff;
