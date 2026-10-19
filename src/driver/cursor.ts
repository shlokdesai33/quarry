import { AbortError } from './errors.js';
import {
	ClosePortalOp,
	cursorAborted,
	FetchOp,
	type CursorBatch,
	type CursorOp,
	type Op,
} from './ops.js';
import type { RowDecoder } from './rows.js';

/** What a cursor needs from its connection. */
export interface CursorHost {
	/** The transaction status of the latest ReadyForQuery. */
	status(): 'I' | 'T' | 'E';
	enqueue(op: Op, signal?: AbortSignal, timeout?: number): void;
	/** Drops an operation not yet sent, or cancels (or interrupts) one that was. */
	abort(op: Op, reason: 'abort' | 'timeout', cause?: unknown): void;
	/** A portal name not used on the connection yet. */
	portal(): string;
}

/** What a cursor reads, and how. */
export interface CursorRequest {
	readonly sql: string;
	readonly params: readonly unknown[];
	readonly batchSize: number;
	readonly signal: AbortSignal | undefined;
	readonly timeout: number | undefined;
	readonly statementTimeout: number | string | undefined;
	/**
	 * The operation opening the portal: '' for the unnamed one, outside a
	 * transaction. With `statementTimeout` (an interval), it sets and
	 * restores `statement_timeout` around the portal, under its Sync.
	 */
	readonly open: (
		portal: string,
		held: boolean,
		statementTimeout: string | undefined,
	) => CursorOp;
}

const DONE: IteratorReturnResult<undefined> = Object.freeze({
	done: true,
	value: undefined,
});

const noop = () => {};

const interval = (timeout: number | string) =>
	typeof timeout === 'number' ? `${timeout}ms` : timeout;

/**
 * One run of a cursor: opened by the first `next`, then a batch per `next`.
 *
 * Outside a transaction, the portal lives in an implicit transaction that
 * holds the connection until the portal is read or closed. Inside one, it
 * is a named portal read with an Execute + Sync per batch, so other queries
 * of the transaction run between batches; it is closed at the end.
 *
 * With a `statementTimeout`, it is always the first kind, whatever the
 * transaction status says: the operation sets the timeout before the
 * portal and restores it before the Sync, which bounds the portal alone.
 * (A `Transaction` refuses one: its other queries couldn't run between
 * batches.)
 */
export class CursorIterator implements AsyncIterator<unknown[], undefined> {
	readonly #host: CursorHost;
	readonly #request: CursorRequest;
	#started = false;
	/** Why the cursor couldn't be opened. */
	#failure: { error: unknown } | undefined;
	#done = false;
	/** Ended by `return()`: a `next` waiting for a batch gets the end. */
	#returned = false;
	/** The operation opening the portal: outside a transaction, it reads every batch. */
	#op: CursorOp | undefined;
	#held = false;
	#portal = '';
	#decoder: RowDecoder | undefined;
	#more = true;
	/** The operation reading a held cursor's batch, while it runs. */
	#reading: Op | undefined;
	/** Why a held cursor was aborted. */
	#aborted: Error | undefined;
	#cleanup: (() => void) | undefined;
	/** `next` calls run one after another, as an async generator's do. */
	#last: Promise<unknown> = Promise.resolve();

	constructor(host: CursorHost, request: CursorRequest) {
		this.#host = host;
		this.#request = request;
	}

	next(): Promise<IteratorResult<unknown[], undefined>> {
		// opened by the call itself, so queries issued after it run after it
		if (!this.#started && !this.#done) {
			try {
				this.#start();
			} catch (error) {
				this.#failure = { error };
			}
		}
		return this.#serial(() => this.#next());
	}

	/** Stops at once, without waiting for a batch being read: a `next` waiting for it gets the end. */
	return(): Promise<IteratorResult<unknown[], undefined>> {
		return this.#return();
	}

	#serial<T>(run: () => Promise<T>): Promise<T> {
		const result = this.#last.then(run);
		this.#last = result.then(noop, noop);
		return result;
	}

	async #next(): Promise<IteratorResult<unknown[], undefined>> {
		if (this.#done) return DONE;
		try {
			if (this.#failure !== undefined) throw this.#failure.error;
			const rows = await this.#read();
			if (rows !== undefined) return { done: false, value: rows };
		} catch (error) {
			const failure = await this.#end(error);
			if (this.#returned) return DONE;
			throw failure;
		}
		const error = await this.#end(undefined);
		if (error !== undefined) throw error;
		return DONE;
	}

	async #return(): Promise<IteratorResult<unknown[], undefined>> {
		if (this.#done) return DONE;
		if (!this.#started) {
			this.#done = true;
			return DONE;
		}
		this.#returned = true;
		const op = this.#op;
		const close = this.#held ? undefined : op?.close();
		// not sent yet: dropped from the queue rather than waiting its turn
		const unsent = this.#held ? this.#reading : op;
		if (unsent !== undefined && !unsent.written)
			this.#host.abort(unsent, 'abort');
		await Promise.all([close, this.#end(undefined)]);
		return DONE;
	}

	#start(): void {
		this.#started = true;
		const host = this.#host;
		const { batchSize, signal, timeout, statementTimeout } = this.#request;
		if (!Number.isInteger(batchSize) || batchSize < 1) {
			throw new RangeError(
				`batchSize takes a whole number of rows from 1, not ${batchSize}`,
			);
		}
		if (statementTimeout === undefined && host.status() !== 'I') {
			this.#openHeld(signal, timeout);
			return;
		}
		const op = this.#request.open(
			'',
			false,
			statementTimeout === undefined ? undefined : interval(statementTimeout),
		);
		this.#op = op;
		host.enqueue(op, signal, timeout);
	}

	#openHeld(
		signal: AbortSignal | undefined,
		timeout: number | undefined,
	): void {
		this.#held = true;
		if (signal?.aborted) {
			throw new AbortError('The query was aborted before it was sent', {
				cause: signal.reason,
			});
		}
		this.#portal = this.#host.portal();
		const op = this.#request.open(this.#portal, true, undefined);
		this.#op = op;
		const cleanups: (() => void)[] = [];
		if (signal !== undefined) {
			const onAbort = () => this.#interrupt('abort', signal.reason);
			signal.addEventListener('abort', onAbort, { once: true });
			cleanups.push(() => signal.removeEventListener('abort', onAbort));
		}
		if (timeout !== undefined && timeout > 0) {
			const timer = setTimeout(
				() => this.#interrupt('timeout', undefined),
				timeout,
			);
			cleanups.push(() => clearTimeout(timer));
		}
		this.#cleanup = () => {
			for (const cleanup of cleanups) cleanup();
		};
		this.#reading = op;
		this.#host.enqueue(op);
	}

	async #read(): Promise<unknown[] | undefined> {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- set by #start
		const op = this.#op!;
		if (!this.#held) return op.next();
		for (;;) {
			if (this.#aborted !== undefined) throw this.#aborted;
			if (!this.#more) return undefined;
			// oxlint-disable-next-line no-await-in-loop -- one batch after another
			const batch = await this.#readHeld(op);
			if (this.#aborted !== undefined) throw this.#aborted;
			this.#more = batch.more;
			if (batch.rows.length > 0) return batch.rows;
		}
	}

	/** A held cursor's next batch: its opening operation's, then a `FetchOp`'s. */
	async #readHeld(op: CursorOp): Promise<CursorBatch> {
		try {
			if (this.#reading === op) {
				const rows = (await op.next()) ?? [];
				this.#decoder = op.decoder;
				return { rows, more: op.more };
			}
			const { sql, params, batchSize } = this.#request;
			return await new Promise<CursorBatch>((resolve, reject) => {
				const fetch = new FetchOp(
					sql,
					params,
					this.#portal,
					batchSize,
					this.#decoder,
					resolve,
					reject,
				);
				this.#reading = fetch;
				this.#host.enqueue(fetch);
			});
		} finally {
			this.#reading = undefined;
		}
	}

	#interrupt(reason: 'abort' | 'timeout', cause: unknown): void {
		if (this.#done || this.#aborted !== undefined) return;
		this.#aborted = cursorAborted(reason, cause);
		if (this.#reading !== undefined)
			this.#host.abort(this.#reading, reason, cause);
	}

	/** Ends the run: closes a held portal and stops listening for aborts. The error to report: `failure`. */
	async #end(failure: unknown): Promise<unknown> {
		if (this.#done) return failure;
		this.#done = true;
		this.#cleanup?.();
		if (this.#held && this.#portal !== '') {
			this.#host.enqueue(new ClosePortalOp(this.#portal));
		}
		return failure;
	}
}
