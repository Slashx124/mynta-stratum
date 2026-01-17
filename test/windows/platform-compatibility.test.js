'use strict';

/**
 * Windows and cross-platform compatibility tests
 * Tests platform-specific behaviors and edge cases
 */

const assert = require('assert');
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { 
    MockLogger, 
    MockRpcServer,
    MockMinerClient,
    createTestConfig,
    delay,
    waitFor,
    getRandomPort,
    IS_WINDOWS,
    IS_LINUX,
    IS_MACOS
} = require('../test-utils');

const mockLogger = new MockLogger();
global.stratumLogger = mockLogger;

describe('Platform Compatibility', function() {
    this.timeout(30000);

    describe('Platform Detection', function() {
        it('should correctly identify platform', function() {
            const platform = process.platform;
            console.log(`Running on platform: ${platform}`);
            console.log(`IS_WINDOWS: ${IS_WINDOWS}`);
            console.log(`IS_LINUX: ${IS_LINUX}`);
            console.log(`IS_MACOS: ${IS_MACOS}`);
            
            assert.ok(
                (IS_WINDOWS && platform === 'win32') ||
                (IS_LINUX && platform === 'linux') ||
                (IS_MACOS && platform === 'darwin') ||
                (!IS_WINDOWS && !IS_LINUX && !IS_MACOS)
            );
        });

        it('should report correct architecture', function() {
            const arch = process.arch;
            console.log(`Architecture: ${arch}`);
            assert.ok(['x64', 'ia32', 'arm64', 'arm'].includes(arch));
        });

        it('should report Node.js version', function() {
            const version = process.version;
            console.log(`Node.js version: ${version}`);
            
            // Parse version to ensure it's >= 18
            const major = parseInt(version.slice(1).split('.')[0], 10);
            assert.ok(major >= 18, `Node.js version ${version} is less than required 18.0.0`);
        });
    });

    describe('Path Handling', function() {
        it('should handle path.join correctly', function() {
            const joined = path.join('dir1', 'dir2', 'file.txt');
            
            if (IS_WINDOWS) {
                assert.ok(joined.includes('\\'));
            } else {
                assert.ok(joined.includes('/'));
            }
        });

        it('should handle path.resolve correctly', function() {
            const resolved = path.resolve('test');
            
            if (IS_WINDOWS) {
                // Windows paths start with drive letter
                assert.ok(/^[A-Z]:/i.test(resolved) || resolved.startsWith('\\\\'));
            } else {
                // Unix paths start with /
                assert.ok(resolved.startsWith('/'));
            }
        });

        it('should handle __dirname correctly', function() {
            assert.ok(__dirname);
            assert.ok(typeof __dirname === 'string');
            
            // Should be an absolute path
            if (IS_WINDOWS) {
                assert.ok(/^[A-Z]:/i.test(__dirname) || __dirname.startsWith('\\\\'));
            } else {
                assert.ok(__dirname.startsWith('/'));
            }
        });

        it('should normalize paths consistently', function() {
            const messyPath = 'dir1//dir2/../dir3/./file.txt';
            const normalized = path.normalize(messyPath);
            
            // Should not contain .. or .
            assert.ok(!normalized.includes('..'));
            assert.ok(!normalized.includes('./'));
            assert.ok(!normalized.includes('//'));
        });
    });

    describe('Network Socket Behavior', function() {
        let testServer;
        let testPort;

        beforeEach(async function() {
            testPort = await getRandomPort();
            testServer = net.createServer();
            await new Promise(resolve => testServer.listen(testPort, '127.0.0.1', resolve));
        });

        afterEach(function(done) {
            if (testServer) {
                testServer.close(done);
            } else {
                done();
            }
        });

        it('should handle TCP connection on localhost', function(done) {
            const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                assert.ok(true, 'Connected successfully');
                client.destroy();
                done();
            });

            client.on('error', done);
        });

        it('should handle connection refused error', function(done) {
            const client = net.createConnection({ port: 59999, host: '127.0.0.1' });
            
            client.on('error', (err) => {
                assert.strictEqual(err.code, 'ECONNREFUSED');
                done();
            });
        });

        it('should handle socket timeout', function(done) {
            const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                client.setTimeout(100);
            });

            client.on('timeout', () => {
                client.destroy();
                done();
            });
        });

        it('should handle connection reset gracefully', function(done) {
            let connectedClient;

            testServer.once('connection', (socket) => {
                // Forcefully destroy the connection
                setTimeout(() => {
                    socket.destroy();
                }, 50);
            });

            const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                connectedClient = client;
            });

            client.on('close', () => {
                done();
            });

            client.on('error', () => {
                // ECONNRESET is expected
                done();
            });
        });

        it('should handle half-open connections', function(done) {
            testServer.once('connection', (socket) => {
                socket.on('data', (data) => {
                    // Echo back
                    socket.write(data);
                });

                socket.on('end', () => {
                    // Client sent FIN, send our FIN
                    socket.end();
                });
            });

            const client = net.createConnection({ port: testPort, host: '127.0.0.1' }, () => {
                client.write('test');
            });

            client.on('data', (data) => {
                assert.strictEqual(data.toString(), 'test');
                client.end(); // Graceful close
            });

            client.on('close', () => {
                done();
            });
        });
    });

    describe('Buffer Handling', function() {
        it('should handle buffer allocation', function() {
            const buf = Buffer.alloc(1024);
            assert.strictEqual(buf.length, 1024);
            assert.ok(buf.every(b => b === 0));
        });

        it('should handle buffer from hex', function() {
            const hex = 'deadbeef';
            const buf = Buffer.from(hex, 'hex');
            assert.strictEqual(buf.toString('hex'), hex);
        });

        it('should handle buffer concatenation', function() {
            const buf1 = Buffer.from([0x01, 0x02]);
            const buf2 = Buffer.from([0x03, 0x04]);
            const combined = Buffer.concat([buf1, buf2]);
            
            assert.strictEqual(combined.length, 4);
            assert.deepStrictEqual([...combined], [0x01, 0x02, 0x03, 0x04]);
        });

        it('should handle large buffer operations', function() {
            const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
            assert.strictEqual(largeBuffer.length, 10 * 1024 * 1024);
            
            // Write some data
            largeBuffer.write('test', 0);
            assert.strictEqual(largeBuffer.toString('utf8', 0, 4), 'test');
        });

        it('should handle buffer endianness', function() {
            const buf = Buffer.alloc(4);
            
            // Little endian
            buf.writeUInt32LE(0x12345678, 0);
            assert.deepStrictEqual([...buf], [0x78, 0x56, 0x34, 0x12]);
            
            // Big endian
            buf.writeUInt32BE(0x12345678, 0);
            assert.deepStrictEqual([...buf], [0x12, 0x34, 0x56, 0x78]);
        });
    });

    describe('JSON Handling', function() {
        it('should handle standard JSON parsing', function() {
            const json = '{"method":"test","params":[1,2,3],"id":1}';
            const parsed = JSON.parse(json);
            
            assert.strictEqual(parsed.method, 'test');
            assert.deepStrictEqual(parsed.params, [1, 2, 3]);
            assert.strictEqual(parsed.id, 1);
        });

        it('should handle JSON stringification', function() {
            const obj = { method: 'test', params: [1, 2, 3], id: 1 };
            const json = JSON.stringify(obj);
            
            assert.ok(json.includes('"method":"test"'));
        });

        it('should handle special characters in JSON', function() {
            const obj = { 
                message: 'Test with unicode: 你好世界',
                newlines: 'line1\nline2',
                quotes: 'has "quotes"'
            };
            
            const json = JSON.stringify(obj);
            const reparsed = JSON.parse(json);
            
            assert.strictEqual(reparsed.message, obj.message);
            assert.strictEqual(reparsed.newlines, obj.newlines);
            assert.strictEqual(reparsed.quotes, obj.quotes);
        });

        it('should handle BigInt-like values', function() {
            // Note: JSON doesn't support BigInt natively
            const largeNumber = '123456789012345678901234567890';
            const obj = { value: largeNumber };
            
            const json = JSON.stringify(obj);
            const parsed = JSON.parse(json);
            
            assert.strictEqual(parsed.value, largeNumber);
        });
    });

    describe('Process Handling', function() {
        it('should have process.platform', function() {
            assert.ok(process.platform);
            assert.ok(typeof process.platform === 'string');
        });

        it('should have process.arch', function() {
            assert.ok(process.arch);
            assert.ok(typeof process.arch === 'string');
        });

        it('should have process.cwd()', function() {
            const cwd = process.cwd();
            assert.ok(cwd);
            assert.ok(typeof cwd === 'string');
        });

        it('should have process.env', function() {
            assert.ok(process.env);
            assert.ok(typeof process.env === 'object');
        });

        it('should handle process.argv', function() {
            assert.ok(Array.isArray(process.argv));
            assert.ok(process.argv.length >= 2);
            
            // First arg is node executable
            assert.ok(process.argv[0].includes('node') || process.argv[0].includes('Node'));
        });
    });

    describe('Timer Behavior', function() {
        it('should handle setTimeout accurately', async function() {
            const start = Date.now();
            await new Promise(resolve => setTimeout(resolve, 100));
            const elapsed = Date.now() - start;
            
            // Allow some tolerance
            assert.ok(elapsed >= 90, `setTimeout was too fast: ${elapsed}ms`);
            assert.ok(elapsed < 200, `setTimeout was too slow: ${elapsed}ms`);
        });

        it('should handle setInterval', function(done) {
            let count = 0;
            const interval = setInterval(() => {
                count++;
                if (count >= 3) {
                    clearInterval(interval);
                    done();
                }
            }, 50);
        });

        it('should handle clearTimeout', function(done) {
            let called = false;
            const timer = setTimeout(() => {
                called = true;
            }, 50);

            clearTimeout(timer);

            setTimeout(() => {
                assert.strictEqual(called, false);
                done();
            }, 100);
        });
    });

    describe('File System Paths', function() {
        it('should handle temporary directory', function() {
            const tempDir = os.tmpdir();
            assert.ok(tempDir);
            assert.ok(fs.existsSync(tempDir));
        });

        it('should handle home directory', function() {
            const homeDir = os.homedir();
            assert.ok(homeDir);
            assert.ok(fs.existsSync(homeDir));
        });

        it('should handle current directory', function() {
            const cwd = process.cwd();
            assert.ok(cwd);
            assert.ok(fs.existsSync(cwd));
        });
    });

    describe('Error Handling', function() {
        it('should preserve error properties', function() {
            const error = new Error('Test error');
            error.code = 'TEST_ERROR';
            error.customProp = 'custom value';

            assert.strictEqual(error.message, 'Test error');
            assert.strictEqual(error.code, 'TEST_ERROR');
            assert.strictEqual(error.customProp, 'custom value');
            assert.ok(error.stack);
        });

        it('should handle Error.prototype.toJSON', function() {
            // This is added by the stratum proxy
            if (!Error.prototype.toJSON) {
                Error.prototype.toJSON = function() {
                    const jsonObj = {};
                    Object.getOwnPropertyNames(this).forEach(key => {
                        jsonObj[key] = this[key];
                    });
                    return jsonObj;
                };
            }

            const error = new Error('Test');
            error.code = 'TEST';
            
            const json = JSON.stringify(error);
            const parsed = JSON.parse(json);
            
            assert.strictEqual(parsed.message, 'Test');
            assert.strictEqual(parsed.code, 'TEST');
        });
    });
});

describe('Windows-Specific Tests', function() {
    this.timeout(30000);

    describe('Line Endings', function() {
        it('should handle CRLF in network data', function() {
            const data = 'line1\r\nline2\r\n';
            const lines = data.split(/\r?\n/).filter(l => l);
            
            assert.strictEqual(lines.length, 2);
            assert.strictEqual(lines[0], 'line1');
            assert.strictEqual(lines[1], 'line2');
        });

        it('should handle LF in network data', function() {
            const data = 'line1\nline2\n';
            const lines = data.split(/\r?\n/).filter(l => l);
            
            assert.strictEqual(lines.length, 2);
            assert.strictEqual(lines[0], 'line1');
            assert.strictEqual(lines[1], 'line2');
        });

        it('should handle mixed line endings', function() {
            const data = 'line1\r\nline2\nline3\r\n';
            const lines = data.split(/\r?\n/).filter(l => l);
            
            assert.strictEqual(lines.length, 3);
        });
    });

    describe('Windows Socket Errors', function() {
        it('should define common Windows socket error codes', function() {
            // These are the error codes that can occur on Windows
            const windowsErrors = [
                'ECONNREFUSED',
                'ECONNRESET',
                'ETIMEDOUT',
                'ENOTFOUND',
                'EPIPE'
            ];

            // All these should be valid error code strings
            windowsErrors.forEach(code => {
                assert.ok(typeof code === 'string');
            });
        });
    });

    describe('Signal Handling (informational)', function() {
        it('should identify available signals', function() {
            // Log available signals for diagnostics
            console.log('Platform signals:');
            
            if (IS_WINDOWS) {
                console.log('  - Windows: SIGINT is partially supported');
                console.log('  - Windows: SIGTERM may not work reliably');
                console.log('  - Windows: SIGKILL is not supported');
            } else {
                console.log('  - Unix: SIGINT, SIGTERM, SIGKILL all supported');
            }
            
            assert.ok(true);
        });
    });
});

describe('Native Module Compatibility', function() {
    this.timeout(30000);

    describe('KawPoW Hasher (if available)', function() {
        it('should attempt to load native hasher', function() {
            let hasher = null;
            let loadError = null;

            try {
                hasher = require('@mintpond/hasher-kawpow');
            } catch (err) {
                loadError = err;
            }

            if (hasher) {
                console.log('Native hasher loaded successfully');
                assert.ok(hasher.verify || hasher.hash);
            } else {
                console.log(`Native hasher not available: ${loadError.message}`);
                // This is expected if dependencies aren't installed
                assert.ok(true);
            }
        });
    });

    describe('sha3 Module', function() {
        it('should load sha3 module', function() {
            let sha3 = null;
            let loadError = null;

            try {
                sha3 = require('sha3');
            } catch (err) {
                loadError = err;
            }

            if (sha3) {
                console.log('sha3 module loaded successfully');
                
                // Test basic functionality
                const hash = new sha3.Keccak(256);
                hash.update('test');
                const result = hash.digest('hex');
                
                assert.strictEqual(result.length, 64);
            } else {
                console.log(`sha3 module not available: ${loadError.message}`);
                assert.ok(true);
            }
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
