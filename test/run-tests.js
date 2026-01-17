#!/usr/bin/env node
'use strict';

/**
 * Test runner for mynta-stratum
 * Runs all tests or specific test suites
 */

const path = require('path');
const fs = require('fs');

// Check if Mocha is available
let Mocha;
try {
    Mocha = require('mocha');
} catch (err) {
    console.error('Mocha is not installed. Please run: npm install --save-dev mocha');
    process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const verbose = args.includes('--verbose') || args.includes('-v');
const runUnit = args.includes('--unit') || args.includes('-u') || args.length === 0;
const runIntegration = args.includes('--integration') || args.includes('-i') || args.length === 0;
const runWindows = args.includes('--windows') || args.includes('-w') || args.length === 0;
const runAll = args.includes('--all') || args.includes('-a');

if (showHelp) {
    console.log(`
Mynta Stratum Proxy Test Runner

Usage: node test/run-tests.js [options]

Options:
  -h, --help         Show this help message
  -v, --verbose      Show verbose output
  -u, --unit         Run unit tests only
  -i, --integration  Run integration tests only
  -w, --windows      Run Windows compatibility tests only
  -a, --all          Run all tests (default if no options)

Examples:
  node test/run-tests.js              # Run all tests
  node test/run-tests.js --unit       # Run unit tests only
  node test/run-tests.js -v           # Run all tests with verbose output
  npm test                            # Run all tests via npm
`);
    process.exit(0);
}

// Configure Mocha
const mocha = new Mocha({
    timeout: 30000,
    reporter: verbose ? 'spec' : 'spec',
    bail: false
});

// Test directory
const testDir = __dirname;

// Find test files
function addTestFiles(dir, pattern) {
    const fullDir = path.join(testDir, dir);
    
    if (!fs.existsSync(fullDir)) {
        console.log(`Test directory not found: ${dir}`);
        return 0;
    }

    let count = 0;
    const files = fs.readdirSync(fullDir);
    
    for (const file of files) {
        if (file.endsWith('.test.js')) {
            mocha.addFile(path.join(fullDir, file));
            count++;
            if (verbose) {
                console.log(`  Added: ${dir}/${file}`);
            }
        }
    }
    
    return count;
}

console.log('\n=== Mynta Stratum Proxy Test Suite ===\n');
console.log(`Platform: ${process.platform} (${process.arch})`);
console.log(`Node.js: ${process.version}`);
console.log('');

let totalFiles = 0;

if (runAll || runUnit) {
    console.log('Loading unit tests...');
    totalFiles += addTestFiles('unit', '*.test.js');
}

if (runAll || runIntegration) {
    console.log('Loading integration tests...');
    totalFiles += addTestFiles('integration', '*.test.js');
}

if (runAll || runWindows) {
    console.log('Loading Windows compatibility tests...');
    totalFiles += addTestFiles('windows', '*.test.js');
}

console.log(`\nRunning ${totalFiles} test file(s)...\n`);

// Run tests
mocha.run(failures => {
    console.log('\n=== Test Run Complete ===\n');
    
    if (failures > 0) {
        console.log(`${failures} test(s) failed.`);
        process.exit(1);
    } else {
        console.log('All tests passed!');
        process.exit(0);
    }
});
