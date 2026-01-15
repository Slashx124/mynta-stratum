# Mynta Stratum Proxy

A standalone stratum proxy for solo mining **Mynta (MNT)** using any KawPoW-compatible GPU miner.

## Features

- 🚀 **Standalone executable** - No Node.js installation required
- ⚡ **KawPoW algorithm** - Full share validation with native hasher
- 🔧 **Easy configuration** - Simple JSON config file
- 🖥️ **Works with all major miners** - T-Rex, GMiner, NBMiner, TeamRedMiner, etc.

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
        "password": "YOUR_RPC_PASSWORD"
    },
    "jobUpdateInterval": 55,
    "blockPollIntervalMs": 250
}
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `coinbaseAddress` | Your Mynta wallet address (must start with 'M') |
| `blockBrand` | Text embedded in mined blocks |
| `host` | Interface to listen on (`0.0.0.0` for all) |
| `port.number` | Stratum port for miners (default: 3333) |
| `port.diff` | Starting difficulty |
| `rpc.*` | Mynta daemon RPC connection settings |

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
| Invalid address | Use a legacy address starting with 'M' |
| Miner can't connect | Check Windows Firewall for port 3333 |
| Low shares | Increase `port.diff` based on your hashrate |

## License

MIT License - Based on [kawpow-stratum](https://github.com/LabyrinthCore/kawpow-stratum) by Labyrinth Core developers.

## Credits

- Original stratum implementation by [MintPond](https://github.com/MintPond)
- KawPoW hasher by [Labyrinth Core](https://github.com/LabyrinthCore)
- Modified for Mynta compatibility
