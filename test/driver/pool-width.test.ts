import { describe, expect, it } from 'vitest';
import { Width, type WidthSlot } from '../../src/driver/pool.js';

/** Who completes the next query, among the first `active` connections, and how long one takes. */
interface Server {
	pick(tick: number, active: number): number;
	pace(active: number): number;
}

/**
 * Feeds `ticks` completions to a `Width` for a pool of `max` connections,
 * each with `depth` queries in flight and more waiting, lending as many
 * connections as the width allows. Returns the width after each one.
 */
function run(
	width: Width,
	clock: { now: number },
	max: number,
	ticks: number,
	server: Server,
	depth = 20,
	waiting = 100,
): number[] {
	const slots: { shared: number; lastDone: number }[] = Array.from(
		{ length: max },
		() => ({ shared: -1, lastDone: 0 }),
	);
	const map = new Map<number, WidthSlot>(slots.map((slot, i) => [i, slot]));
	const limits: number[] = [];
	for (let tick = 0; tick < ticks; tick++) {
		const active = Math.min(width.limit, max);
		for (const [i, slot] of slots.entries()) {
			if (i < active && slot.shared < 0) {
				width.start(
					slot,
					slots.every((other) => other.shared < 0),
				);
				slot.shared = depth;
			} else if (i >= active) slot.shared = -1;
		}
		const slot = slots[server.pick(tick, active)]!;
		width.demand();
		clock.now += server.pace(active);
		width.done(slot, depth * active - 1, waiting, active, map);
		limits.push(width.limit);
	}
	return limits;
}

/** `cpus` CPUs time-slicing the busy backends, `slice` completions at a time. */
const timeSliced = (cpus: number, slice = 200): Server => ({
	pick(tick, active) {
		const running = Math.min(cpus, active);
		const turn = Math.floor(tick / slice) * running;
		return (turn + (tick % running)) % active;
	},
	// the CPUs are the limit: the same rate however many connections
	pace: () => 0.004,
});

/**
 * No time-slicing, but every connection spends `blocked` of its time
 * behind a slow query. With callers waiting on each other (`closed`),
 * fewer connections queue more fast queries behind each slow one, so
 * completions slow down; with queries arriving at a steady rate, they
 * don't.
 */
const slowQueries = (
	max: number,
	closed: boolean,
	blocked = 0.5,
	period = 4000,
): Server => ({
	pick(tick, active) {
		const open: number[] = [];
		for (let i = 0; i < active; i++)
			if (((tick + (i * period) / max) % period) / period >= blocked)
				open.push(i);
		return open.length > 0 ? open[tick % open.length]! : tick % active;
	},
	pace: (active) => (closed ? (0.004 * max) / active : 0.004),
});

/** `server`, with the client paused for `ms` every `every` completions: a GC pause, or the process descheduled on a busy host. */
const pausing = (
	server: Server,
	every: number,
	ms: number,
	offset = 0,
): Server => {
	let completions = offset;
	return {
		pick: (tick, active) => server.pick(tick, active),
		pace: (active) =>
			server.pace(active) + (++completions % every === 0 ? ms : 0),
	};
};

const lowest = (values: number[]) =>
	values.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
const highest = (values: number[]) =>
	values.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
const median = (values: number[]) =>
	values.toSorted((a, b) => a - b)[values.length >> 1]!;

describe('Width', () => {
	it('narrows to what the server runs at once', () => {
		const clock = { now: 0 };
		const width = new Width(10, () => clock.now);
		const limits = run(width, clock, 10, 200_000, timeSliced(2));
		const late = limits.slice(100_000);
		expect(median(late)).toBe(2);
		expect(highest(late)).toBeLessThanOrEqual(3);
	});

	it.each(Array.from({ length: 8 }, (_, i) => i * 2500))(
		'narrows when the client pauses now and then (phase %i)',
		(offset) => {
			const clock = { now: 0 };
			const width = new Width(4, () => clock.now);
			// 20 ms off the CPU every 20,000 completions (80 ms of them)
			const limits = run(
				width,
				clock,
				4,
				200_000,
				pausing(timeSliced(1), 20_000, 20, offset),
			);
			expect(median(limits.slice(100_000))).toBeLessThanOrEqual(2);
		},
	);

	it('narrows a wide pool in one or two steps', () => {
		const clock = { now: 0 };
		const width = new Width(50, () => clock.now);
		const limits = run(width, clock, 50, 100_000, timeSliced(2, 600), 10);
		// the first narrowing comes after a few epochs, not one per connection
		expect(limits.findIndex((limit) => limit <= 3)).toBeLessThan(40_000);
		expect(median(limits.slice(50_000))).toBeLessThanOrEqual(3);
	});

	it.each([
		['callers waiting on each other', true],
		['queries arriving at a steady rate', false],
	])(
		'stays wide when slow queries, not the server, stall connections (%s)',
		(_, closed) => {
			const clock = { now: 0 };
			const width = new Width(10, () => clock.now);
			const limits = run(width, clock, 10, 300_000, slowQueries(10, closed));
			const late = limits.slice(100_000);
			// a narrowing is tried now and then, and undone
			expect(late.filter((limit) => limit === 10).length).toBeGreaterThan(
				late.length * 0.9,
			);
		},
	);

	it('widens back once the server has room', () => {
		const clock = { now: 0 };
		const width = new Width(10, () => clock.now);
		run(width, clock, 10, 150_000, timeSliced(2));
		expect(width.limit).toBeLessThanOrEqual(3);
		const limits = run(width, clock, 10, 300_000, timeSliced(Infinity));
		expect(limits.at(-1)).toBe(10);
	});

	it('narrows an oversized pool whose connections each carry a query or two, while completions come as fast', () => {
		const clock = { now: 0 };
		const width = new Width(50, () => clock.now);
		// each backend woken for a query costs the server: the more connections, the slower
		const wakeups: Server = {
			pick: (tick, active) => tick % active,
			pace: (active) => 0.001 * (1 + active / 10),
		};
		const limits = run(width, clock, 50, 150_000, wakeups, 1, 0);
		expect(median(limits.slice(100_000))).toBeLessThanOrEqual(4);
	});

	it('keeps an oversized pool wide when fewer connections complete fewer queries, or queries are slow', () => {
		for (const pace of [
			// every connection is needed: the queries wait on something else
			(active: number) => 0.04 / active,
			// slow queries: the wake-ups don't matter, so it doesn't try
			(active: number) => 1.5 * (1 + active / 10),
		]) {
			const clock = { now: 0 };
			const width = new Width(20, () => clock.now);
			const parallel: Server = { pick: (tick, active) => tick % active, pace };
			const limits = run(width, clock, 20, 150_000, parallel, 1, 0);
			const late = limits.slice(50_000);
			expect(late.filter((limit) => limit === 20).length).toBeGreaterThan(
				late.length * 0.9,
			);
		}
	});

	it('stays within 1 and max', () => {
		const clock = { now: 0 };
		const width = new Width(4, () => clock.now);
		const limits = run(width, clock, 4, 200_000, timeSliced(1));
		expect(lowest(limits)).toBeGreaterThanOrEqual(1);
		expect(highest(limits)).toBeLessThanOrEqual(4);
		expect(median(limits.slice(100_000))).toBeLessThanOrEqual(2);
	});
});
