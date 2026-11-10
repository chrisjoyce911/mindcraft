import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubMemory } from '../src/agent/memory_scrub.js';

test('scrubMemory drops requests and jobs, keeps lasting facts', () => {
    const live = 'Andy remembers being named andy, responds to "hello world" with "Hello world, I\'m andy." User chrisjoyce911 frequently requests coal via "get me coal" or "give me coal," indicating a need for coal. Recently, chrisjoyce911 asked to mine 9 iron, but the action was interrupted due to a defense prompt; Andy responded with "!stop" and then sent 9 coal to chrisjoyce911. Andy now knows to craft torches before mining in dark areas.';
    const out = scrubMemory(live);
    assert.doesNotMatch(out, /coal|9 iron/);
    assert.match(out, /Hello world, I'm andy/);
    assert.match(out, /craft torches before mining in dark areas/, 'a tip, not a request');
    assert.equal(scrubMemory(''), '');
    assert.equal(scrubMemory(null), null);
});
