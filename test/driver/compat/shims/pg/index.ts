// `pg`, as node-postgres's tests see it, over quarry's driver.
import {
	Client,
	DatabaseError,
	escapeIdentifier,
	escapeLiteral,
	Query,
	Result,
	pgTypes,
} from './client.js';
import { defaults } from './defaults.js';
import { Pool as BasePool } from './pool.js';
import { TypeOverrides } from './types.js';

class Pool extends BasePool {
	constructor(options?: any) {
		super(options, Client);
	}
}

const pg = {
	defaults,
	Client,
	Query,
	Pool,
	types: pgTypes,
	DatabaseError,
	TypeOverrides,
	escapeIdentifier,
	escapeLiteral,
	Result,
};
// pg-native has no quarry counterpart; like pg's lazy getter, not enumerable
Object.defineProperty(pg, 'native', { value: null, enumerable: false });

export default pg;
export { pg as 'module.exports' };
