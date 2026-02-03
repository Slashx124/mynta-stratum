'use strict';

/**
 * Unit tests for VarDiff class
 * Tests variable difficulty adjustment logic
 */

const assert = require('assert');

// Mock logger
const { MockLogger } = require('../test-utils');
const mockLogger = new MockLogger();
global.stratumLogger = mockLogger;

const VarDiff = require('../../libs/class.VarDiff');

// Mock Client for testing
class MockClient {
    constructor() {
        this.diff = 1;
        this.shareTimestamps = [];
        this.lastDifficultyUpdate = Date.now();
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
                variancePercent: 30
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
            client.shareTimestamps = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];

            const result = disabledVardiff.checkAdjustment(client);
            assert.strictEqual(result, null);
        });

        it('should return null with insufficient shares', function() {
            const client = new MockClient();
            client.shareTimestamps = [1000, 2000, 3000]; // Only 3 shares

            const result = vardiff.checkAdjustment(client);
            assert.strictEqual(result, null);
        });

        it('should return null before retarget time', function() {
            const client = new MockClient();
            const now = Date.now();
            
            // Last update was 30 seconds ago (less than 90s retarget time)
            client.lastDifficultyUpdate = now - 30000;
            
            // Add 10 shares spaced 5 seconds apart (fast)
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 5000);
            }

            const result = vardiff.checkAdjustment(client);
            assert.strictEqual(result, null);
        });

        it('should increase difficulty when shares too fast', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            // Last update was 120 seconds ago
            client.lastDifficultyUpdate = now - 120000;
            
            // Add 10 shares spaced 5 seconds apart (much faster than 15s target)
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 5000);
            }

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert.strictEqual(result.shouldAdjust, true);
            assert.strictEqual(result.newDiff, 2); // Should double
            assert.strictEqual(result.reason, 'shares too fast');
        });

        it('should decrease difficulty when shares too slow', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            // Last update was 120 seconds ago
            client.lastDifficultyUpdate = now - 120000;
            
            // Add 10 shares spaced 30 seconds apart (much slower than 15s target)
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 30000);
            }

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert.strictEqual(result.shouldAdjust, true);
            assert.strictEqual(result.newDiff, 0.5); // Should halve
            assert.strictEqual(result.reason, 'shares too slow');
        });

        it('should respect minimum difficulty', function() {
            const client = new MockClient();
            client.diff = 0.002; // Very low difficulty
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Very slow shares
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 60000);
            }

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert.strictEqual(result.newDiff, 0.001); // Clamped to minDiff
        });

        it('should respect maximum difficulty', function() {
            const client = new MockClient();
            client.diff = 500; // High difficulty
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Very fast shares
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 1000);
            }

            const result = vardiff.checkAdjustment(client);
            
            assert.notStrictEqual(result, null);
            assert.strictEqual(result.newDiff, 1000); // Clamped to maxDiff
        });

        it('should not adjust within variance', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            client.lastDifficultyUpdate = now - 120000;
            
            // Shares at 14s intervals (within 30% of 15s target)
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 14000);
            }

            const result = vardiff.checkAdjustment(client);
            
            // Should be null because 14s is within variance of 15s ± 30%
            assert.strictEqual(result, null);
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
            client.shareTimestamps = [1000]; // Only 1 share

            const hashRate = vardiff.estimateHashRate(client);
            assert.strictEqual(hashRate, 0);
        });

        it('should calculate hash rate correctly', function() {
            const client = new MockClient();
            client.diff = 1;
            const now = Date.now();
            
            // 10 shares over 90 seconds = 9 shares in 90 seconds
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 10000);
            }

            const hashRate = vardiff.estimateHashRate(client);
            
            // Should be positive
            assert(hashRate > 0, 'Hash rate should be positive');
            
            // Should be reasonable (difficulty 1 over 90 seconds)
            // hashRate = (9 * 1 * 2^32) / 90
            const expected = (9 * Math.pow(2, 32)) / 90;
            const tolerance = expected * 0.01; // 1% tolerance
            
            assert(Math.abs(hashRate - expected) < tolerance, 
                `Hash rate ${hashRate} should be close to ${expected}`);
        });

        it('should scale with difficulty', function() {
            const client = new MockClient();
            client.diff = 10; // 10x difficulty
            const now = Date.now();
            
            // Same timing as previous test
            for (let i = 0; i < 10; i++) {
                client.shareTimestamps.push(now - (10 - i) * 10000);
            }

            const hashRate = vardiff.estimateHashRate(client);
            
            // Should be ~10x the previous test
            const expected = (9 * 10 * Math.pow(2, 32)) / 90;
            const tolerance = expected * 0.01;
            
            assert(Math.abs(hashRate - expected) < tolerance,
                `Hash rate ${hashRate} should be close to ${expected}`);
        });
    });

    describe('getInitialDiff', function() {
        it('should return value within bounds', function() {
            const vardiff = new VarDiff({
                enabled: true,
                minDiff: 0.001,
                maxDiff: 1000,
                targetShareTime: 15,
                retargetTime: 90,
                variancePercent: 30
            });

            const initialDiff = vardiff.getInitialDiff();
            
            assert(initialDiff >= vardiff.minDiff, 'Initial diff should be >= minDiff');
            assert(initialDiff <= vardiff.maxDiff, 'Initial diff should be <= maxDiff');
        });
    });
});
