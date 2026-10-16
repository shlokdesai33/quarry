import type { CallSite } from '../call-site.js';
import type { Codec } from '../driver/codec.js';
import { DataType } from './data-type.js';

/**
 * A type `defineType` declares: an extension's (`citext`, PostGIS), a
 * domain, or any other type quarry has no factory for. `N` is its name as
 * DDL writes it; its codec says how values are sent and read.
 */
export class CustomType<N extends string = string> extends DataType<'custom'> {
	/** The type's name as DDL writes it, e.g. `citext`. */
	readonly sqlName: N;

	/** Where `defineType` was called, for `db.verify`. */
	readonly site: CallSite | undefined;

	constructor(sqlName: N, codec: Codec, site?: CallSite) {
		super('custom', { codec });
		this.sqlName = sqlName;
		this.site = site;
	}
}
