import { integer, timestamptz } from './data-types.js';

export function primaryKey<T extends number = number>() {
	return integer<T>().identity();
}

export function createdAt() {
	return timestamptz().as<Date, never, never>();
}
