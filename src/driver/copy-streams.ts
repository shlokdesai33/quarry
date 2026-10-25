/* oxlint-disable promise/no-callback-in-promise, promise/no-promise-in-callback, promise/always-return -- Node's Writable hooks take callbacks, and the COPY is a promise */
import { Readable, Writable } from 'node:stream';

/** A Node `Writable` that is a `COPY … FROM STDIN`; see `Connection.createCopyFromStream`. */
export interface CopyFromStream extends Writable {
	/** Rows copied, once the stream has finished (`'finish'`). */
	readonly rowCount: number | undefined;
}

/**
 * A `Writable` whose chunks are the data of a COPY that `run` starts with
 * them as its source. Each write is taken by the COPY before its callback
 * runs, so the stream applies the socket's backpressure. It finishes once
 * the server confirmed the COPY; destroying it, or an error, fails the
 * COPY (CopyFail), and the server's error destroys the stream.
 */
export function copyFromStream(
	run: (source: AsyncIterable<Uint8Array | string>) => Promise<number>,
): CopyFromStream {
	let take: ((chunk: IteratorResult<Uint8Array | string>) => void) | undefined;
	let fail: ((error: Error) => void) | undefined;
	const queued: {
		chunk: IteratorResult<Uint8Array | string>;
		taken: () => void;
	}[] = [];
	let failure: Error | undefined;
	const source: AsyncIterable<Uint8Array | string> = {
		[Symbol.asyncIterator]: () => ({
			next: () => {
				if (failure !== undefined) return Promise.reject(failure);
				const next = queued.shift();
				if (next !== undefined) {
					next.taken();
					return Promise.resolve(next.chunk);
				}
				return new Promise((resolve, reject) => {
					take = resolve;
					fail = reject;
				});
			},
		}),
	};
	const offer = (
		chunk: IteratorResult<Uint8Array | string>,
		taken: () => void,
	) => {
		const waiting = take;
		if (waiting === undefined) {
			queued.push({ chunk, taken });
			return;
		}
		take = undefined;
		fail = undefined;
		taken();
		waiting(chunk);
	};
	let copied: Promise<number> | undefined;
	const start = () => {
		copied ??= run(source);
		return copied;
	};
	let rowCount: number | undefined;
	const stream = new Writable({
		write(chunk: Uint8Array | string, _encoding, callback) {
			start().catch((error: unknown) =>
				stream.destroy(
					error instanceof Error ? error : new Error(String(error)),
				),
			);
			offer({ done: false, value: chunk }, () => callback());
		},
		final(callback) {
			const done = start();
			offer({ done: true, value: undefined }, () => {});
			done.then(
				(count) => {
					rowCount = count;
					callback();
				},
				(error: unknown) =>
					callback(error instanceof Error ? error : new Error(String(error))),
			);
		},
		destroy(error, callback) {
			failure = error ?? new Error('The COPY stream was destroyed');
			fail?.(failure);
			take = undefined;
			fail = undefined;
			// done once the COPY has failed, so the connection is free again
			void (copied ?? Promise.resolve(0))
				.catch(() => 0)
				.finally(() => callback(error));
		},
	});
	Object.defineProperty(stream, 'rowCount', { get: () => rowCount });
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `rowCount` defined just above
	return stream as CopyFromStream;
}

/** A Node `Readable` of a `COPY … TO STDOUT`'s data; destroying it stops the COPY. */
export function copyToStream(data: AsyncIterable<Uint8Array>): Readable {
	return Readable.from(data, { objectMode: false });
}
