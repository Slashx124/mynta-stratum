# Mynta Stratum Proxy

A standalone stratum proxy for solo mining **Mynta (MNT)** using any KawPoW-compatible GPU miner.

## Features

- **Standalone executable** - No Node.js installation required
- **KawPoW algorithm** - Full share validation with native hasher
- **Easy configuration** - Simple JSON config file
- **Works with all major miners** - T-Rex, GMiner, NBMiner, TeamRedMiner, etc.
- **Debug mode** - Detailed logging for troubleshooting
- **Resilient** - Auto-retry on RPC connection failures

## Quick Start

### Download Release

Download the latest release from the [Releases](https://github.com/MyntaProject/mynta-stratum/releases) page.

### Setup

1. **Start Mynta Core** - Run `mynta-qt.exe` or `myntad.exe` with RPC enabled
2. **Configure** - Edit `config.json` with your wallet address and RPC credentials
3. **Run** - Double-click `mynta-stratum.exe`
4. **Mine** - Point your miner to `stratum+tcp://127.0.0.1:3333`

## Configuration

Copy `config.example.json` to `config.json` and edit:

```json
{
    "coinbaseAddress": "YOUR_MYNTA_ADDRESS",
    "blockBrand": "Mynta Solo Miner",
    "host": "0.0.0.0",
    "port": {
        "number": 3333,
        "diff": 1
    },
    "rpc": {
        "host": "127.0.0.1",
        "port": 8766,
        "user": "myntarpc",
        "password": "YOUR_RPC_PASSWORD",
        "timeout": 30000,
        "retryAttempts": 3,
        "retryDelay": 5000
    },
    "jobUpdateInterval": 55,
    "blockPollIntervalMs": 250,
    "debug": false,
    "logFile": null
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `coinbaseAddress` | Your Mynta wallet address (must start with 'M') | Required |
| `blockBrand` | Text embedded in mined blocks | "Mynta Solo Miner" |
| `host` | Interface to listen on (`0.0.0.0` for all) | "0.0.0.0" |
| `port.number` | Stratum port for miners | 3333 |
| `port.diff` | Starting difficulty | 1 |
| `rpc.host` | Mynta daemon RPC host | "127.0.0.1" |
| `rpc.port` | Mynta daemon RPC port | 8766 |
| `rpc.user` | RPC username | Required |
| `rpc.password` | RPC password | Required |
| `rpc.timeout` | RPC request timeout in milliseconds | 30000 |
| `rpc.retryAttempts` | Number of RPC retry attempts | 3 |
| `rpc.retryDelay` | Delay between retries in milliseconds | 5000 |
| `jobUpdateInterval` | Seconds between job updates | 55 |
| `blockPollIntervalMs` | Block polling interval in milliseconds | 250 |
| `debug` | Enable debug logging | false |
| `logFile` | Path to log file (null = console only) | null |

## Debug Mode

If you're experiencing issues (crashes, connection problems, etc.), enable debug mode to get detailed logs:

### Via Command Line

```bash
# Enable debug mode
mynta-stratum.exe --debug

# Enable debug mode with log file
mynta-stratum.exe --debug --log=stratum.log

# Short form
mynta-stratum.exe -d
```

### Via Config File

```json
{
    "debug": true,
    "logFile": "stratum.log"
}
```

Debug mode provides:
- Detailed RPC request/response logging
- Client connection/disconnection events
- Share validation details
- Job broadcast information
- Error stack traces

**Important:** When reporting issues, please run with `--debug --log=stratum.log` and include the log file contents.

## Mynta Core Setup

Add these lines to your `mynta.conf`:

```ini
server=1
rpcuser=myntarpc
rpcpassword=YourSecurePasswordHere
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=8766
```

## Miner Examples

### T-Rex
```bash
t-rex.exe -a kawpow -o stratum+tcp://127.0.0.1:3333 -u YOUR_ADDRESS -p x
```

### GMiner
```bash
miner.exe --algo kawpow --server 127.0.0.1:3333 --user YOUR_ADDRESS
```

### NBMiner
```bash
nbminer.exe -a kawpow -o stratum+tcp://127.0.0.1:3333 -u YOUR_ADDRESS
```

### TeamRedMiner (AMD)
```bash
teamredminer.exe -a kawpow -o stratum+tcp://127.0.0.1:3333 -u YOUR_ADDRESS
```

## Building from Source

### Requirements
- Node.js 18+ (22 recommended)
- Windows Build Tools (for native modules)

### Build Steps

```bash
# Install dependencies
npm install

# Run directly
node start.js

# Run with debug mode
node start.js --debug

# Build standalone executable
npm install -g @yao-pkg/pkg
pkg . --targets node22-win-x64 --output mynta-stratum.exe
```

## Network Information

| Parameter | Value |
|-----------|-------|
| Algorithm | KawPoW |
| Block Time | ~60 seconds |
| Block Reward | 4,850 MNT |
| Dev Allocation | 3% (150 MNT) |
| Coinbase Maturity | 100 blocks |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot connect to RPC | Ensure Mynta Core is running with `server=1` |
| RPC authentication failed | Check `rpcuser`/`rpcpassword` in mynta.conf and config.json |
| Invalid address | Use a legacy address starting with 'M' |
| Miner can't connect | Check Windows Firewall for port 3333 |
| Low shares | Increase `port.diff` based on your hashrate |
| Port already in use | Another instance may be running, or change `port.number` |
| Crashes without error | Run with `--debug --log=stratum.log` and check the log |
| Connection refused | Verify Mynta daemon is fully synced and RPC is enabled |

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "RPC authentication failed" | Wrong credentials | Verify rpcuser/rpcpassword match mynta.conf |
| "Port XXXX is already in use" | Port conflict | Close other instance or change port |
| "ECONNREFUSED" | Daemon not running | Start myntad or mynta-qt first |
| "Failed to get block template" | Daemon still syncing | Wait for sync to complete |

## License

MIT License - Based on [kawpow-stratum](https://github.com/LabyrinthCore/kawpow-stratum) by Labyrinth Core developers.

## Credits

- Original stratum implementation by [MintPond](https://github.com/MintPond)
- KawPoW hasher by [Labyrinth Core](https://github.com/LabyrinthCore)
- Modified for Mynta compatibility
