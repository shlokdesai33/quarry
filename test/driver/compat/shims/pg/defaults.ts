import { pgTypes } from './types.js';

const parseBigInteger = pgTypes.getTypeParser(20, 'text');
const parseBigIntegerArray = pgTypes.getTypeParser(1016, 'text');

/** pg's mutable defaults; `parseInt8` swaps the global int8 parsers as pg does. */
export const defaults: Record<string, any> = {
	host: 'localhost',
	user: process.env['USER'],
	database: undefined,
	password: null,
	connectionString: undefined,
	port: 5432,
	rows: 0,
	binary: false,
	max: 10,
	idleTimeoutMillis: 30000,
	client_encoding: '',
	ssl: false,
	application_name: undefined,
	fallback_application_name: undefined,
	options: undefined,
	parseInputDatesAsUTC: false,
	statement_timeout: false,
	lock_timeout: false,
	idle_in_transaction_session_timeout: false,
	query_timeout: false,
	connect_timeout: 0,
	keepalives: 1,
	keepalives_idle: 0,
};

Object.defineProperty(defaults, 'parseInt8', {
	set(value: boolean) {
		pgTypes.setTypeParser(
			20,
			'text',
			value ? pgTypes.getTypeParser(23, 'text') : parseBigInteger,
		);
		pgTypes.setTypeParser(
			1016,
			'text',
			value ? pgTypes.getTypeParser(1007, 'text') : parseBigIntegerArray,
		);
	},
});
