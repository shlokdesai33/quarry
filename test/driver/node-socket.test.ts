import { expect, test } from 'vitest';
import { socketErrorMessage } from '../../src/driver/node-socket.js';

function systemError(message: string, code: string) {
	return Object.assign(new Error(message), { code });
}

test('a socket error keeps its message', () => {
	expect(
		socketErrorMessage(
			systemError('connect ECONNREFUSED 127.0.0.1:1', 'ECONNREFUSED'),
		),
	).toBe('connect ECONNREFUSED 127.0.0.1:1');
});

test("an AggregateError, as connecting to localhost raises, uses its errors' messages", () => {
	const error = Object.assign(
		new AggregateError(
			[
				systemError('connect ECONNREFUSED ::1:1', 'ECONNREFUSED'),
				systemError('connect ECONNREFUSED 127.0.0.1:1', 'ECONNREFUSED'),
			],
			'',
		),
		{ code: 'ECONNREFUSED' },
	);
	expect(socketErrorMessage(error)).toBe(
		'connect ECONNREFUSED ::1:1; connect ECONNREFUSED 127.0.0.1:1',
	);
	expect(
		socketErrorMessage(
			Object.assign(new AggregateError([], ''), { code: 'EHOSTUNREACH' }),
		),
	).toBe('EHOSTUNREACH');
	expect(socketErrorMessage(new Error(''))).toBe('the connection failed');
});
