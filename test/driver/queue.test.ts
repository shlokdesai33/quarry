import { describe, expect, it } from 'vitest';
import { Queue } from '../../src/driver/queue.js';

const contents = <T>(queue: Queue<T>) =>
	Array.from({ length: queue.length }, (_, i) => queue.at(i));

describe('Queue', () => {
	it('is first in, first out', () => {
		const queue = new Queue<number>();
		expect(queue.shift()).toBeUndefined();
		for (let i = 0; i < 5; i++) queue.push(i);
		expect(queue.length).toBe(5);
		expect(queue.at(0)).toBe(0);
		expect(queue.at(4)).toBe(4);
		expect(queue.at(5)).toBeUndefined();
		expect(queue.at(-1)).toBeUndefined();
		expect(queue.shift()).toBe(0);
		expect(queue.shift()).toBe(1);
		queue.push(5);
		expect(contents(queue)).toEqual([2, 3, 4, 5]);
	});

	it('finds, removes and drains items behind the front', () => {
		const queue = new Queue<string>();
		for (const item of ['a', 'b', 'c', 'd']) queue.push(item);
		queue.shift();
		expect(queue.indexOf('c')).toBe(1);
		expect(queue.indexOf('a')).toBe(-1);
		expect(queue.find((item) => item > 'b')).toBe('c');
		queue.removeAt(1);
		queue.removeAt(7);
		expect(contents(queue)).toEqual(['b', 'd']);
		expect(queue.drain()).toEqual(['b', 'd']);
		expect(queue.length).toBe(0);
		queue.push('e');
		expect(contents(queue)).toEqual(['e']);
	});

	it('stays in order when it is never empty', () => {
		const queue = new Queue<number>();
		let next = 0;
		let expected = 0;
		for (let i = 0; i < 3; i++) queue.push(next++);
		// past the point where it moves its items down
		for (let i = 0; i < 5000; i++) {
			queue.push(next++);
			expect(queue.shift()).toBe(expected++);
			expect(queue.length).toBe(3);
		}
		expect(contents(queue)).toEqual([expected, expected + 1, expected + 2]);
	});
});
