# laya-home-chest (delta)

## ADDED Requirements

### Requirement: Name sign versus purpose sign
A sign bearing only the bot's name SHALL still make its chest the home chest; a sign with the bot's name followed by a known purpose SHALL make a purpose chest and SHALL NOT make the home chest.

#### Scenario: Purpose sign not adopted as home
- **WHEN** no home chest is saved and the only sign is "andy produce" on a chest
- **THEN** the chest becomes a produce chest and no home chest is saved
