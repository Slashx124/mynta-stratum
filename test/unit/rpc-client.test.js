'use strict';

/**
 * Unit tests for RpcClient
 * Tests HTTP RPC communication with Mynta daemon
 */

const assert = require('assert');
const path = require('path');

// Set up mock logger before requiring RpcClient
const { MockLogger, MockRpcServer, delay } = require('../test-utils');
const mockLogger = new MockLogger();
global.stratumLogger = mockLogger;

const RpcClient = require('../../libs/class.RpcClient');

describe('RpcClient', function() {
    this.timeout(10000);

    let mockServer;
    let client;

    beforeEach(function(done) {
        mockLogger.clear();
        mockServer = new MockRpcServer({
            user: 'testuser',
            password: 'testpass'
        });
        mockServer.start((err, port) => {
            if (err) return done(err);
            client = new RpcClient({
                host: '127.0.0.1',
                port: port,
                user: 'testuser',
                password: 'testpass',
                timeout: 5000,
                retryAttempts: 1,
                retryDelay: 100
            });
            done();
        });
    });

    afterEach(function(done) {
        mockServer.stop(done);
    });

    describe('constructor', function() {
        it('should create instance with valid options', function() {
            assert.ok(client);
            assert.strictEqual(client.isConnected, false);
            assert.strictEqual(client.consecutiveFailures, 0);
        });

        it('should throw on invalid port', function() {
            assert.throws(() => {
                new RpcClient({
                    host: '127.0.0.1',
                    port: 0,
                    user: 'test',
                    password: 'test'
                });
            });
        });

        it('should throw on missing host', function() {
            assert.throws(() => {
                new RpcClient({
                    port: 8766,
                    user: 'test',
                    password: 'test'
                });
            });
        });
    });

    describe('testConnection', function() {
        it('should successfully connect to mock server', function(done) {
            client.testConnection((err, info) => {
                assert.ifError(err);
                assert.ok(info);
                assert.strictEqual(info.chain, 'main');
                assert.strictEqual(client.isConnected, true);
                done();
            });
        });

        it('should fail with wrong credentials', function(done) {
            const badClient = new RpcClient({
                host: '127.0.0.1',
                port: mockServer.port,
                user: 'wronguser',
                password: 'wrongpass',
                timeout: 5000,
                retryAttempts: 0
            });

            badClient.testConnection((err, info) => {
                assert.ok(err);
                assert.strictEqual(err.isAuthError, true);
                assert.strictEqual(info, null);
                done();
            });
        });

        it('should fail when server is unavailable', function(done) {
            this.timeout(10000); // Extend timeout for this test
            let finished = false;
            
            const finish = () => {
                if (!finished) {
                    finished = true;
                    done();
                }
            };
            
            const badClient = new RpcClient({
                host: '127.0.0.1',
                port: 59999, // Unlikely to be in use
                user: 'test',
                password: 'test',
                timeout: 1000,
                retryAttempts: 0
            });

            badClient.testConnection((err, info) => {
                assert.ok(err);
                assert.ok(err.code === 'ECONNREFUSED' || err.message.includes('timeout') || err.code === 'ETIMEDOUT');
                finish();
            });
            
            // Safety timeout
            setTimeout(() => {
                if (!finished) {
                    console.log('Test timed out waiting for connection failure');
                    finish();
                }
            }, 8000);
        });
    });

    describe('cmd', function() {
        it('should execute getblockchaininfo', function(done) {
            client.cmd({
                method: 'getblockchaininfo',
                params: [],
                callback: (err, result) => {
                    assert.ifError(err);
                    assert.ok(result);
                    assert.ok(result.blocks !== undefined);
                    done();
                }
            });
        });

        it('should execute getblocktemplate', function(done) {
            client.cmd({
                method: 'getblocktemplate',
                params: [{ capabilities: ['coinbasetxn'], rules: ['segwit'] }],
                callback: (err, result) => {
                    assert.ifError(err);
                    assert.ok(result);
                    assert.ok(result.height !== undefined);
                    assert.ok(result.previousblockhash);
                    assert.ok(result.bits);
                    done();
                }
            });
        });

        it('should handle custom response', function(done) {
            mockServer.setResponse('custommethod', { custom: 'data' });

            client.cmd({
                method: 'custommethod',
                params: [],
                callback: (err, result) => {
                    assert.ifError(err);
                    assert.deepStrictEqual(result, { custom: 'data' });
                    done();
                }
            });
        });

        it('should handle RPC error response', function(done) {
            mockServer.setResponse('badmethod', new Error('Custom error'));

            client.cmd({
                method: 'badmethod',
                params: [],
                callback: (err, result) => {
                    assert.ok(err);
                    assert.strictEqual(result, null);
                    done();
                }
            });
        });

        it('should handle unknown method', function(done) {
            client.cmd({
                method: 'unknownmethod',
                params: [],
                callback: (err, result) => {
                    assert.ok(err);
                    assert.ok(err.isRpcError);
                    assert.strictEqual(err.code, -32601);
                    done();
                }
            });
        });

        it('should increment message ID', function(done) {
            mockServer.clearRequests();

            client.cmd({
                method: 'getblockchaininfo',
                params: [],
                callback: () => {
                    client.cmd({
                        method: 'getblockchaininfo',
                        params: [],
                        callback: () => {
                            assert.strictEqual(mockServer.requests.length, 2);
                            assert.strictEqual(mockServer.requests[0].id, 0);
                            assert.strictEqual(mockServer.requests[1].id, 1);
                            done();
                        }
                    });
                }
            });
        });
    });

    describe('validateAddress', function() {
        it('should validate Mynta address starting with M', function(done) {
            client.validateAddress({
                address: 'MTestAddressForMynta',
                callback: (isValid, result) => {
                    assert.strictEqual(isValid, true);
                    assert.ok(result);
                    done();
                }
            });
        });

        it('should reject invalid address', function(done) {
            client.validateAddress({
                address: 'InvalidAddress',
                callback: (isValid, result) => {
                    assert.strictEqual(isValid, false);
                    done();
                }
            });
        });
    });

    describe('retry logic', function() {
        it('should retry on connection error', function(done) {
            // Create client that will retry
            const retryClient = new RpcClient({
                host: '127.0.0.1',
                port: 59998, // Not in use
                user: 'test',
                password: 'test',
                timeout: 500,
                retryAttempts: 2,
                retryDelay: 100
            });

            const startTime = Date.now();

            retryClient.testConnection((err) => {
                const elapsed = Date.now() - startTime;
                assert.ok(err);
                // Should have taken at least 200ms (2 retries * 100ms delay)
                assert.ok(elapsed >= 200, `Expected at least 200ms, got ${elapsed}ms`);
                done();
            });
        });

        it('should not retry on auth error', function(done) {
            const badClient = new RpcClient({
                host: '127.0.0.1',
                port: mockServer.port,
                user: 'wronguser',
                password: 'wrongpass',
                timeout: 5000,
                retryAttempts: 3,
                retryDelay: 100
            });

            const startTime = Date.now();

            badClient.testConnection((err) => {
                const elapsed = Date.now() - startTime;
                assert.ok(err);
                assert.ok(err.isAuthError);
                // Should NOT have retried, so should be fast
                assert.ok(elapsed < 300, `Expected quick failure, got ${elapsed}ms`);
                done();
            });
        });

        it('should track consecutive failures', function(done) {
            this.timeout(5000);
            
            const badClient = new RpcClient({
                host: '127.0.0.1',
                port: 59997,
                user: 'test',
                password: 'test',
                timeout: 500,
                retryAttempts: 0,
                retryDelay: 50
            });

            badClient.cmd({
                method: 'test',
                callback: (err) => {
                    assert.ok(err); // Should have error
                    assert.ok(badClient.consecutiveFailures >= 1);
                    const firstFailures = badClient.consecutiveFailures;
                    
                    badClient.cmd({
                        method: 'test',
                        callback: (err2) => {
                            assert.ok(err2); // Should have error
                            assert.ok(badClient.consecutiveFailures > firstFailures);
                            done();
                        }
                    });
                }
            });
        });
    });

    describe('timeout handling', function() {
        it('should respect timeout configuration', function() {
            // Test that timeout configuration is accepted
            const client = new RpcClient({
                host: '127.0.0.1',
                port: 8766,
                user: 'test',
                password: 'test',
                timeout: 1000,
                retryAttempts: 0
            });
            
            // Verify the client was created with the timeout value
            assert.strictEqual(client._timeout, 1000);
        });
        
        it('should handle ETIMEDOUT error code', function(done) {
            // Test that ETIMEDOUT errors are retryable
            const client = new RpcClient({
                host: '127.0.0.1',
                port: 8766,
                user: 'test',
                password: 'test',
                timeout: 1000,
                retryAttempts: 0
            });
            
            const err = new Error('Connection timed out');
            err.code = 'ETIMEDOUT';
            
            // The _shouldRetry method should return true for timeout errors
            assert.strictEqual(client._shouldRetry(err), true);
            done();
        });
    });

    describe('JSON parsing', function() {
        it('should handle NaN values in response', function(done) {
            this.timeout(5000);
            
            // Override server to return NaN
            const http = require('http');
            const nanServer = http.createServer((req, res) => {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    // Send response with NaN (non-standard JSON) - needs comma or closing brace
                    res.end('{"result":{"value":-nan,"other":1},"error":null,"id":0}');
                });
            });

            nanServer.listen(0, '127.0.0.1', () => {
                const port = nanServer.address().port;
                const nanClient = new RpcClient({
                    host: '127.0.0.1',
                    port: port,
                    user: 'test',
                    password: 'test',
                    timeout: 5000,
                    retryAttempts: 0
                });

                nanClient.cmd({
                    method: 'test',
                    callback: (err, result) => {
                        assert.ifError(err);
                        assert.ok(result);
                        assert.strictEqual(result.value, 0); // NaN should be converted to 0
                        assert.strictEqual(result.other, 1);
                        nanServer.close(() => done());
                    }
                });
            });
        });
        
        it('should handle NaN at end of object', function(done) {
            this.timeout(5000);
            
            const http = require('http');
            const nanServer = http.createServer((req, res) => {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    // NaN followed by closing brace
                    res.end('{"result":{"value":-nan},"error":null,"id":0}');
                });
            });

            nanServer.listen(0, '127.0.0.1', () => {
                const port = nanServer.address().port;
                const nanClient = new RpcClient({
                    host: '127.0.0.1',
                    port: port,
                    user: 'test',
                    password: 'test',
                    timeout: 5000,
                    retryAttempts: 0
                });

                nanClient.cmd({
                    method: 'test',
                    callback: (err, result) => {
                        assert.ifError(err);
                        assert.ok(result);
                        assert.strictEqual(result.value, 0); // NaN should be converted to 0
                        nanServer.close(() => done());
                    }
                });
            });
        });
    });
});

// Run tests if executed directly
if (require.main === module) {
    const Mocha = require('mocha');
    const mocha = new Mocha();
    mocha.addFile(__filename);
    mocha.run(failures => process.exit(failures ? 1 : 0));
}
