'use strict';

/**
 * Unit tests for VarDiff class
 * Tests variable difficulty adjustment logic
 * 
 * All timestamps are in milliseconds (Date.now()) for consistency.
 */

const assert = require('assert');

// Mock logger
const { MockLogger } = require('../test-utils');
const mockLogger = new MockLogger();
global.stratumLogger = mockLogger;

const VarDiff = require('../../libs/class.VarDiff');

// Mock Client for testing - mimics real Client vardiff tracking
class MockClient {
    constructor() {
        this.diff = 1;
        this._shareTimestamps = [];
        this._lastDifficultyUpdate = Date.now();
        this._lastMonotonicTime = process.hrtime.bigint();
    }

    get shareTimestamps() { return this._shareTimestamps; }
    get lastDifficultyUpdate() { return this._lastDifficultyUpdate; }
    set lastDifficultyUpdate(time) { this._lastDifficultyUpdate = time; }
    get lastMonotonicTime() { return this._lastMonotonicTime; }
    set lastMonotonicTime(time) { this._lastMonotonicTime = time; }

    // Add shares at specific intervals (for testing)
    addSharesWithInterval(count, intervalMs, startTime = Date.now()) {
        for (let i = 0; i < count; i++) {
            this._shareTimestamps.push(startTime + (i * intervalMs));
        }
    }

    // Simulate real share recording
    recordShare() {
        const now = Date.now();
        this._shareTimestamps.push(now);
        this._lastMonotonicTime = process.hrtime.bigint();
        while (this._shareTimestamps.length > 100) {
            this._shareTimestamps.shift();
        }
    }
}

describe('VarDiff', function() {
    this.timeout(5000);

    describe('Constructor', function() {
        it('should create vardiff with valid config', function() {
            const vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });

            assert.strictEqual(vardiff.enabled, true);
            assert.strictEqual(vardiff.minDiff, 0.001);
            assert.strictEqual(vardiff.maxDiff, 1000);
            assert.strictEqual(vardiff.targetShareTime, 15);
            assert.strictEqual(vardiff.retargetTime, 90);
            assert.strictEqual(vardiff.variancePercent, 30);
        });

        it('should use default values for optional parameters', function() {
            const vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });

            assert.strictEqual(vardiff.adjustmentFactor, 2); // Default
            assert.strictEqual(vardiff.useProportional, true); // Default
        });

        it('should accept custom adjustment settings', function() {
            const vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30,
                adjustmentFactor: 1.5,
                useProportional: false
            });

            assert.strictEqual(vardiff.adjustmentFactor, 1.5);
            assert.strictEqual(vardiff.useProportional, false);
        });

        it('should throw on invalid config', function() {
            assert.throws(() => {
                new VarDiff({
                    enabled: true,
                    minDiff: -1, // Invalid
                    maxDiff: 1000,
                    targetShareTime: 15,
                    retargetTime: 90,
                    variancePercent: 30
                });
            });
        });

        it('should throw if minDiff >= maxDiff', function() {
            assert.throws(() => {
                new VarDiff({
                    enabled: true,
                    minDiff: 1000,
                    maxDiff: 1000, // Equal to min
                    targetShareTime: 15,
                    retargetTime: 90,
                    variancePercent: 30
                });
            });
        });
    });

    describe('checkAdjustment', function() {
        let vardiff;

        beforeEach(function() {
            vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30,
                useProportional: true
            });
        });

        it('should return null when disabled', function() {
            const disabledVardiff = new VarDiff({
                enabled: false,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });

            const client = new MockClient();
            const now = Date.now();
            // Add 10 shares at 5s intervals (milliseconds)
            client.addSharesWithInterval(10, 5000, now - 50000);
            client.lastDifficultyUpdate = now - 120000;

            const result = disabledVardiff.checkAdjustment(client);
            assert.strictEqual(result, null);
        });

        it('should return null with insufficient shares', function() {
            const client = new MockClient();
            const now = Date.now();
            // Only 3 shares
            client.addSharesWithInterval(3, 5000, now - 15000);

            const result = vardiff.checkAdjustment(client);
            assert.strictEqual(result, null);
        });

        it('should return null before retarget time', function() {
            const client = new MockClient();
            const now = Date.now();
            
            // Last update was 30 seconds ago (less than 90s retarget time)
            client.lastDifficultyUpdate = now - 30000;
            
            // Add 10 shares spaced 5 seconds apart (fast)
            client.addSharesWithInterval(10, 5000, now - 50000);

            const result = vardiff.checkAdjustment(client);
            assert.strictEqual(result, null);
        });

        it('should increase difficulty when shares too fast (proportional)', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            // Last update was 120 seconds ago
            client.lastDifficultyUpdate = now - 120000;
            
            // Add 10 shares spaced 5 seconds apart (5s << 15s target)
            // avgInterval = 5s, target = 15s, ratio = 15/5 = 3
            client.addSharesWithInterval(10, 5000, now - 50000);

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert.strictEqual(result.shouldAdjust, true);
            assert.strictEqual(result.reason, 'shares too fast');
            // With proportional, diff should be ~3x (clamped)
            assert(result.newDiff > client.diff, 'Difficulty should increase');
            assert(result.newDiff <= 3 * client.diff, 'Should not exceed proportional limit');
        });

        it('should decrease difficulty when shares too slow (proportional)', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            // Last update was 120 seconds ago
            client.lastDifficultyUpdate = now - 120000;
            
            // Add 10 shares spaced 30 seconds apart (30s >> 15s target)
            // avgInterval = 30s, target = 15s, ratio = 15/30 = 0.5
            client.addSharesWithInterval(10, 30000, now - 300000);

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert.strictEqual(result.shouldAdjust, true);
            assert.strictEqual(result.reason, 'shares too slow');
            // With proportional, diff should be ~0.5x
            assert(result.newDiff < client.diff, 'Difficulty should decrease');
        });

        it('should use fixed factor when useProportional is false', function() {
            const fixedVardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30,
                useProportional: false,
                adjustmentFactor: 2
            });

            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            // Shares too fast
            client.addSharesWithInterval(10, 5000, now - 50000);

            const result = fixedVardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert.strictEqual(result.newDiff, 2); // Exactly doubled
        });

        it('should respect minimum difficulty', function() {
            const client = new MockClient();
            client.diff = 0.002; // Very low difficulty
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Very slow shares (60s intervals)
            client.addSharesWithInterval(10, 60000, now - 600000);

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert(result.newDiff >= 0.001, 'Should not go below minDiff');
        });

        it('should respect maximum difficulty', function() {
            const client = new MockClient();
            client.diff = 800; // High difficulty
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Very fast shares (1s intervals)
            client.addSharesWithInterval(10, 1000, now - 10000);

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert(result.newDiff <= 1000, 'Should not exceed maxDiff');
        });

        it('should not adjust within variance', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Shares at 14s intervals (within 30% of 15s target)
            // Variance range: 10.5s to 19.5s
            client.addSharesWithInterval(10, 14000, now - 140000);

            const result = vardiff.checkAdjustment(client);
            
            // Should be null because 14s is within variance of 15s ± 30%
            assert.strictEqual(result, null);
        });

        it('should ignore small adjustments (< 1%)', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Shares at 10.4s intervals (just barely outside variance)
            // This would produce a very small proportional adjustment
            client.addSharesWithInterval(10, 10400, now - 104000);

            const result = vardiff.checkAdjustment(client);
            
            // If adjustment is < 1%, should return null
            if (result !== null) {
                assert(Math.abs(result.newDiff - client.diff) / client.diff >= 0.01, 
                    'Should only adjust if change is >= 1%');
            }
        });

        it('should clamp extreme proportional adjustments to 4x', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Extremely fast shares (0.5s intervals) - would be 30x adjustment unclamped
            // 15 / 0.5 = 30, but should clamp to 4
            client.addSharesWithInterval(10, 500, now - 5000);

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert(result.newDiff <= 4 * client.diff, 'Should clamp to max 4x adjustment');
        });
    });

    describe('estimateHashRate', function() {
        let vardiff;

        beforeEach(function() {
            vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });
        });

        it('should return 0 with insufficient shares', function() {
            const client = new MockClient();
            client._shareTimestamps = [Date.now()]; // Only 1 share

            const hashRate = vardiff.estimateHashRate(client);
            assert.strictEqual(hashRate, 0);
        });

        it('should return 0 with empty timestamps', function() {
            const client = new MockClient();
            client._shareTimestamps = [];

            const hashRate = vardiff.estimateHashRate(client);
            assert.strictEqual(hashRate, 0);
        });

        it('should calculate hash rate correctly with millisecond timestamps', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            // 10 shares over 90 seconds = 9 intervals
            // Each interval is 10 seconds
            client.addSharesWithInterval(10, 10000, now - 90000);

            const hashRate = vardiff.estimateHashRate(client);
            
            // Should be positive
            assert(hashRate > 0, 'Hash rate should be positive');
            
            // Expected: (9 shares * diff 1 * 2^32) / 90 seconds
            const expected = (9 * Math.pow(2, 32)) / 90;
            const tolerance = expected * 0.05; // 5% tolerance for timing
            
            assert(Math.abs(hashRate - expected) < tolerance, 
                `Hash rate ${hashRate} should be close to ${expected}`);
        });

        it('should scale with difficulty', function() {
            const client = new MockClient();
            client.diff = 10; // 10x difficulty
            const now = Date.now();
            
            // Same timing as previous test
            client.addSharesWithInterval(10, 10000, now - 90000);

            const hashRate = vardiff.estimateHashRate(client);
            
            // Should be ~10x the diff=1 case
            const expected = (9 * 10 * Math.pow(2, 32)) / 90;
            const tolerance = expected * 0.05;
            
            assert(Math.abs(hashRate - expected) < tolerance,
                `Hash rate ${hashRate} should be close to ${expected}`);
        });

        it('should return 0 if time span is zero', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            // All shares at the same timestamp
            client._shareTimestamps = [now, now, now, now, now];

            const hashRate = vardiff.estimateHashRate(client);
            assert.strictEqual(hashRate, 0);
        });
    });

    describe('getInitialDiff', function() {
        let vardiff;

        beforeEach(function() {
            vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });
        });

        it('should use port difficulty when provided', function() {
            const initialDiff = vardiff.getInitialDiff(5);
            assert.strictEqual(initialDiff, 5);
        });

        it('should clamp port difficulty to min bound', function() {
            const initialDiff = vardiff.getInitialDiff(0.0001);
            assert.strictEqual(initialDiff, 0.001); // Clamped to minDiff
        });

        it('should clamp port difficulty to max bound', function() {
            const initialDiff = vardiff.getInitialDiff(5000);
            assert.strictEqual(initialDiff, 1000); // Clamped to maxDiff
        });

        it('should return geometric mean when no port diff provided', function() {
            const initialDiff = vardiff.getInitialDiff();
            
            assert(initialDiff >= vardiff.minDiff, 'Initial diff should be >= minDiff');
            assert(initialDiff <= vardiff.maxDiff, 'Initial diff should be <= maxDiff');
            
            // Should be close to sqrt(0.001 * 1000) = 1
            const geometricMean = Math.sqrt(0.001 * 1000);
            assert(Math.abs(initialDiff - geometricMean) < 0.1, 
                `Initial diff ${initialDiff} should be close to geometric mean ${geometricMean}`);
        });

        it('should handle null port diff', function() {
            const initialDiff = vardiff.getInitialDiff(null);
            assert(initialDiff > 0, 'Should return positive initial diff');
        });

        it('should handle undefined port diff', function() {
            const initialDiff = vardiff.getInitialDiff(undefined);
            assert(initialDiff > 0, 'Should return positive initial diff');
        });
    });

    describe('Difficulty Rounding', function() {
        let vardiff;

        beforeEach(function() {
            vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.000001,
                maxDiff: 1000000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });
        });

        it('should round large difficulties to 6 significant figures', function() {
            const rounded = vardiff._roundDifficulty(123.456789012);
            assert.strictEqual(rounded, 123.457);
        });

        it('should round small difficulties to 6 decimal places', function() {
            const rounded = vardiff._roundDifficulty(0.000123456789);
            assert.strictEqual(rounded, 0.000123);
        });
    });

    describe('Timestamp Consistency', function() {
        it('should work correctly with millisecond timestamps from Date.now()', function() {
            const vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });

            const client = new MockClient();
            client.diff = 1;
            
            // Use actual Date.now() timestamps
            const now = Date.now();
            client.lastDifficultyUpdate = now - 120000; // 120s ago
            
            // Simulate 10 shares at 5 second intervals
            for (let i = 0; i < 10; i++) {
                client._shareTimestamps.push(now - (9 - i) * 5000);
            }

            const result = vardiff.checkAdjustment(client);
            
            // Should detect shares are too fast (5s vs 15s target)
            assert.notStrictEqual(result, null, 'Should detect need for adjustment');
            assert.strictEqual(result.reason, 'shares too fast');
            assert(result.avgInterval > 4 && result.avgInterval < 6, 
                `Average interval ${result.avgInterval}s should be ~5s`);
        });
    });
});
