# laya-director (delta)

## ADDED Requirements

### Requirement: Defend a player (director v1.2)
The director state SHALL include `Player <name> attacked <yes|no> by <mob|none> <dist>` for the nearest player within
24 blocks who took damage from a mob in the last 5 seconds. When a player is attacked the answer SHALL be `defend`,
targeting that mob, unless the bot itself should flee (health ≤ 6 with a hostile within 8) or eat (food ≤ 6). The rule
SHALL be identical in Mindcraft and laya-go `games/director` (golden test).

#### Scenario: zombie hits the player
- **WHEN** a zombie hits chrisjoyce911 12 blocks from the bot while it is mining as a chore, health 18
- **THEN** the director answers `defend`, the bot goes to the player and attacks the zombie, then resumes the chore
