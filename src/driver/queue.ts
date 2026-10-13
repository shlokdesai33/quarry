/**
 * A first-in, first-out list that keeps its array's capacity. `push` then
 * `shift` on a short array reallocates the array's storage each time,
 * which on a connection running one query at a time is garbage on every
 * query.
 */
export class Queue<T> {
	#items: (T | undefined)[] = [];
	#head = 0;
	#tail = 0;

	get length(): number {
		return this.#tail - this.#head;
	}

	/** The item `index` places from the front. */
	at(index: number): T | undefined {
		return index >= 0 && index < this.#tail - this.#head
			? this.#items[this.#head + index]
			: undefined;
	}

	push(item: T): void {
		this.#items[this.#tail++] = item;
	}

	shift(): T | undefined {
		if (this.#head === this.#tail) return undefined;
		const items = this.#items;
		const item = items[this.#head];
		items[this.#head++] = undefined;
		if (this.#head === this.#tail) {
			this.#head = 0;
			this.#tail = 0;
		} else if (this.#head >= 1024 && this.#head * 2 >= this.#tail) {
			// never empty (a busy pipeline): move the items down now and then
			items.copyWithin(0, this.#head, this.#tail);
			items.fill(undefined, this.#tail - this.#head, this.#tail);
			this.#tail -= this.#head;
			this.#head = 0;
		}
		return item;
	}

	/** Removes the item `index` places from the front. */
	removeAt(index: number): void {
		if (index < 0 || index >= this.#tail - this.#head) return;
		this.#items.splice(this.#head + index, 1);
		this.#tail--;
	}

	indexOf(item: T): number {
		for (let i = this.#head; i < this.#tail; i++)
			if (this.#items[i] === item) return i - this.#head;
		return -1;
	}

	find(predicate: (item: T) => boolean): T | undefined {
		for (let i = this.#head; i < this.#tail; i++) {
			const item = this.#items[i];
			if (item !== undefined && predicate(item)) return item;
		}
		return undefined;
	}

	/** Removes and returns every item. */
	drain(): T[] {
		const items = this.#items.slice(this.#head, this.#tail);
		this.#items = [];
		this.#head = 0;
		this.#tail = 0;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the live range holds no holes
		return items as T[];
	}
}
