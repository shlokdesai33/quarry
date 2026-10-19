const DONE: IteratorReturnResult<undefined> = Object.freeze({
	done: true,
	value: undefined,
});

const noop = () => {};

/**
 * A query's rows, one at a time, read in batches through a cursor: a batch
 * is fetched only once the rows before it are taken, so a slow consumer
 * holds one batch in memory. Nothing runs until the first row is asked for.
 *
 * It runs once: iterating it again yields nothing. Leaving a `for await`
 * loop early (`break`, `return`, a throw), calling `return()`, or disposing
 * of it (`await using`) closes the cursor and frees its connection.
 *
 * It is an async iterable, so `Readable.from(rows)` (Node) and
 * `ReadableStream.from(rows)` read it with backpressure, and close it when
 * destroyed or canceled.
 */
export class RowStream<R>
	implements AsyncIterator<R, undefined>, AsyncIterable<R>, AsyncDisposable
{
	readonly #batches: AsyncIterable<readonly R[]>;
	#iterator: AsyncIterator<readonly R[]> | undefined;
	#rows: readonly R[] = [];
	#index = 0;
	/** The batch being read; later calls wait for it. */
	#pull: Promise<IteratorResult<R, undefined>> | undefined;
	#done = false;

	/** @internal */
	constructor(batches: AsyncIterable<readonly R[]>) {
		this.#batches = batches;
	}

	next(): Promise<IteratorResult<R, undefined>> {
		if (this.#index < this.#rows.length) {
			// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
			return Promise.resolve({
				done: false,
				value: this.#rows[this.#index++]!,
			});
		}
		if (this.#pull !== undefined) {
			const after = () => this.next();
			return this.#pull.then(after, after);
		}
		if (this.#done) return Promise.resolve(DONE);
		const pull = this.#read().finally(() => {
			if (this.#pull === pull) this.#pull = undefined;
		});
		this.#pull = pull;
		return pull;
	}

	async #read(): Promise<IteratorResult<R, undefined>> {
		try {
			this.#iterator ??= this.#batches[Symbol.asyncIterator]();
			for (;;) {
				// oxlint-disable-next-line no-await-in-loop -- one batch after another
				const result = await this.#iterator.next();
				if (result.done === true || this.#done) {
					this.#done = true;
					return DONE;
				}
				const rows = result.value;
				if (rows.length > 0) {
					this.#rows = rows;
					this.#index = 1;
					// oxlint-disable-next-line typescript/no-non-null-assertion -- not empty
					return { done: false, value: rows[0]! };
				}
			}
		} catch (error) {
			this.#done = true;
			this.#rows = [];
			throw error;
		}
	}

	/** Stops reading: closes the cursor and frees its connection, once a batch being read has arrived. */
	async return(): Promise<IteratorResult<R, undefined>> {
		this.#done = true;
		this.#rows = [];
		this.#index = 0;
		const iterator = this.#iterator;
		this.#iterator = undefined;
		await iterator?.return?.();
		return DONE;
	}

	[Symbol.asyncIterator](): this {
		return this;
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.return().then(noop);
	}
}
