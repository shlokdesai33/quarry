export type ColumnType = 'text' | 'integer' | 'boolean' | 'timestamptz';

export type TsTypeOf<T extends ColumnType> = T extends 'text'
  ? string
  : T extends 'integer'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'timestamptz'
        ? Date
        : never;

export type TableSchema = Record<string, ColumnType>;

export type RowOf<S extends TableSchema> = {
  [K in keyof S]: TsTypeOf<S[K]>;
};

export interface Table<Name extends string, S extends TableSchema> {
  readonly name: Name;
  readonly columns: S;
}

export interface CompiledQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}
