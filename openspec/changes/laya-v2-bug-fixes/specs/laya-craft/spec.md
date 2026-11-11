# laya-craft (delta)

## ADDED Requirements

### Requirement: The inventory settles after a craft
After a craft, the bot SHALL wait (up to 3 s) until its inventory shows the crafted items before the next step reads the situation.

#### Scenario: planks x3
- **WHEN** the bot crafts planks three times from three logs
- **THEN** the next state shows the planks crafted and no logs
