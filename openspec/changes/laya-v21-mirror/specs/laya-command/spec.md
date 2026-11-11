# laya-command (delta)

## ADDED Requirements

### Requirement: Command prompt v2.1 with animal drops
With `prompt: "v2.1"` the command task SHALL ask laya-go's v2.1 questions (v2's with the drop items) and resolve
items as laya-go's `ResolveFor(v2.1)`. A gather of an item with a hunt mob SHALL hunt that mob until the count.

#### Scenario: gather beef
- **WHEN** a player says "get me 5 beef" and the model answers gather, beef, 5
- **THEN** andy runs `!hunt("cow", "beef", 5)`
