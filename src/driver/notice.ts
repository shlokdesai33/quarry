import type { NoticeFields } from './protocol/messages.js';

/** A NoticeResponse: a warning or informational message from the server. */
export interface Notice {
	/** `WARNING`, `NOTICE`, `DEBUG`, `INFO` or `LOG` (not localized). */
	readonly severity: string;
	/** The SQLSTATE code. */
	readonly code: string;
	readonly message: string;
	readonly detail: string | undefined;
	readonly hint: string | undefined;
	readonly where: string | undefined;
	/** Every field as sent, keyed by protocol code. */
	readonly fields: NoticeFields;
}

/** A NotificationResponse, from `NOTIFY` or `pg_notify`. */
export interface Notification {
	/** The process ID of the notifying backend. */
	readonly pid: number;
	readonly channel: string;
	readonly payload: string;
}

export function toNotice(fields: NoticeFields): Notice {
	return {
		severity: fields['V'] ?? fields['S'] ?? 'NOTICE',
		code: fields['C'] ?? '00000',
		message: fields['M'] ?? '',
		detail: fields['D'],
		hint: fields['H'],
		where: fields['W'],
		fields,
	};
}
