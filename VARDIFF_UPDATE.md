# Stratum Server Variable Difficulty Update

## Overview

The Mynta stratum server has been updated to support **variable difficulty (vardiff)** and enhanced **multi-miner share handling**. These improvements ensure the stratum server can efficiently handle multiple miners of varying hash rates simultaneously, similar to how professional mining pools operate.

## Latest Improvements (v1.2.3)

The vardiff system has undergone a comprehensive audit and the following issues have been fixed:

### Bug Fixes
- **Timestamp Unit Consistency**: Fixed critical bug where `mu.now()` (seconds) was mixed with `Date.now()` (milliseconds), causing incorrect retarget timing
- **Hash Rate Calculation**: Fixed 1000x error in hash rate estimation due to unit mismatch
- **Array Memory Leak**: Changed from `slice()` to `shift()` for share timestamp management to prevent array reassignment issues

### New Features
- **Proportional Difficulty Adjustment**: Instead of doubling/halving, difficulty now scales proportionally based on actual share intervals (configurable)
- **Configurable Adjustment Factor**: Custom multiplier for non-proportional mode
- **Monotonic Timestamp Protection**: Protects against system time changes (NTP sync, manual adjustment)
- **Initial Difficulty from Port Config**: Now properly uses the port's configured difficulty
- **Authorization Check**: Difficulty updates are only sent to authorized clients
- **Improved Precision**: Difficulty values are rounded to avoid floating point noise

## What Changed

### 1. Variable Difficulty System (`class.VarDiff.js`)

A new `VarDiff` class has been added to manage per-miner difficulty adjustments:

- **Automatic difficulty adjustment** based on each miner's actual hash rate
- **Proportional or fixed-factor adjustment modes**
- **Configurable parameters** for fine-tuning behavior
- **Hash rate estimation** using share submission patterns
- **Bounded difficulty** to prevent extreme values
- **Clamped adjustments** (max 4x change per retarget)

### 2. Enhanced Client Tracking (`class.Client.js`)

The `Client` class now tracks additional metrics for vardiff:

- `shareTimestamps` - Array of recent share submission times (last 100)
- `lastDifficultyUpdate` - Timestamp of last difficulty adjustment
- `diff` setter - Allows per-client difficulty changes
- `recordShare()` - Method to record share submissions

### 3. Stratum Integration (`class.Stratum.js`)

The `Stratum` class now:

- Creates and manages a `VarDiff` instance
- Checks for difficulty adjustments after each valid share
- Logs difficulty changes with reasoning
- Estimates and logs miner hash rates
- Sends difficulty updates to clients via the server

### 4. Server Communication (`class.Server.js`)

The `Server` class now includes:

- `sendDifficultyUpdate()` - Sends `mining.set_difficulty` notifications to clients when their difficulty changes

### 5. Configuration (`config.example.json`)

New configuration options:

```json
{
    "vardiff": {
        "enabled": true,              // Enable/disable vardiff
        "minDiff": 0.001,             // Minimum allowed difficulty
        "maxDiff": 1000000,           // Maximum allowed difficulty
        "targetShareTime": 15,        // Target seconds between shares
        "retargetTime": 90,           // Minimum seconds between adjustments
        "variancePercent": 30,        // Acceptable variance (+/- 30%)
        "useProportional": true,      // Use proportional adjustment (recommended)
        "adjustmentFactor": 2         // Factor for non-proportional mode
    }
}
```

#### Configuration Options Explained

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable vardiff entirely |
| `minDiff` | `0.001` | Minimum allowed difficulty |
| `maxDiff` | `1000000` | Maximum allowed difficulty |
| `targetShareTime` | `15` | Target seconds between share submissions |
| `retargetTime` | `90` | Minimum seconds between difficulty adjustments |
| `variancePercent` | `30` | Acceptable variance before adjustment (+/- 30%) |
| `useProportional` | `true` | Scale difficulty proportionally based on actual vs target time |
| `adjustmentFactor` | `2` | Multiplier for fixed-factor mode (double/half) |

## How It Works

### Initial Connection

1. Miner connects to stratum server
2. Receives starting difficulty (from `port.diff` config or vardiff min)
3. Begins mining with this difficulty

### Share Submission & Vardiff

1. Miner submits a share
2. Share is validated (same validation as before)
3. If valid, timestamp is recorded in client's `shareTimestamps` array
4. After 10+ shares, vardiff calculation begins:
   - Calculate average time between last 10 shares
   - Compare to target time (e.g., 15 seconds)
   - If shares too fast (< target - variance): **double difficulty**
   - If shares too slow (> target + variance): **halve difficulty**
   - Clamp to min/max bounds
5. If adjustment needed and retarget time elapsed:
   - Update client's difficulty
   - Send `mining.set_difficulty` notification
   - Log the change with reasoning

### Multi-Miner Support

Each client has:
- **Unique `extranonce1`** - Ensures unique coinbase transactions
- **Independent difficulty** - Tracked per-client, not globally
- **Separate share tracking** - Duplicate detection uses `nonce:extranonce1` key
- **Individual vardiff state** - Each miner's difficulty adjusts independently

This means:
- ✅ A high-hashrate GPU miner can have difficulty 1000
- ✅ A low-hashrate CPU miner can have difficulty 0.01
- ✅ Both mine simultaneously without conflicts
- ✅ No duplicate share false positives between miners

## Technical Details

### Share Duplicate Detection

The `Job.registerShare()` method creates a unique key per share:

```javascript
const submitId = `${nonceHex}:${extraNonce1Hex}`;
```

This ensures:
- Two miners can submit the same nonce without conflict (different extranonce1)
- Each miner cannot submit the same nonce twice (duplicate detection)
- Proper multi-miner support even when mining the same job

### Difficulty Adjustment Algorithm

#### Proportional Mode (Recommended, Default)

```
IF shares submitted >= 10 AND time since last adjustment >= retargetTime:
    avgInterval = average of last 10 share intervals (milliseconds / 1000)
    targetTime = configured target (default 15s)
    variance = configured variance (default 30%)
    
    IF avgInterval < targetTime * (1 - variance):
        ratio = targetTime / avgInterval  (e.g., 15s / 5s = 3)
        clampedRatio = clamp(ratio, 0.25, 4)  // Max 4x change
        newDiff = currentDiff * clampedRatio
        reason = "shares too fast"
    ELSE IF avgInterval > targetTime * (1 + variance):
        ratio = targetTime / avgInterval  (e.g., 15s / 30s = 0.5)
        clampedRatio = clamp(ratio, 0.25, 4)
        newDiff = currentDiff * clampedRatio
        reason = "shares too slow"
    
    newDiff = clamp(newDiff, minDiff, maxDiff)
    newDiff = roundToPrecision(newDiff)  // Avoid floating point noise
    
    IF change >= 1%:
        Send mining.set_difficulty to client
        Update client.diff
        Update client.lastDifficultyUpdate (milliseconds)
```

#### Fixed Factor Mode (Legacy)

```
IF useProportional == false:
    IF shares too fast:
        newDiff = currentDiff * adjustmentFactor
    ELSE IF shares too slow:
        newDiff = currentDiff / adjustmentFactor
```

#### Key Improvements

1. **Proportional Scaling**: If a miner is submitting shares 3x faster than target, difficulty increases 3x (not just 2x)
2. **Clamped Adjustments**: Maximum 4x change per adjustment prevents wild oscillations
3. **Small Change Filtering**: Changes < 1% are ignored to prevent noise
4. **Precision Rounding**: Avoids floating point artifacts

### Hash Rate Estimation

```
hashRate = (totalDifficulty * 2^32) / timeSpanSeconds

Where:
- totalDifficulty = client.diff * (shareCount - 1)
- timeSpanSeconds = (lastTimestamp - firstTimestamp) / 1000
- 2^32 = constant for hash difficulty conversion (4,294,967,296)
```

**Note**: All timestamps are stored in milliseconds (`Date.now()`) for consistency and precision.

### Timestamp Handling

The system uses consistent millisecond timestamps throughout:

```javascript
// Share recording (class.Client.js)
const now = Date.now();                          // Milliseconds
const currentMonotonic = process.hrtime.bigint(); // Monotonic protection

// Retarget check (class.VarDiff.js)  
const timeSinceLastUpdate = Date.now() - client.lastDifficultyUpdate;
if (timeSinceLastUpdate < retargetTime * 1000) { ... }

// Interval calculation
const avgIntervalMs = totalInterval / (count - 1);
const avgIntervalSeconds = avgIntervalMs / 1000;
```

**Monotonic Time Protection**: The system tracks `process.hrtime.bigint()` to detect system clock changes (NTP sync, manual adjustment) and rejects share timestamps that violate monotonic ordering.

## Configuration Examples

### Solo Mining (Single Miner)

For solo mining with one GPU, you may prefer fixed difficulty:

```json
{
    "port": {
        "number": 3333,
        "diff": 1
    },
    "vardiff": {
        "enabled": false
    }
}
```

### Pool Mining (Multiple Miners)

For a pool with various miners:

```json
{
    "port": {
        "number": 3333,
        "diff": 0.01
    },
    "vardiff": {
        "enabled": true,
        "minDiff": 0.001,
        "maxDiff": 1000000,
        "targetShareTime": 15,
        "retargetTime": 90,
        "variancePercent": 30
    }
}
```

### High-Power Farm

For a farm with only high-hashrate miners:

```json
{
    "port": {
        "number": 3333,
        "diff": 100
    },
    "vardiff": {
        "enabled": true,
        "minDiff": 10,
        "maxDiff": 100000,
        "targetShareTime": 30,
        "retargetTime": 120,
        "variancePercent": 20
    }
}
```

## Comparison with Production Pools

The implementation follows industry-standard practices used by major mining pools:

### ✅ Implemented Features

| Feature | Status | Notes |
|---------|--------|-------|
| Per-client difficulty | ✅ | Each miner has independent difficulty |
| Automatic adjustment | ✅ | Based on submission rate |
| Share deduplication | ✅ | Uses nonce + extranonce1 |
| Hash rate estimation | ✅ | Calculated from share intervals |
| Configurable bounds | ✅ | Min/max difficulty limits |
| Retarget delay | ✅ | Prevents rapid oscillation |
| Variance threshold | ✅ | Prevents minor adjustments |

### 🔄 Optional Enhancements (Not Required for Solo Mining)

- **Database tracking** - Log shares to database (useful for pool stats)
- **Payout system** - Calculate and distribute rewards (pool only)
- **Worker stats API** - Real-time hashrate graphs (pool dashboard)
- **Ban system** - Detect and ban cheaters (pool protection)

## Testing Recommendations

1. **Single Miner Test**
   - Connect one miner
   - Verify shares are accepted
   - Watch difficulty adjust over time
   - Check logs for vardiff messages

2. **Multi-Miner Test**
   - Connect 2+ miners with different hash rates
   - Verify each gets independent difficulty
   - Confirm no duplicate share errors between miners
   - Check that low-hashrate miner gets lower difficulty

3. **Stress Test**
   - Connect 10+ miners simultaneously
   - Verify all miners remain connected
   - Check for any share validation errors
   - Monitor CPU/memory usage

## Backward Compatibility

- **Default behavior**: Vardiff is enabled by default
- **Config compatibility**: Old configs without `vardiff` section will use defaults
- **Fixed difficulty**: Set `vardiff.enabled: false` to use traditional fixed difficulty
- **API compatibility**: No changes to stratum protocol implementation

## Logging

When debug mode is enabled, you'll see:

```
[INFO] Worker authorized: MADDRESS.worker1 from 192.168.1.100
[INFO] Valid share from MADDRESS.worker1 - Diff: 0.0100
[INFO] Vardiff adjustment for MADDRESS.worker1: 0.010000 -> 0.020000 (shares too fast, avg interval: 8.23s)
[DEBUG] MADDRESS.worker1 estimated hashrate: 45.67 MH/s
[INFO] Valid share from MADDRESS.worker1 - Diff: 0.0200
```

## Summary

The updated stratum server now:
- ✅ Supports multiple miners concurrently
- ✅ Automatically adjusts difficulty per miner
- ✅ Correctly tracks shares with no duplicates
- ✅ Estimates hash rates accurately (fixed unit conversion)
- ✅ Maintains compatibility with all KawPoW miners
- ✅ Follows professional pool standards
- ✅ Uses consistent millisecond timestamps throughout
- ✅ Proportional difficulty adjustment for smoother transitions
- ✅ Monotonic time protection against clock changes
- ✅ Proper memory management (no array reassignment leaks)
- ✅ Authorization checks before sending difficulty updates

This brings the solo stratum server to pool-grade quality while remaining simple to configure and deploy.

## Version History

| Version | Changes |
|---------|---------|
| 1.2.2 | Initial vardiff implementation |
| 1.2.3 | Bug fixes: timestamp consistency, hash rate calculation, memory management. New features: proportional adjustment, monotonic time protection, configurable multipliers |
