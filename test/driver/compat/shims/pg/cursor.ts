// pg-cursor over quarry's `connection.cursor()`. pg-cursor sends
// Execute(n) per `read(n)`; quarry's cursor reads fixed-size batches and
// prefetches one, so reads are served from a buffer. Rows, errors, closing
// and when the connection is free again are quarry's.
import { EventEmitter } from 'node:events';
import type { Connection } from '../../../../../src/driver/index.js';
import {
	Result,
	Submission,
	prepareValue,
	toPgError,
	toPgField,
	type Client,
} from './client.js';
import { parsersFor } from './types.js';

type ReadCallback = (
	error: Error | null,
	rows?: any[],
	result?: Result,
) => void;

const BATCH = 100;

export class Cursor extends EventEmitter {
	readonly text: string;
	readonly values: unknown[] | null;
	state: 'initialized' | 'submitted' | 'idle' | 'busy' | 'done' | 'error' =
		'initialized';
	_result: Result;
	_error: Error | undefined;
	readonly _conf: any;
	readonly _Promise: PromiseConstructor;
	connection: Connection | null = null;
	#iterator: AsyncIterator<any[]> | undefined;
	#buffer: any[] = [];
	#exhausted = false;
	#reads: { rows: number; cb: ReadCallback }[] = [];
	#reading = false;
	#ended = false;
	#closing: Promise<void> | undefined;
	#done: () => void = () => {};

	constructor(text: string, values?: unknown[], config: any = {}) {
		super();
		this._conf = config ?? {};
		this.text = text;
		this.values = values ? values.map((v) => prepareValue(v)) : null;
		this._result = new Result(this._conf.rowMode, this._conf.types);
		this._Promise = this._conf.Promise ?? Promise;
	}

	submit(submission: Submission): void {
		if (!(submission instanceof Submission))
			throw new TypeError('pg-cursor needs the quarry shim client');
		const connection = submission.connection;
		this.connection = connection;
		this.#done = submission.done;
		this.state = 'submitted';
		this.#start(connection, submission.client);
	}

	#start(connection: Connection, client: Client): void {
		const source = this._conf.types ?? client._types;
		const options: Record<string, unknown> = {
			rowMode: this._conf.rowMode === 'array' ? 'array' : 'object',
			types: parsersFor(source),
			batchSize: this._conf.batchSize ?? BATCH,
		};
		const timeout = client._queryTimeout;
		if (timeout) options['timeout'] = timeout;
		// the result columns, as pg-cursor reports them from RowDescription
		connection.describe(this.text).then(
			(d) => {
				this._result.fields = d.fields.map(toPgField);
			},
			() => {},
		);
		const cursor = connection.cursor(this.text, this.values ?? [], options);
		this.#iterator = cursor[Symbol.asyncIterator]();
		this.state = 'idle';
		// the first batch is fetched at once, so errors surface without a read, as in pg-cursor
		this.#fetch();
	}

	#fetch(): void {
		const iterator = this.#iterator;
		if (this.#reading || this.#exhausted || iterator === undefined) return;
		if (this.state === 'error' || this.#closing) return;
		this.#reading = true;
		iterator.next().then(
			(next) => {
				this.#reading = false;
				if (next.done) this.#exhausted = true;
				else this.#buffer.push(...next.value);
				if (this.state === 'busy') this.state = 'idle';
				this.#pump();
			},
			(error: unknown) => {
				this.#reading = false;
				this.handleError(toPgError(error));
			},
		);
	}

	/** Serves queued reads from the buffer, fetching batches as needed. */
	#pump(): void {
		if (this.#iterator === undefined || this.state === 'error') return;
		while (this.#reads.length > 0) {
			const read = this.#reads[0];
			if (read === undefined) break;
			if (this.#buffer.length >= read.rows || this.#exhausted) {
				this.#reads.shift();
				const rows = this.#buffer.splice(0, read.rows);
				this.#deliver(rows, read.cb);
				continue;
			}
			this.state = 'busy';
			this.#fetch();
			return;
		}
		if (this.#exhausted && this.#buffer.length === 0) this.#finish();
	}

	#deliver(rows: any[], cb: ReadCallback): void {
		for (const row of rows) this.emit('row', row, this._result);
		this._result.rows = rows;
		this._result.rowCount = rows.length;
		this._result.command ??= 'SELECT';
		setImmediate(() => cb(null, rows, this._result));
	}

	#finish(): void {
		if (this.#ended) return;
		this.#ended = true;
		this.state = 'done';
		setImmediate(() => {
			this.emit('end', this._result);
			this.#done();
		});
	}

	read(rows: number, cb?: ReadCallback): Promise<any[]> | undefined {
		let promise: Promise<any[]> | undefined;
		let callback = cb;
		if (!callback) {
			promise = new this._Promise((resolve, reject) => {
				callback = (error, result) =>
					error ? reject(error) : resolve(result ?? []);
			});
		}
		const done = callback as ReadCallback;
		if (this.state === 'error') {
			setImmediate(() => done(this._error ?? new Error('cursor failed')));
		} else if (this.state === 'done') {
			setImmediate(() => done(null, []));
		} else {
			this.#reads.push({ rows, cb: done });
			this.#pump();
		}
		return promise;
	}

	close(cb?: (error?: Error) => void): Promise<void> | undefined {
		let promise: Promise<void> | undefined;
		let callback = cb;
		if (!callback) {
			promise = new this._Promise((resolve, reject) => {
				callback = (error) => (error ? reject(error) : resolve());
			});
		}
		const done = callback as (error?: Error) => void;
		if (this.#iterator === undefined || this.state === 'done') {
			setImmediate(() => done());
			return promise;
		}
		this.#closing ??= (async () => {
			try {
				await this.#iterator?.return?.();
			} catch {
				// the error, if any, went to read()
			}
			for (const read of this.#reads.splice(0)) read.cb(null, []);
			this.#finish();
		})();
		this.#closing.then(
			() => done(),
			(error: Error) => done(error),
		);
		return promise;
	}

	end(cb: () => void): void {
		void this.close(() => cb());
	}

	handleError(error: Error): void {
		if (this.state === 'done') return;
		this.state = 'error';
		this._error = error;
		for (const read of this.#reads.splice(0)) read.cb(error);
		if (this.listenerCount('error') > 0) this.emit('error', error);
		this.#done();
	}

	// pg-query-stream binds these; the shim's client never calls them
	handleRowDescription(): void {}
	handleDataRow(): void {}
	handlePortalSuspended(): void {}
	handleCommandComplete(): void {}
	handleReadyForQuery(): void {}
	handleEmptyQuery(): void {}
}

export default Cursor;
export { Cursor as 'module.exports' };
