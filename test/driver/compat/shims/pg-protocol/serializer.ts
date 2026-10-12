// pg-protocol's `serialize` over quarry's frontend encoders, so
// pg-protocol's outbound-serializer tests check quarry's message bytes.
import { Buffer } from 'node:buffer';
import * as fe from '../../../../../src/driver/protocol/frontend.js';
import { Writer } from '../../../../../src/driver/protocol/writer.js';

const take = (w: Writer) => Buffer.from(w.take());
const utf8 = (s: string) => new TextEncoder().encode(s);

const startup = (opts: Record<string, string>) =>
	take(
		fe.startup(new Writer(), fe.PROTOCOL_3_0, {
			...opts,
			client_encoding: 'UTF8',
		}),
	);

const password = (value: string) => take(fe.password(new Writer(), value));

const requestSsl = () => Buffer.from(fe.sslRequest());

const sendSASLInitialResponseMessage = (
	mechanism: string,
	initialResponse: string,
) =>
	take(fe.saslInitialResponse(new Writer(), mechanism, utf8(initialResponse)));

const sendSCRAMClientFinalMessage = (additionalData: string) =>
	take(fe.saslResponse(new Writer(), utf8(additionalData)));

const query = (text: string) => take(fe.query(new Writer(), text));

const parse = (q: { name?: string; text: string; types?: number[] }) =>
	take(fe.parse(new Writer(), q.name ?? '', q.text, q.types ?? []));

const bind = (
	config: {
		portal?: string;
		statement?: string;
		binary?: boolean;
		values?: unknown[];
		valueMapper?: (value: unknown, index: number) => unknown;
	} = {},
) => {
	const values = (config.values ?? []).map((value, i) => {
		const mapped = config.valueMapper ? config.valueMapper(value, i) : value;
		if (mapped === null || mapped === undefined) return null;
		if (mapped instanceof Uint8Array) return mapped;
		return String(mapped);
	});
	return take(
		fe.bind(
			new Writer(),
			config.portal ?? '',
			config.statement ?? '',
			values,
			config.binary ? 1 : 0,
		),
	);
};

const execute = (config: { portal?: string; rows?: number } = {}) =>
	take(fe.execute(new Writer(), config.portal ?? '', config.rows ?? 0));

const describe = (msg: { type: 'S' | 'P'; name?: string }) =>
	take(fe.describe(new Writer(), msg.type, msg.name ?? ''));

const close = (msg: { type: 'S' | 'P'; name?: string }) =>
	take(fe.close(new Writer(), msg.type, msg.name ?? ''));

const flush = () => take(fe.flush(new Writer()));
const sync = () => take(fe.sync(new Writer()));
const end = () => take(fe.terminate(new Writer()));
const copyData = (chunk: Uint8Array) => take(fe.copyData(new Writer(), chunk));
const copyDone = () => take(fe.copyDone(new Writer()));
const copyFail = (message: string) => take(fe.copyFail(new Writer(), message));

const cancel = (processID: number, secretKey: number) => {
	const key = new Uint8Array(4);
	new DataView(key.buffer).setInt32(0, secretKey);
	return Buffer.from(fe.cancelRequest(processID, key));
};

export const serialize = {
	startup,
	password,
	requestSsl,
	sendSASLInitialResponseMessage,
	sendSCRAMClientFinalMessage,
	query,
	parse,
	bind,
	execute,
	describe,
	close,
	flush,
	sync,
	end,
	copyData,
	copyDone,
	copyFail,
	cancel,
};
