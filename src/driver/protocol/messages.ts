/** A column of a result, from RowDescription. */
export interface Field {
	/** The column's name (its alias, if any). */
	readonly name: string;
	/** The OID of the table the column comes from, or 0. */
	readonly tableOid: number;
	/** The column's attribute number in that table, or 0. */
	readonly columnId: number;
	/** The OID of the column's data type. */
	readonly typeOid: number;
	/** The data type's size (`pg_type.typlen`); negative for variable width. */
	readonly typeSize: number;
	/** The type modifier (`pg_attribute.atttypmod`), e.g. a varchar length. */
	readonly typeModifier: number;
	/** 0 for text, 1 for binary. */
	readonly format: number;
}

/**
 * The fields of an ErrorResponse or NoticeResponse, keyed by their protocol
 * codes. See https://www.postgresql.org/docs/current/protocol-error-fields.html
 */
export type NoticeFields = Readonly<Record<string, string>>;

export type BackendMessage =
	| { readonly type: 'AuthenticationOk' }
	| { readonly type: 'AuthenticationCleartextPassword' }
	| { readonly type: 'AuthenticationMD5Password'; readonly salt: Uint8Array }
	| {
			readonly type: 'AuthenticationSASL';
			readonly mechanisms: readonly string[];
	  }
	| { readonly type: 'AuthenticationSASLContinue'; readonly data: Uint8Array }
	| { readonly type: 'AuthenticationSASLFinal'; readonly data: Uint8Array }
	| { readonly type: 'AuthenticationUnsupported'; readonly code: number }
	| {
			readonly type: 'BackendKeyData';
			readonly pid: number;
			readonly key: Uint8Array;
	  }
	| { readonly type: 'BindComplete' }
	| { readonly type: 'CloseComplete' }
	| { readonly type: 'CommandComplete'; readonly tag: string }
	| { readonly type: 'CopyData'; readonly data: Uint8Array }
	| { readonly type: 'CopyDone' }
	| {
			readonly type: 'CopyInResponse' | 'CopyOutResponse' | 'CopyBothResponse';
			readonly binary: boolean;
			readonly columnFormats: readonly number[];
	  }
	| {
			readonly type: 'DataRow';
			/** The message body: Int16 count, then length-prefixed values. */
			readonly payload: Uint8Array;
	  }
	| { readonly type: 'EmptyQueryResponse' }
	| { readonly type: 'ErrorResponse'; readonly fields: NoticeFields }
	| { readonly type: 'NoticeResponse'; readonly fields: NoticeFields }
	| {
			readonly type: 'NegotiateProtocolVersion';
			readonly minor: number;
			readonly unrecognized: readonly string[];
	  }
	| { readonly type: 'NoData' }
	| {
			readonly type: 'NotificationResponse';
			readonly pid: number;
			readonly channel: string;
			readonly payload: string;
	  }
	| {
			readonly type: 'ParameterDescription';
			readonly typeOids: readonly number[];
	  }
	| {
			readonly type: 'ParameterStatus';
			readonly name: string;
			readonly value: string;
	  }
	| { readonly type: 'ParseComplete' }
	| { readonly type: 'PortalSuspended' }
	| {
			readonly type: 'ReadyForQuery';
			/** `I` idle, `T` in a transaction, `E` in a failed transaction. */
			readonly status: 'I' | 'T' | 'E';
	  }
	| { readonly type: 'RowDescription'; readonly fields: readonly Field[] }
	| { readonly type: 'FunctionCallResponse' };
