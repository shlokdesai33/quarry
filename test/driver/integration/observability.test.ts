import { describe, expect, it } from 'vitest';
import { PostgresError, UniqueViolation } from '../../../src/driver/errors.js';
import { createPool } from '../../../src/driver/pool.js';
import { DriverExecutor } from '../../../src/driver-executor.js';
import type { SpanLike, TracerLike } from '../../../src/driver/telemetry.js';
import { cluster, noPg, open, options, rejection } from './helpers.js';

interface RecordedSpan {
	name: string;
	kind: number | undefined;
	attributes: Record<string, string | number | boolean>;
	status: { code: number; message?: string } | undefined;
	exceptions: Error[];
	ended: boolean;
}

function recordingTracer(): { tracer: TracerLike; spans: RecordedSpan[] } {
	const spans: RecordedSpan[] = [];
	const tracer: TracerLike = {
		startSpan(name, opts) {
			const span: RecordedSpan = {
				name,
				kind: opts?.kind,
				attributes: { ...opts?.attributes },
				status: undefined,
				exceptions: [],
				ended: false,
			};
			spans.push(span);
			const handle: SpanLike = {
				setAttribute: (k, v) => (span.attributes[k] = v),
				setStatus: (s) => (span.status = s),
				recordException: (e) => span.exceptions.push(e),
				end: () => (span.ended = true),
			};
			return handle;
		},
	};
	return { tracer, spans };
}

describe.skipIf(noPg)('OpenTelemetry spans', () => {
	it('reports each query as a client span with database attributes', async () => {
		const { tracer, spans } = recordingTracer();
		await using conn = await open({ telemetry: { tracer } });
		await conn.query('select $1::text as v from generate_series(1, 3)', [
			'secret-param',
		]);
		const [span] = spans;
		expect(span).toMatchObject({
			name: `SELECT ${cluster().database}`,
			kind: 2,
			ended: true,
			status: undefined,
			attributes: {
				'db.system.name': 'postgresql',
				'db.namespace': cluster().database,
				'db.operation.name': 'SELECT',
				'db.query.text': 'select $1::text as v from generate_series(1, 3)',
				'db.response.returned_rows': 3,
				'server.address': cluster().host,
				'server.port': cluster().port,
			},
		});
		expect(JSON.stringify(spans)).not.toContain('secret-param');
	});

	it('reports a cursor, COPY TO and a transaction as one span each', async () => {
		const { tracer, spans } = recordingTracer();
		await using conn = await open({ telemetry: { tracer } });
		let batches = 0;
		for await (const _ of conn.cursor('select generate_series(1, 5) as n', [], {
			batchSize: 2,
		}))
			batches++;
		expect(batches).toBe(3);
		const chunks: Uint8Array[] = [];
		for await (const chunk of conn.copyTo(
			'copy (select generate_series(1, 4)) to stdout',
		))
			chunks.push(chunk);
		await conn.transaction(async (tx) => {
			await tx.query('select 1');
		});
		await rejection(
			conn.transaction((tx) => tx.query('select 1/0')),
			PostgresError,
		);
		const db = cluster().database;
		expect(
			spans.map((span) => [
				span.name,
				span.attributes['db.response.returned_rows'],
				span.status?.code,
				span.ended,
			]),
		).toEqual([
			[`SELECT ${db}`, 5, undefined, true],
			[`COPY ${db}`, 4, undefined, true],
			[`TRANSACTION ${db}`, undefined, undefined, true],
			[`BEGIN ${db}`, undefined, undefined, true],
			[`SELECT ${db}`, 1, undefined, true],
			[`COMMIT ${db}`, undefined, undefined, true],
			[`TRANSACTION ${db}`, undefined, 2, true],
			[`BEGIN ${db}`, undefined, undefined, true],
			[`SELECT ${db}`, undefined, 2, true],
			[`ROLLBACK ${db}`, undefined, undefined, true],
		]);
		expect(spans[2]?.attributes['db.query.text']).toBeUndefined();
		expect(spans[2]?.attributes['db.operation.name']).toBe('TRANSACTION');
	});

	it('marks failures with the SQLSTATE and the exception', async () => {
		const { tracer, spans } = recordingTracer();
		await using conn = await open({ telemetry: { tracer, queryText: false } });
		await conn.query('create temp table t_otel (id int primary key)');
		await conn.query('insert into t_otel values (1)');
		await rejection(
			conn.query('insert into t_otel values (1)'),
			UniqueViolation,
		);
		const failed = spans.at(-1);
		expect(failed?.status?.code).toBe(2);
		expect(failed?.attributes['db.response.status_code']).toBe('23505');
		expect(failed?.attributes['error.type']).toBe('23505');
		expect(failed?.exceptions[0]).toBeInstanceOf(PostgresError);
		expect(spans.every((s) => !('db.query.text' in s.attributes))).toBe(true);
	});

	it('names spans after quarry tags, and does not trace the statements behind a timeout', async () => {
		const { tracer, spans } = recordingTracer();
		await using pool = createPool({ ...options(), telemetry: { tracer } });
		const executor = new DriverExecutor(pool, { catalog: false });
		await executor.execute(
			{ sql: 'select 1', params: [], tag: 'health.check' },
			{ timeout: '5s' },
		);
		expect(spans.map((s) => s.name)).toEqual(['health.check']);
		expect(spans[0]?.attributes['db.query.summary']).toBe('health.check');
	});
});

describe.skipIf(noPg)('call-site stacks', () => {
	it('appends the caller’s stack to errors when captureStack is on', async () => {
		await using conn = await open({ captureStack: true });
		const error = await rejection(conn.query('select 1/0'), PostgresError);
		expect(error.stack).toContain('query issued at');
		expect(error.stack).toContain('observability.test.ts');
		await using plain = await open();
		const bare = await rejection(plain.query('select 1/0'), PostgresError);
		expect(bare.stack).not.toContain('query issued at');
	});
});
