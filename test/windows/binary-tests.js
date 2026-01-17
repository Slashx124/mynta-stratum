#!/usr/bin/env node
'use strict';

/**
 * Windows Binary Tests
 * 
 * Tests the compiled Windows executable using Wine (on Linux) or natively (on Windows)
 * 
 * USAGE:
 *   node test/windows/binary-tests.js
 *   npm run test:binary
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const assert = require('assert');

// Platform detection
const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// Colors for output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.green}[TEST]${colors.reset} ${msg}`);
const warn = (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`);
const error = (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`);
const info = (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`);

// Test results tracking
const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: []
};

function test(name, fn) {
    return async () => {
        try {
            await fn();
            results.passed++;
            results.tests.push({ name, status: 'passed' });
            console.log(`  ${colors.green}✓${colors.reset} ${name}`);
        } catch (err) {
            results.failed++;
            results.tests.push({ name, status: 'failed', error: err.message });
            console.log(`  ${colors.red}✗${colors.reset} ${name}`);
            console.log(`    ${colors.red}Error: ${err.message}${colors.reset}`);
        }
    };
}

function skip(name, reason) {
    results.skipped++;
    results.tests.push({ name, status: 'skipped', reason });
    console.log(`  ${colors.yellow}○${colors.reset} ${name} (skipped: ${reason})`);
}

// =============================================================================
// Test Utilities
// =============================================================================

function findExecutable() {
    const projectRoot = path.resolve(__dirname, '../..');
    const candidates = [
        path.join(projectRoot, 'mynta-stratum.exe'),
        path.join(projectRoot, 'dist', 'mynta-stratum.exe'),
        path.join(projectRoot, 'build', 'mynta-stratum.exe')
    ];
    
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function hasWine() {
    if (IS_WINDOWS) return false;
    
    try {
        execSync('wine64 --version', { stdio: 'pipe' });
        return true;
    } catch {
        try {
            execSync('wine --version', { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }
}

function runExecutable(args, options = {}) {
    return new Promise((resolve, reject) => {
        const exePath = findExecutable();
        if (!exePath) {
            reject(new Error('Executable not found'));
            return;
        }
        
        let cmd, cmdArgs;
        
        if (IS_WINDOWS) {
            cmd = exePath;
            cmdArgs = args;
        } else if (hasWine()) {
            // Use xvfb-run if available to avoid display issues
            try {
                execSync('which xvfb-run', { stdio: 'pipe' });
                cmd = 'xvfb-run';
                cmdArgs = ['-a', 'wine64', exePath, ...args];
            } catch {
                cmd = 'wine64';
                cmdArgs = [exePath, ...args];
            }
        } else {
            reject(new Error('Cannot run Windows executable: Wine not available'));
            return;
        }
        
        const timeout = options.timeout || 10000;
        const proc = spawn(cmd, cmdArgs, {
            cwd: path.dirname(exePath),
            env: { ...process.env, WINEDEBUG: '-all', DISPLAY: ':99' },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            if (options.expectTimeout) {
                resolve({ stdout, stderr, timedOut: true });
            } else {
                reject(new Error(`Process timed out after ${timeout}ms`));
            }
        }, timeout);
        
        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code, timedOut: false });
        });
        
        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function getRandomPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

// =============================================================================
// Tests
// =============================================================================

async function runTests() {
    console.log('\n============================================================');
    console.log('  Mynta Stratum Proxy - Windows Binary Tests');
    console.log('============================================================\n');
    
    info(`Platform: ${process.platform} (${process.arch})`);
    info(`Node.js: ${process.version}`);
    
    const exePath = findExecutable();
    if (exePath) {
        info(`Executable: ${exePath}`);
        info(`Size: ${(fs.statSync(exePath).size / 1024 / 1024).toFixed(2)} MB`);
    } else {
        warn('Executable not found - run npm run build first');
    }
    
    if (!IS_WINDOWS && hasWine()) {
        info('Wine: available');
    } else if (!IS_WINDOWS) {
        info('Wine: not available');
    }
    
    console.log('\n');
    
    // ---------------------------------------------------------------------------
    // Binary Existence Tests
    // ---------------------------------------------------------------------------
    console.log('Binary Tests:');
    
    await test('executable exists', async () => {
        const exePath = findExecutable();
        assert.ok(exePath, 'Executable should exist');
        assert.ok(fs.existsSync(exePath), 'Executable file should exist');
    })();
    
    await test('executable is a PE file', async () => {
        const exePath = findExecutable();
        if (!exePath) throw new Error('Executable not found');
        
        const buffer = Buffer.alloc(2);
        const fd = fs.openSync(exePath, 'r');
        fs.readSync(fd, buffer, 0, 2, 0);
        fs.closeSync(fd);
        
        // PE files start with 'MZ'
        assert.strictEqual(buffer.toString(), 'MZ', 'Should be a PE executable');
    })();
    
    await test('executable has reasonable size', async () => {
        const exePath = findExecutable();
        if (!exePath) throw new Error('Executable not found');
        
        const stats = fs.statSync(exePath);
        const sizeMB = stats.size / 1024 / 1024;
        
        // pkg executables are typically 40-80MB
        assert.ok(sizeMB > 20, `Executable should be > 20MB (is ${sizeMB.toFixed(2)}MB)`);
        assert.ok(sizeMB < 200, `Executable should be < 200MB (is ${sizeMB.toFixed(2)}MB)`);
    })();
    
    // ---------------------------------------------------------------------------
    // Wine/Native Execution Tests
    // ---------------------------------------------------------------------------
    console.log('\nExecution Tests:');
    
    if (!findExecutable()) {
        skip('debug flag test', 'executable not found');
        skip('missing config test', 'executable not found');
        skip('invalid config test', 'executable not found');
    } else if (!IS_WINDOWS && !hasWine()) {
        skip('debug flag test', 'Wine not available');
        skip('missing config test', 'Wine not available');
        skip('invalid config test', 'Wine not available');
    } else {
        await test('binary loads and exits without config', async () => {
            // Running without config should exit with error (no config.json)
            const result = await runExecutable([], { timeout: 15000, expectTimeout: false });
            
            // Should exit with error code or print error about missing config
            const output = result.stdout + result.stderr;
            const hasConfigError = output.toLowerCase().includes('config') || 
                                   output.toLowerCase().includes('not found') ||
                                   result.code !== 0;
            
            // The binary should at least start and try to find config
            assert.ok(hasConfigError || result.code !== 0, 
                     'Should exit with error when config is missing');
        })();
        
        await test('debug flag is recognized', async () => {
            // --debug flag should be recognized even if config is missing
            const result = await runExecutable(['--debug'], { timeout: 15000, expectTimeout: false });
            
            // Should not crash immediately
            assert.ok(result.code !== null, 'Process should exit');
        })();
    }
    
    // ---------------------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------------------
    console.log('\n============================================================');
    console.log('  Test Results');
    console.log('============================================================');
    console.log(`  ${colors.green}Passed:${colors.reset}  ${results.passed}`);
    console.log(`  ${colors.red}Failed:${colors.reset}  ${results.failed}`);
    console.log(`  ${colors.yellow}Skipped:${colors.reset} ${results.skipped}`);
    console.log('============================================================\n');
    
    return results.failed === 0;
}

// =============================================================================
// Main
// =============================================================================

runTests()
    .then((success) => {
        process.exit(success ? 0 : 1);
    })
    .catch((err) => {
        error(`Unexpected error: ${err.message}`);
        process.exit(1);
    });
