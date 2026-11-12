// The blocks andy never breaks: his base stations (6.2: a reused mine's walk dug through the furnace and table
// placed on its entrance, and the base was gone). Pure; core/body adds them to every pathfinder Movements, and
// actuators/ore digBlock refuses them. The pathfinder already keeps chests by itself.

export const KEEP_BLOCKS = ['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'trapped_chest', 'barrel'] as const;

/** keepBlock: a block name the bot never digs (KEEP_BLOCKS and every bed). */
export const keepBlock = (name: string): boolean => (KEEP_BLOCKS as readonly string[]).includes(name) || name.endsWith('_bed');

/** keepStations adds the kept blocks of a registry to a Movements' blocksCantBreak. */
export function keepStations<M extends { blocksCantBreak: Set<number> }>(m: M, registry: { blocksArray: readonly { id: number; name: string }[] }): M {
    for (const b of registry.blocksArray) if (keepBlock(b.name)) m.blocksCantBreak.add(b.id);
    return m;
}
