# MorphineOrm

A small ORM for Node.js where you keep writing SQL.

- Models are plain JavaScript objects.
- Queries are plain SQL `WHERE` clauses with `?` placeholders: no new query language to learn.
- Associations are loaded with `LEFT JOIN`s in a single query, never with nested selects.
- Tables, columns, indexes and foreign keys are synchronized with your models at startup.
- Supports MySQL / MariaDB (`mysql2`), PostgreSQL (`pg`) and SQLite (`sqlite3`).

## Quick look

```js
const { Models } = require("morphine-orm");
const { Dogs } = Models;

// create a record: you get the complete row back
const rex = await Dogs.create({ name: "Rex", birth: "2019-10-06", kindId: 1 }).exec();
// rex = {
//    id: 1,
//    name: "Rex",
//    birth: "2019-10-06",
//    kindId: 1,
//    createdAt: "2024-10-06 12:00:00",
//    updatedAt: "2024-10-06 12:00:00",
// }

// find records with a plain SQL condition, even on an associated model
const dogs = await Dogs.find("birth>? AND kind.name LIKE ?", ["2015-01-01", "Lab%"])
  .populate("kind")
  .orderBy("Dogs.name")
  .exec();
// dogs = [
//    {
//       id: 1,
//       name: "Rex",
//       birth: "2019-10-06",
//       kindId: 1,
//       createdAt: "2024-10-06 12:00:00",
//       updatedAt: "2024-10-06 12:00:00",
//       kind: { id: 1, name: "Labrador", createdAt: "…", updatedAt: "…" },
//    },
// ]

// find one record by its primary key
const dog = await Dogs.findone(1).populate("kind").exec();
```

## Installation

```sh
npm install morphine-orm
```

Then install the driver of your database:

- MySQL or MariaDB: `npm install mysql2`
- PostgreSQL: `npm install pg`
- SQLite: `npm install sqlite3`

Node.js 20 or later is required.

## Usage

### 1. Define models

A model is a file named `<ModelName>.model.js` that exports a function returning the model definition.

```js
// /models/Dogs.model.js
module.exports = function () {
  return {
    tableName: "dogs", // optional, defaults to the model name ("Dogs")
    attributes: {
      id: {
        type: "integer",
        autoincrement: true,
        primary: true,
      },
      name: {
        type: "string",
        defaultsTo: "",
        index: true,
        validator: { fn: "isLength", args: { min: 2, max: 255 } },
      },
      birth: {
        type: "date",
        defaultsTo: "0000-00-00",
        notnull: false,
        index: true,
      },
      kindId: {
        model: "Kinds", // foreign key to the Kinds model
        alias: "kind", // name used by populate()
        onDelete: "RESTRICT", // RESTRICT, CASCADE, SET NULL
        onUpdate: "RESTRICT",
      },
    },
    virtuals: {
      // computed after each read; `this` is the row
      age: function () {
        if (!this.birth || this.birth.startsWith("0000")) return null;
        return new Date().getFullYear() - new Date(this.birth).getFullYear();
      },
    },
    beforeCreate: async function (data) {
      // change `data` before the INSERT
    },
    beforeUpdate: async function (data) {
      // change `data` before the UPDATE
    },
  };
};
```

```js
// /models/Kinds.model.js
module.exports = function () {
  return {
    attributes: {
      id: {
        type: "integer",
        autoincrement: true,
        primary: true,
      },
      name: {
        type: "string",
        defaultsTo: "",
        index: true,
      },
    },
  };
};
```

The model name is the file name without `.model.js`. Every model gets two `datetime` columns, `createdAt` and `updatedAt`, filled automatically; set `useCreatedAt: false` or `useUpdatedAt: false` to opt out.

#### Attribute options

| Option          | Description                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | column type (see below)                                                                                                                        |
| `length`        | column length, e.g. `100` for a `VARCHAR(100)` or `"12,4"` for a decimal                                                                       |
| `primary`       | primary key                                                                                                                                    |
| `autoincrement` | auto-incremented column                                                                                                                        |
| `defaultsTo`    | default value, used in the table definition and when a value is missing; or a function `(data) => value` computed at each creation (see below) |
| `onUpdate`      | a function `(data) => value` computed at each update when the attribute is not in the data (a string is a foreign key rule, see below)         |
| `unique`        | create a unique index on the column                                                                                                            |
| `values`        | the list of the values of an `enum`                                                                                                            |
| `notnull`       | columns are `NOT NULL` by default; set `notnull: false` to allow `NULL`                                                                        |
| `index`         | create an index on the column                                                                                                                  |
| `model`         | foreign key to another model; the column takes the type of its primary key                                                                     |
| `alias`         | name of the associated object, used by `populate()`                                                                                            |
| `onDelete`      | `RESTRICT`, `CASCADE` or `SET NULL`; creates the foreign key constraint                                                                        |
| `onUpdate`      | `RESTRICT`, `CASCADE` or `SET NULL`; creates the foreign key constraint                                                                        |
| `validator`     | `{ fn, args }`: a rule checked before each write (see below)                                                                                   |

#### Computed values

```js
attributes: {
  code: { type: "string", defaultsTo: () => crypto.randomUUID() },
  slug: { type: "string", defaultsTo: (data) => data.title.toLowerCase() },
  editedBy: { type: "string", defaultsTo: "", onUpdate: (data) => currentUser() },
},
```

A `defaultsTo` function runs at each `create()` / `createMany()` when the attribute is missing or `null` (and in `createEmpty()`); the column has no `DEFAULT` in the database. An `onUpdate` function runs at each `update()` / `updateone()` when the attribute is not in the data. Both run after the `beforeCreate` / `beforeUpdate` hooks, so that a hook can provide the value.

#### Indexes and constraints

```js
module.exports = function () {
  return {
    attributes: {
      id: { type: "integer", autoincrement: true, primary: true },
      email: { type: "string", defaultsTo: "", unique: true },
      firstname: { type: "string", defaultsTo: "" },
      lastname: { type: "string", defaultsTo: "" },
      age: { type: "integer", defaultsTo: 0 },
    },
    // composite indexes, unique or not (name optional)
    indexes: [
      { fields: ["lastname", "firstname"] },
      { fields: ["firstname", "age"], unique: true, name: "members_firstname_age_u" },
    ],
    // CHECK constraints: name → SQL expression
    checks: { age_positive: "age >= 0" },
  };
};
```

`migrate: "alter"` creates the missing indexes and constraints, also on an existing table. It never changes the data: if the table has duplicates for a unique index, or rows that break a constraint, the index or constraint is not created and a warning says so; it is created at the next start once the data is fixed. Indexes and constraints removed from the model are not dropped. SQLite cannot add a constraint to an existing table.

#### Types

`integer` (or `int`), `tinyint`, `smallint`, `mediumint`, `bigint`, `float`, `double`, `decimal` (or `price`), `boolean`, `string` (or `varchar`), `char`, `text`, `tinytext`, `mediumtext`, `longtext`, `json`, `date`, `datetime`, `time`, `year`, `blob`, `tinyblob`, `mediumblob`, `longblob`, `binary`, `varbinary`, `bit`, `enum`, `set`.

- `json` is stored as text: objects are serialized on write and parsed on read.
- `boolean` is stored as a tinyint (a smallint on PostgreSQL) and read back as `true` / `false`.
- `enum` takes its list in `values: ["S", "M", "L"]`. Without `defaultsTo`, a missing value is the first one. A value out of the list is refused before the write (`E_VALIDATION` error, `error: "enum"`). In the database it is an `ENUM` on MySQL, and a text column with a `CHECK` on PostgreSQL and SQLite; `migrate: "alter"` follows the changes of the list (except on SQLite).

#### Validation

`validator: { fn, args }` checks the value with the function `fn` of the [validator](https://github.com/validatorjs/validator.js#validators) library (`isEmail`, `isLength`, `isInt`, `isIn`…), called with the value as a string and `args` as options. The rule applies to the attributes present in the data of `create()`, `update()`, `updateone()` and `replace()`; `null` values are not checked.

When a rule fails, nothing is written and `exec()` throws an error, whatever `catchError` is:

```js
try {
  await Dogs.create({ name: "R" }).exec();
} catch (error) {
  // error.code = "E_VALIDATION"
  // error.errors = [{ field: "name", error: "isLength", args: { min: 2, max: 255 } }]
  // (with the logValues option, each error also has the refused value)
}
```

### 2. Initialize the ORM

Initialize the ORM when your application starts, **before requiring the code that uses the models**.

```js
// /app.js
const { MorphineDb, loadModels } = require("morphine-orm");

await MorphineDb.init({
  // options for the ORM
  type: "mysql2", // mysql2, pg, sqlite3
  migrate: "alter", // alter, safe or recreate
  debug: false,
  catchError: true,

  // options passed to the database driver
  host: process.env.DBHOST,
  user: process.env.DBUSER,
  password: process.env.DBPASSWORD,
  database: process.env.DBNAME,
  port: 3306,
  dateStrings: true,
});
await loadModels("./models");
```

- `migrate: "alter"` creates the missing tables, adds the missing columns and indexes, changes the columns whose type, default value or `NOT NULL` changed, and creates the foreign key constraints. It never drops a table or a column, and never changes the data: if some rows point to a record that does not exist, the foreign key is not created and a warning tells how many rows to fix. On PostgreSQL, a column that becomes `NOT NULL` first gets its default value (or `0`, `""`, the current date) where it is `NULL`, and a type change converts the values with `USING column::type`, which fails if a value cannot be converted. SQLite cannot modify a column: the change is only logged.
- `migrate: "safe"` (default) leaves the database untouched.
- `migrate: "recreate"` drops the tables of all the models, then creates them again: **all their data is deleted** at each start. It is refused when `NODE_ENV=production`.
- `debug: true` logs every SQL query.
- `catchError: true` throws database errors. With `catchError: false` (default), errors are logged and the query returns `null` (or an empty array for a select).
- `quietMigration: true` hides the logs of the schema changes made by `migrate: "alter"`.
- `logValues: true` shows the values of the queries in the SQL error logs and in the validation errors. They are hidden by default, since they can be passwords or personal data (`debug: true` always shows them).
- `engine` and `collation` set the table options on MySQL (defaults: `InnoDB`, `utf8mb4_general_ci`). A model can override them with its own `engine` and `collation`.
- With SQLite, `database` is the file name without the `.sqlite` extension.
- `sqlMode` sets the MySQL `sql_mode` of each connection (default: `""`, which accepts the `0000-00-00` dates and the foreign keys at 0 that the ORM writes). With `"STRICT_TRANS_TABLES"`, MySQL refuses a too long string or an invalid number instead of truncating it.
- MySQL and PostgreSQL use a pool of connections: `connectionLimit` (default `10`; `max` is also accepted on PostgreSQL), `queueLimit`, `idleTimeout` and the other pool options of the driver can be passed. A connection lost (server restart, network) is replaced at the next query.

`init()` checks the connection: it throws if the database cannot be reached (server down, wrong password…), instead of letting the application start without a database.

`loadModels(dir)` loads every `*.model.js` file in `dir` and its subfolders (default: `./models`).

When your script is done, close the connection with `await MorphineDb.close()`.

### 3. Conditions

Every method that takes a condition (`find`, `findone`, `count`, `update`, `updateone`, `destroy`) accepts it in three forms:

```js
// a primary key
await Dogs.findone(1).exec();

// an object: equality on each key, joined with AND
await Dogs.find({ kindId: 1, name: "Rex" }).exec();

// a SQL condition with ? placeholders and an array of values
await Dogs.find("kindId=? AND (name LIKE ? OR name LIKE ?)", [1, "Jazz", "%e%"]).exec();
```

In an object condition:

```js
await Dogs.find({ nickname: null }).exec(); // nickname IS NULL
await Dogs.find({ id: [1, 2, 3] }).exec(); // id IN (1, 2, 3) ; [] matches nothing
await Dogs.find({ legs: { gte: 2, lt: 6 } }).exec(); // legs >= 2 AND legs < 6
await Dogs.find({ name: { like: "R%" }, kindId: { ne: null } }).exec();
await Dogs.find({ $or: [{ legs: { lt: 2 } }, { name: "Rex" }] }).exec();
await Dogs.find({ "kind.name": { in: ["Labrador", "Poodle"] } })
  .populate("kind")
  .exec();
```

| Operator          | SQL                                               |
| ----------------- | ------------------------------------------------- |
| `eq`, `ne`        | `=`, `<>` (`IS NULL`, `IS NOT NULL` with `null`)  |
| `gt`, `gte`       | `>`, `>=`                                         |
| `lt`, `lte`       | `<`, `<=`                                         |
| `in`, `notIn`     | `IN (…)`, `NOT IN (…)`                            |
| `like`, `notLike` | `LIKE`, `NOT LIKE` (case-sensitive on PostgreSQL) |
| `between`         | `BETWEEN min AND max`, with `[min, max]`          |
| `isNull`          | `IS NULL` (`true`) or `IS NOT NULL` (`false`)     |

Several operators on a column, and several columns, are joined with `AND`; `$or` and `$and` take an array of object conditions, and can be nested. An unknown operator throws an `E_INVALID_WHERE` error. `undefined` matches nothing (`= NULL`): a missing id never becomes "every row". As in SQL, `ne` does not match the rows where the column is `NULL`.

In a SQL condition, columns can be prefixed with the model name (`Dogs.name`) or with the alias path of a populated association (`kind.name`, `kind.family.name`).

`update`, `updateone` and `destroy` refuse to run without a condition: an empty condition would touch every row. Use `truncate()` or `drop()` to empty a table on purpose.

#### Security: never pass user input as a SQL condition

**A string condition is SQL, inserted as is.** Values must always go through `?` placeholders or the object form, which are escaped by the driver:

```js
// DANGEROUS: req.params.id = "0 OR 1=1" deletes every row
await Dogs.destroy(req.params.id).exec();

// safe
await Dogs.destroy(Number(req.params.id)).exec();
await Dogs.destroy({ id: req.params.id }).exec();
await Dogs.destroy("id=?", [req.params.id]).exec();
```

The ORM protects what it can:

- a string that is only a number (`"12"`, `" 12"`, `"0xc"`, `"12e0"`) is read as a primary key, never as SQL (`WHERE 0xc` would be true for every row);
- the keys of an object condition must be column names (`name`, `Dogs.name`, `kind.name`); anything else throws an `E_INVALID_WHERE` error, so `find(req.query)` cannot inject SQL;
- `create` and `update` only write the attributes of the model, whatever the other keys of the data.

`select()`, `orderBy()`, `groupBy()` and `having()` are also inserted as SQL: never build them from user input (choose the sort column from a fixed list).

### 4. Create a record

```js
const { Models } = require("morphine-orm");
const { Dogs } = Models;

const jazz = await Dogs.create({ name: "Jazz", birth: "2019-10-06", kindId: 1 })
  .populate("kind")
  .exec();
// jazz = {
//    id: 2,
//    name: "Jazz",
//    birth: "2019-10-06",
//    kindId: 1,
//    createdAt: "…",
//    updatedAt: "…",
//    kind: { id: 1, name: "Labrador", … },
// }

// exec(false), or returnRow(false), returns only the id of the new record
const id = await Dogs.create({ name: "Newton" }).exec(false);
const id2 = await Dogs.create({ name: "Newton" }).returnRow(false).exec();
```

Missing attributes take their `defaultsTo` value (or `0` / `""` according to their type).

`createMany(rows)` creates several records and returns them in the same order (or their ids with `returnRow(false)`). Each row goes through the hooks, the computed values and the validation; it is all or nothing, in a single transaction. The rows are inserted by batches of one query (with `RETURNING` on PostgreSQL, SQLite and MariaDB 10.5+), or one query per row on MySQL, where only that gives reliable ids.

```js
const dogs = await Dogs.createMany([
  { name: "Rex", kindId: 1 },
  { name: "Jazz", kindId: 1 },
])
  .populate("kind")
  .exec();
```

### 5. Find records

```js
const dog = await Dogs.findone(1).exec(); // the row, or null
const dogs = await Dogs.find({ kindId: 1 }).exec(); // always an array
const all = await Dogs.find().exec();

// select only some columns
const names = await Dogs.find().select(["name", "birth"]).exec(); // or .select("name, birth")

// sort
const sorted = await Dogs.find().orderBy("Dogs.birth DESC").exec();

// group
const byKind = await Dogs.find()
  .select("Dogs.kindId, count(*) AS nb")
  .groupBy("Dogs.kindId")
  .having("count(*) > 1")
  .exec();
// byKind = [{ kindId: 1, nb: 3 }] (nb is the string "3" on PostgreSQL, where count() is a bigint)

// pagination
const page2 = await Dogs.find().orderBy("Dogs.name").limit(20).offset(20).exec();

// count (only a COUNT() query is sent)
const nb = await Dogs.count({ kindId: 1 }).exec();

// sum, average, minimum, maximum (null when no row matches)
const total = await Dogs.sum("legs").exec();
const average = await Dogs.avg("legs", { kindId: 1 }).exec();
const youngest = await Dogs.max("birth", "kind.name=?", ["Labrador"]).populate("kind").exec();
const oldest = await Dogs.min("birth").exec();
```

### 6. Associations

#### Many-to-one: `populate()`

`populate(alias)` adds the associated record to each row. Use a dotted path to go deeper.

```js
const dog = await Dogs.findone(1).populate("kind").populate("kind.family").exec();
// dog.kind = { id: 1, name: "Labrador", familyId: 3, family: { id: 3, name: "Retrievers" } }

// populate every association, recursively (up to 3 levels by default)
const dogs = await Dogs.find().populateAll().exec();
// exclude some paths and choose the depth
const dogs2 = await Dogs.find().populateAll(["kind.family"], 2).exec();
```

#### One-to-many: `onetomany()`

`onetomany(model, alias, as)` adds an array of the records of `model` whose association `alias` points to the current row.

```js
// each kind with the array of its dogs
const kinds = await Kinds.find().onetomany("Dogs", "kind", "dogs").populateAll().exec();
// kinds = [
//    { id: 1, name: "Labrador", dogs: [{ id: 1, name: "Rex", … }, { id: 2, name: "Jazz", … }] },
// ]
```

With `onetomany()`, `limit()` and `offset()` count the parents, not their children: a first query chooses the parents of the page (the `orderBy()` must then only use their columns), and the second one loads them with all their children.

#### Many-to-many

Many-to-many associations are not automated: create a join model with two `model` attributes and query it with `populate()`.

### 7. Update records

```js
// one record: returns the updated row
const rexy = await Dogs.updateone(1, { name: "Rexy" }).exec();
await Dogs.updateone({ name: "Roxy" }, { birth: "2020-01-01" }).exec();
await Dogs.updateone("id=?", [1], { name: "Rexy" }).exec();

// several records: returns the array of updated rows
await Dogs.update({ kindId: 1 }, { birth: "2020-01-01" }).exec();
await Dogs.update("kindId=?", [1], { birth: "2020-01-01" }).exec();

// exec(false) returns the number of affected rows
const nb = await Dogs.update({ kindId: 1 }, { kindId: 2 }).exec(false);
```

`updateone()` modifies a single row: it throws an `E_UPDATEONE_MANY` error, and changes nothing, if its condition matches several rows. Use `update()` to modify several rows.

The updated rows are read back with the same condition: if the update changes a column used in the condition, the rows no longer match it and you get `[]` (or `null` for `updateone`). Use `exec(false)` in that case.

Only the attributes of the model are written; other keys are ignored. `updatedAt` is set automatically (pass `ignoreUpdatedAt: true` in the data to keep it).

`replace(data)` updates the record whose primary key is in `data`, or creates it if it does not exist.

### 8. Delete records

```js
await Dogs.destroy(1).exec();
await Dogs.destroy({ kindId: 1 }).exec();
await Dogs.destroy("kindId=?", [1]).exec();
// returns the number of deleted rows

await Dogs.truncate().exec(); // empty the table
await Dogs.drop().exec(); // drop the table
```

### 9. Your own SQL queries

```js
const { MorphineDb } = require("morphine-orm");

// returns the rows (or the driver result for a write)
const rows = await MorphineDb.query("SELECT * FROM dogs WHERE name=? AND kindId=?", ["Roxy", 1]);

// same thing through a model
const rows2 = await Dogs.query("SELECT * FROM dogs WHERE kindId=?", [1]).exec();
```

The connections are shared by the whole application through the pool: a raw query must not leave anything on its connection.

- A single statement per query (`"SELECT 1; DROP TABLE x"` is refused on MySQL and PostgreSQL).
- The statements that would change the state of the connection are refused with an `E_SESSION_STATEMENT` error: `BEGIN`, `START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SET`, `USE`, `LOCK`, `XA`, `CREATE TEMPORARY TABLE`… Use `MorphineDb.transaction()` for a transaction, and the `sqlMode` and `collation` options of `init()` for the session settings.
- Whatever the query did, its connection is reset before going back to the pool (MySQL `COM_RESET_CONNECTION`, PostgreSQL `DISCARD ALL`): session variables, temporary tables and locks (`GET_LOCK()`, `pg_advisory_lock()`…) do not survive it, and an open transaction is rolled back. This costs one round trip more for raw queries only: the queries built by the models are not concerned.

### 10. Transactions

`MorphineDb.transaction(fn)` runs `fn` in a transaction: it is committed when `fn` ends, and rolled back if `fn` throws (the error is thrown again). It returns what `fn` returns.

```js
const dog = await MorphineDb.transaction(async (tx) => {
  const kind = await Kinds.create({ name: "Labrador" }).exec();
  const dog = await Dogs.create({ name: "Rex", kindId: kind.id }).exec();
  await tx.query("UPDATE stats SET dogs = dogs + 1");
  if (!dog.kindId) throw new Error("no kind"); // rolls back both creations
  return dog;
});
```

- Every query started from `fn`, by the models or by `MorphineDb.query()` / `tx.query()`, goes through the transaction, even in the functions that `fn` calls.
- Inside a transaction, a SQL error always throws (whatever `catchError` is), so that the transaction is rolled back.
- A `transaction()` called inside another one joins it: there is a single transaction, committed or rolled back as a whole.
- The other queries of the application do not see the changes until the commit. With SQLite, which has a single connection, they wait for the end of the transaction.
- `tx.query()` accepts `SAVEPOINT`, `RELEASE SAVEPOINT`, `ROLLBACK TO SAVEPOINT`, `SET LOCAL` and `SET TRANSACTION`, which do not outlive the transaction; the connection is reset at its end, like after a raw query.

### 11. Hooks

A model can define these async functions:

| Hook                              | Called before | `this` and arguments                     |
| --------------------------------- | ------------- | ---------------------------------------- |
| `beforeCreate(data)`              | an INSERT     | the data to insert, which you can modify |
| `beforeUpdate(data)`              | an UPDATE     | the data to update, which you can modify |
| `beforeDestroy(where, whereData)` | a DELETE      | the condition and its values             |
| `beforeTruncate()`                | a TRUNCATE    |                                          |
| `beforeDrop()`                    | a DROP        |                                          |

And these ones, called once the write is done, with `this` = the model:

| Hook                                    | Called after                  | Arguments                                                     |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `afterCreate(row, data)`                | each created record           | the created record (complete, or the data with its id)        |
| `afterUpdate(result, data)`             | an `update()` / `updateone()` | what `exec()` returns (row, rows or number of rows), the data |
| `afterDestroy(count, where, whereData)` | a `destroy()`                 | the number of deleted rows, the condition and its values      |

In a transaction, the queries of an `after*` hook belong to it, and are rolled back with it. An error thrown by an `after*` hook makes `exec()` throw, but the write is already done (unless it is in a transaction).

### 12. Other methods

```js
// a new record filled with the default values, to prefill a form
const empty = Dogs.createEmpty();
// empty = { id: 0, name: "", birth: "0000-00-00", kindId: 0, createdAt: null, updatedAt: null }

// log the SQL query of one call
await Dogs.find().debug().exec();

Dogs.getPrimary(); // "id"
Dogs.getAttributes(); // { id: { type: "integer", … }, name: { … }, … }
Dogs.getAttributesEntries(); // [["id", { … }], ["name", { … }], …]
```

## Benchmark

`npm run bench` compares MorphineOrm with Drizzle and Prisma on the most frequent queries (MySQL / MariaDB). See [bench/README.md](bench/README.md) for the method and the results: MorphineOrm is as fast as or faster than both on reads and single-row writes, and Drizzle is faster on bulk inserts.

## Tests

The same test suite runs against each database:

```sh
npm test             # MySQL / MariaDB (same as npm run test-mysql)
npm run test-sqlite  # SQLite, in a throwaway morphineorm-test.sqlite file
npm run test-pg      # PostgreSQL
```

The connections are read from `.env.local`:

```sh
# MySQL / MariaDB
DBHOST="localhost"
DBUSER="root"
DBPASSWORD="…"
DBNAME="morphineorm"
DBPORT="3306"

# PostgreSQL (defaults: localhost, postgres, no password, morphineorm, 5432)
PGHOST="localhost"
PGUSER="postgres"
PGPASSWORD="…"
PGDATABASE="morphineorm"
PGPORT="5432"
```

The tests create, empty and drop the tables of the models in `/models`: use a dedicated database.

## License

[MIT](LICENSE)
