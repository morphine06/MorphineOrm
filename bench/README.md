# Benchmark: MorphineOrm, Drizzle and Prisma

Compares the most frequent queries of an application on MySQL / MariaDB.

```sh
npm run bench                 # from the root of the repository
BENCH_N=500 npm run bench     # fewer iterations
```

It uses the test database of `../.env.local` and **empties the tables `Species2`, `Breeds2` and `Animals2`**.

## Method

- Same tables for the three ORMs: the example models of `../models` (20 species, 200 breeds, 10,000 animals).
- MorphineOrm and Drizzle use the `mysql2` driver; Prisma 7 uses its MariaDB driver adapter (`@prisma/adapter-mariadb`), the one it requires for MySQL and MariaDB. A pool of 10 connections for each.
- Each case runs 3 rounds, alternating the ORMs, after a warm-up; the median round is kept. The time is per operation.
- Before measuring, the script checks that the three ORMs return the same data.
- The cases compare what each ORM needs to get the same result: when a "complete row" is expected, Drizzle reads it back with a second query (it has no `RETURNING` on MySQL), as MorphineOrm and Prisma do internally.

## Results

MariaDB 11.6.2 on the same machine, Node 22.22, MorphineOrm 2, Drizzle 0.45.4, Prisma 7.10.1, 2,000 iterations per case.

| Case                                            | MorphineOrm | Drizzle         | Prisma           |
| ----------------------------------------------- | ----------- | --------------- | ---------------- |
| findone by id                                   | 91 µs       | 149 µs (×1.6)   | 205 µs (×2.3)    |
| findone by id (Drizzle `prepare()`)             | 89 µs       | 90 µs (×1.0)    | —                |
| findone by id, 50 in parallel                   | 36 µs       | 114 µs (×3.2)   | 36 µs (×1.0)     |
| filtered, sorted, paginated list (20 rows)      | 313 µs      | 358 µs (×1.1)   | 440 µs (×1.4)    |
| list + 2 associated models (20 rows)            | 789 µs      | 1.89 ms (×2.4)  | 865 µs (×1.1)    |
| list + 2 associated models (Drizzle relational) | —           | error           | —                |
| filtered count                                  | 1.35 ms     | 1.23 ms (×0.9)  | 1.26 ms (×0.9)   |
| a breed and its ~50 animals                     | 260 µs      | 380 µs (×1.5)   | 661 µs (×2.5)    |
| insert 1 row, complete row returned             | 305 µs      | 353 µs (×1.2)   | 576 µs (×1.9)    |
| insert 1 row, id only                           | 180 µs      | 187 µs (×1.0)   | 492 µs (×2.7)    |
| update by id, complete row returned             | 276 µs      | 331 µs (×1.2)   | 653 µs (×2.4)    |
| update by id, number of rows only               | 166 µs      | 181 µs (×1.1)   | 221 µs (×1.3)    |
| insert 1,000 rows                               | 26.39 ms    | 21.18 ms (×0.8) | 114.70 ms (×4.3) |
| delete by id                                    | 170 µs      | 178 µs (×1.0)   | 552 µs (×3.2)    |

×N: the time divided by MorphineOrm's (×1.6 = 1.6 times slower, ×0.8 = faster).

## Reading the results

- **Reads**: the difference is the cost of building the query and mapping the rows in JavaScript. Drizzle pays it at each call, unless the query is prepared with `prepare()`, which brings it level with MorphineOrm. This cost shows most when the queries run in parallel, since it is CPU time.
- **Associated models**: MorphineOrm loads them with `LEFT JOIN`s in one query, including the one-to-many children. Prisma sends one query per relation. Drizzle's relational API (`db.query…with`) **does not work on MariaDB**: it uses `LATERAL` joins, which MariaDB refuses; only the manual joins remain.
- **Writes**: returning the complete row costs a second query for the three of them on MySQL. Prisma also opens a transaction around each write.
- **Insert of 1,000 rows**: MorphineOrm runs the hooks, the computed values and the validation of each row, in a transaction, and returns the ids (with `RETURNING` on MariaDB). Drizzle deduces the ids from `insertId`. Prisma only returns the number of rows (`createManyAndReturn` does not exist on MySQL).

## Limits

- Local database: a round trip costs almost nothing, so the CPU time of the ORMs dominates. With a remote database (about 1 ms per round trip), the read differences shrink, and every additional query (relations loaded by separate queries, rows read back after a write) weighs more.
- MySQL / MariaDB only: PostgreSQL and SQLite are not measured.
- `npm audit` reports a vulnerability (ReDoS in `effect`) in the Prisma CLI, used here only for `prisma generate`; it is not in MorphineOrm nor in what it publishes.
