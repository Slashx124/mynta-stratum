'use strict';

/**
 * Unit tests for Server class
 * Tests TCP server functionality and client management
 */

const assert = require('assert');
const net = require('net');
const EventEmitter = require('events');

// Set up mock logger
const { MockLogger, delay, waitFor, getRandomPort } = require('../test-utils');
const mockLogger = new MockLogger();
global.stratumLogger = mockLogger;

// Mock dependencies
class MockStratum extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
    }
}

const Server = require('../../libs/class.Server');

describe('Server', function() {
    this.timeout(15000);

    let server;
    let stratum;
    let testPort;

    beforeEach(async function() {
        mockLogger.clear();
        testPort = await getRandomPort();
        
        stratum = new MockStratum({
            host: '127.0.0.1',
            port: { number: testPort, diff: 1 }
        });

        server = new Server({ stratum: stratum });
    });

    afterEach(function(done) {
        this.timeout(10000);
        let cleaned = false;
        
        const finish = () => {
            if (!cleaned) {
                cleaned = true;
                done();
            }
        };
        
        if (server && server._isStarted && !server._isStopped) {
            server.stop(finish);
            // Fallback timeout in case stop hangs
            setTimeout(finish, 3000);
        } else {
            finish();
        }
    });

    describe('constructor', function() {
        it('should create server instance', function() {
            assert.ok(server);
            assert.strictEqual(server.clientCount, 0);
        });

        it('should throw on null stratum', function() {
            assert.throws(() => {
                new Server({ stratum: null });
            });
        });
    });

    describe('start', function() {
        it('should start listening on specified port', function(done) {
            server.start((err) => {
                assert.ifError(err);
                
                // Try to connect
                const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                    client.destroy();
                    done();
                });

                client.on('error', done);
            });
        });

        it('should fail to start twice', function(done) {
            server.start((err) => {
                assert.ifError(err);
                
                server.start((err2) => {
                    assert.ok(err2);
                    assert.ok(err2.message.includes('already started'));
                    done();
                });
            });
        });

        it('should fail on port already in use', function(done) {
            // First, start a server on the port
            const existingServer = net.createServer();
            existingServer.listen(testPort, '127.0.0.1', () => {
                server.start((err) => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 'EADDRINUSE');
                    existingServer.close(done);
                });
            });
        });

        it('should emit server error event on port conflict', function(done) {
            const existingServer = net.createServer();
            existingServer.listen(testPort, '127.0.0.1', () => {
                let eventEmitted = false;
                server.on(Server.EVENT_SERVER_ERROR, (ev) => {
                    eventEmitted = true;
                    assert.ok(ev.error);
                    assert.strictEqual(ev.error.code, 'EADDRINUSE');
                });

                server.start(() => {
                    setTimeout(() => {
                        assert.ok(eventEmitted);
                        existingServer.close(done);
                    }, 100);
                });
            });
        });
    });

    describe('stop', function() {
        it('should stop cleanly', function(done) {
            this.timeout(10000);
            let finished = false;
            
            const finish = (err) => {
                if (!finished) {
                    finished = true;
                    done(err);
                }
            };
            
            server.start((err) => {
                if (err) return finish(err);
                
                server.stop(() => {
                    // Try to connect - should fail
                    const client = net.createConnection({ port: testPort, host: '127.0.0.1' });
                    client.setTimeout(1000);
                    
                    client.on('error', (err) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'ECONNREFUSED');
                        finish();
                    });
                    client.on('connect', () => {
                        client.destroy();
                        finish(new Error('Should not have connected'));
                    });
                    client.on('timeout', () => {
                        client.destroy();
                        finish(new Error('Connection timed out'));
                    });
                });
            });
        });

        it('should disconnect all clients on stop', function(done) {
            this.timeout(10000);
            let finished = false;
            
            const finish = (err) => {
                if (!finished) {
                    finished = true;
                    done(err);
                }
            };
            
            server.start((err) => {
                if (err) return finish(err);

                // Connect a client
                const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                    // Wait for client to be registered
                    setTimeout(() => {
                        assert.strictEqual(server.clientCount, 1);
                        
                        let disconnected = false;
                        client.on('close', () => {
                            disconnected = true;
                        });

                        server.stop(() => {
                            setTimeout(() => {
                                assert.strictEqual(server.clientCount, 0);
                                assert.ok(disconnected);
                                finish();
                            }, 100);
                        });
                    }, 100);
                });

                client.on('error', () => {}); // Ignore errors on forced disconnect
            });
        });

        it('should be idempotent', function(done) {
            this.timeout(10000);
            let finished = false;
            
            const finish = () => {
                if (!finished) {
                    finished = true;
                    done();
                }
            };
            
            server.start((err) => {
                if (err) return finish();
                
                let stopCount = 0;
                server.stop(() => {
                    stopCount++;
                    if (stopCount === 1) {
                        server.stop(() => {
                            stopCount++;
                            finish();
                        });
                    }
                });
            });
        });
    });

    describe('client connections', function() {
        it('should emit EVENT_CLIENT_CONNECT on new connection', function(done) {
            server.start((err) => {
                assert.ifError(err);

                server.once(Server.EVENT_CLIENT_CONNECT, (ev) => {
                    assert.ok(ev.client);
                    assert.ok(ev.client.subscriptionIdHex);
                    done();
                });

                net.createConnection({ port: testPort, host: '127.0.0.1' });
            });
        });

        it('should increment client count on connection', function(done) {
            server.start((err) => {
                assert.ifError(err);

                assert.strictEqual(server.clientCount, 0);

                const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                    setTimeout(() => {
                        assert.strictEqual(server.clientCount, 1);
                        client.destroy();
                        done();
                    }, 100);
                });
            });
        });

        it('should decrement client count on disconnect', function(done) {
            server.start((err) => {
                assert.ifError(err);

                const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                    setTimeout(() => {
                        assert.strictEqual(server.clientCount, 1);
                        client.destroy();
                        
                        setTimeout(() => {
                            assert.strictEqual(server.clientCount, 0);
                            done();
                        }, 100);
                    }, 100);
                });
            });
        });

        it('should emit EVENT_CLIENT_DISCONNECT', function(done) {
            server.start((err) => {
                assert.ifError(err);

                server.once(Server.EVENT_CLIENT_DISCONNECT, (ev) => {
                    assert.ok(ev.client);
                    done();
                });

                const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                    setTimeout(() => {
                        client.destroy();
                    }, 50);
                });
            });
        });

        it('should handle multiple concurrent connections', function(done) {
            server.start((err) => {
                assert.ifError(err);

                const clients = [];
                let connectCount = 0;

                for (let i = 0; i < 5; i++) {
                    const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                        connectCount++;
                        if (connectCount === 5) {
                            setTimeout(() => {
                                assert.strictEqual(server.clientCount, 5);
                                clients.forEach(c => c.destroy());
                                done();
                            }, 100);
                        }
                    });
                    clients.push(client);
                }
            });
        });

        it('should assign unique extraNonce to each client', function(done) {
            server.start((err) => {
                assert.ifError(err);

                const extraNonces = new Set();
                let connectCount = 0;

                server.on(Server.EVENT_CLIENT_CONNECT, (ev) => {
                    extraNonces.add(ev.client.extraNonce1Hex);
                    connectCount++;
                    
                    if (connectCount === 3) {
                        assert.strictEqual(extraNonces.size, 3); // All unique
                        done();
                    }
                });

                for (let i = 0; i < 3; i++) {
                    net.createConnection({ port: testPort, host: '127.0.0.1' });
                }
            });
        });
    });

    describe('forEachClient', function() {
        it('should iterate over all clients', function(done) {
            server.start((err) => {
                assert.ifError(err);

                let connectCount = 0;
                const clients = [];

                for (let i = 0; i < 3; i++) {
                    const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                        connectCount++;
                        if (connectCount === 3) {
                            setTimeout(() => {
                                const visited = [];
                                server.forEachClient((client) => {
                                    visited.push(client.subscriptionIdHex);
                                });

                                assert.strictEqual(visited.length, 3);
                                clients.forEach(c => c.destroy());
                                done();
                            }, 100);
                        }
                    });
                    clients.push(client);
                }
            });
        });
    });

    describe('event constants', function() {
        it('should have all required event constants', function() {
            assert.strictEqual(typeof Server.EVENT_CLIENT_CONNECT, 'string');
            assert.strictEqual(typeof Server.EVENT_CLIENT_SUBSCRIBE, 'string');
            assert.strictEqual(typeof Server.EVENT_CLIENT_AUTHORIZE, 'string');
            assert.strictEqual(typeof Server.EVENT_CLIENT_DISCONNECT, 'string');
            assert.strictEqual(typeof Server.EVENT_CLIENT_TIMEOUT, 'string');
            assert.strictEqual(typeof Server.EVENT_CLIENT_SOCKET_ERROR, 'string');
            assert.strictEqual(typeof Server.EVENT_CLIENT_MALFORMED_MESSAGE, 'string');
            assert.strictEqual(typeof Server.EVENT_CLIENT_UNKNOWN_STRATUM_METHOD, 'string');
            assert.strictEqual(typeof Server.EVENT_SERVER_ERROR, 'string');
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
