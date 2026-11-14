# laya-jobs (delta)

## ADDED Requirements

### Requirement: Collecting skips blocks it failed on
Within one `collectBlock` call, a block whose collect fails for any reason other than an interrupt or a full
inventory SHALL NOT be chosen again. Only collected blocks SHALL count toward the requested number, and the call
SHALL end after 5 failed blocks in a row or when no untried candidate is left.

#### Scenario: one unreachable log beside a good tree
- **WHEN** `collectBlock(bot, "log", 4)` runs, the nearest log fails with a path timeout, and a reachable tree with 5 logs stands 10 blocks away
- **THEN** the failed log is tried once, the 4 logs come from the reachable tree, and the call returns true

#### Scenario: nothing reachable
- **WHEN** every candidate log fails to collect
- **THEN** the call ends after at most 5 failures, not after `num` retries of the same block

#### Scenario: interrupted
- **WHEN** an interrupt stops the collect mid-path
- **THEN** the call stops at once and the block is not marked failed

### Requirement: Log gathering skips logs out of reach
When collecting logs, a log SHALL be a candidate only if, walking down its column through its own trunk, air, leaves
and plants, the first solid ground block (not leaves, not liquid) is at most 6 blocks below it. An unloaded block
counts as reachable. Gathering `log` SHALL consider every overworld log type.

#### Scenario: trunk with its bottom cut
- **WHEN** an oak log hangs 8 blocks above the grass with only air under it, and a birch tree stands 12 blocks away
- **THEN** `!layaGather("log", 4)` never paths to the oak log and gathers 4 birch logs

#### Scenario: a standing tree
- **WHEN** a normal 5-log oak trunk stands on grass
- **THEN** all 5 logs are candidates (the grass under the trunk is at most 5 below each)

### Requirement: Short log gathers say they ran out of reach
A log gather that ends short because no reachable log is left SHALL report that reason in chat with the count
gathered.

#### Scenario: only high logs left
- **WHEN** `!layaGather("log", 12)` gets 5 logs and the only logs left within 64 blocks are out of reach
- **THEN** andy says "I couldn't get 12 log: no more logs I can reach here (I have 5)."
