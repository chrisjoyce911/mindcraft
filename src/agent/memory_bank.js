// MemoryBank: the remembered places ({name: [x, y, z]}), such as home_chest
// and last_death_position. onChange (optional) is called after every change,
// so the agent saves them at once (memory.json "places", see history.js) and
// a restart after a crash keeps them.
export class MemoryBank {
	constructor(onChange = null) {
		this.memory = {};
		this.onChange = onChange;
	}

	_changed() {
		try { this.onChange?.(this.memory); } catch (err) { console.warn('[memory] saving places failed:', err?.message || err); }
	}

	rememberPlace(name, x, y, z) {
		this.memory[name] = [x, y, z];
		this._changed();
	}

	recallPlace(name) {
		return this.memory[name];
	}

	forgetPlace(name) {
		if (!(name in this.memory)) return;
		delete this.memory[name];
		this._changed();
	}

	getJson() {
		return this.memory
	}

	// loadJson takes saved places; anything that isn't {name: [x, y, z]} with
	// finite numbers is left out.
	loadJson(json) {
		const out = {};
		for (const [name, p] of Object.entries(json && typeof json === 'object' ? json : {})) {
			if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) out[name] = [...p];
		}
		this.memory = out;
	}

	getKeys() {
		return Object.keys(this.memory).join(', ')
	}
}
