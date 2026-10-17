# Data types

The classes here describe **SQL types**: what Postgres calls `integer`, `text`, `user_status` or `citext`. A `DataType` holds a type's `kind` (which picks its comparison methods), the driver codec its values are sent and read with, and its modifiers (`varchar(320)`). Columns and expressions share them.

| File                         | Class                                                                    | Kind       |
| ---------------------------- | ------------------------------------------------------------------------ | ---------- |
| [data-type.ts](data-type.ts) | `DataType<K>`: the base, used directly for every built-in type           | any        |
| [array.ts](array.ts)         | `ArrayType<E>`: an array of `E`; codec `arrayOf(E.codec)`                | `'array'`  |
| [enum.ts](enum.ts)           | `EnumType<N>`: a Postgres enum named `N`; a text codec looked up by name | `'enum'`   |
| [custom.ts](custom.ts)       | `CustomType<N>`: a type `defineType` declares; your codec                | `'custom'` |

How they are made, what they decide and why is in [../column/README.md](../column/README.md#data-types-the-sql-side). How a kind turns into comparison methods is in [../EXPRESSIONS.md](../EXPRESSIONS.md), and the codecs themselves are in [../driver/CODECS.md](../driver/CODECS.md).
