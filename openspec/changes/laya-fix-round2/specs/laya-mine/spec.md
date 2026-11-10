# laya-mine (delta)

## ADDED Requirements

### Requirement: The staircase goes deep before branching
The mine plan SHALL staircase down to at least `surface_depth` (10) blocks below the entrance and to the ore's
best level (coal 45, copper 48, iron 16, lapis 0, gold -16, redstone -58, diamond -58), clamped to the ore's
band, before its first grid level.

#### Scenario: coal from the surface
- **WHEN** a coal mine starts at Y 70
- **THEN** the first grid level is at Y 45, not 70
