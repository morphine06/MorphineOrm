// Banc d'essai MorphineOrm / Drizzle / Prisma sur MySQL ou MariaDB.
//
// Mêmes tables (les modèles d'exemple de ../models), même base (celle des tests,
// lue dans ../.env.local), pool de 10 connexions pour chacun. Chaque cas est
// mesuré en 3 manches alternées après échauffement ; on garde la médiane.
//
//   cd bench && npm install && npm run bench
//   BENCH_N=500 npm run bench     # moins d'itérations
//
// ATTENTION : vide les tables Species2, Breeds2 et Animals2 de cette base.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { mysqlTable, int, varchar, date, tinyint, text, datetime } from "drizzle-orm/mysql-core";
import { relations, eq, gte, gt, asc, count, sql } from "drizzle-orm";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(root + "/");
require("dotenv").config({ path: path.join(root, ".env.local"), quiet: true });
const { MorphineDb, Models, loadModels } = require(path.join(root, "index.js"));

const N = Number(process.env.BENCH_N || 2000);
const conn = {
  host: process.env.DBHOST,
  user: process.env.DBUSER,
  password: process.env.DBPASSWORD,
  database: process.env.DBNAME,
  port: Number(process.env.DBPORT),
};

// ---------- MorphineOrm ----------
await MorphineDb.init({
  ...conn,
  type: "mysql2",
  migrate: "alter",
  catchError: true,
  quietMigration: true,
  dateStrings: true,
});
await loadModels(path.join(root, "models"));
const { Animals, Breeds, Species } = Models;

// ---------- Drizzle ----------
const ts = () => ({
  createdAt: datetime({ mode: "string" }),
  updatedAt: datetime({ mode: "string" }),
});
const species = mysqlTable("Species2", {
  id: int().primaryKey().autoincrement(),
  name: varchar({ length: 255 }),
  ...ts(),
});
const breeds = mysqlTable("Breeds2", {
  id: int().primaryKey().autoincrement(),
  speciesId: int(),
  name: varchar({ length: 255 }),
  ...ts(),
});
const animals = mysqlTable("Animals2", {
  id: int().primaryKey().autoincrement(),
  name: varchar({ length: 255 }),
  birth: date({ mode: "string" }),
  legs: int(),
  vaccinated: tinyint(),
  infos: text(),
  breedId: int(),
  ...ts(),
});
const schema = {
  species,
  breeds,
  animals,
  animalsRel: relations(animals, ({ one }) => ({
    breed: one(breeds, { fields: [animals.breedId], references: [breeds.id] }),
  })),
  breedsRel: relations(breeds, ({ one, many }) => ({
    species: one(species, { fields: [breeds.speciesId], references: [species.id] }),
    animals: many(animals),
  })),
};
// même pool que MorphineOrm : 10 connexions, utf8mb4, sql_mode vide
const pool = mysql.createPool({
  ...conn,
  dateStrings: true,
  charset: "utf8mb4",
  connectionLimit: 10,
});
pool.pool.on("connection", (c) => c.query("SET SESSION sql_mode = ''"));
const db = drizzle(pool, { schema, mode: "default" });

// ---------- Prisma (7, adaptateur MariaDB, qui sert aussi MySQL) ----------
const prisma = new PrismaClient({ adapter: new PrismaMariaDb({ ...conn, connectionLimit: 10 }) });
await prisma.$connect();

// ---------- jeu de données : 20 espèces, 200 races, 10 000 animaux ----------
async function reset() {
  for (const t of ["Animals2", "Breeds2", "Species2"]) {
    await MorphineDb.query(`DELETE FROM ${t} WHERE id > 0`);
  }
}
await reset();
const sp = await Species.createMany(Array.from({ length: 20 }, (_, i) => ({ name: "Espèce " + i })))
  .returnRow(false)
  .exec();
const br = await Breeds.createMany(
  Array.from({ length: 200 }, (_, i) => ({ name: "Race " + i, speciesId: sp[i % 20] })),
)
  .returnRow(false)
  .exec();
const an = await Animals.createMany(
  Array.from({ length: 10000 }, (_, i) => ({
    name: "Animal " + i,
    breedId: br[i % 200],
    legs: i % 5,
    birth: "2020-01-01",
  })),
)
  .returnRow(false)
  .exec();

const pick = (arr, i) => arr[(i * 7919) % arr.length];
const now = "2026-01-01 00:00:00";
const row = (i) => ({ name: "Nouveau " + i, breedId: pick(br, i), legs: 4, birth: "2021-01-01" });
const drizzleRow = (i) => ({ ...row(i), vaccinated: 0, infos: "", createdAt: now, updatedAt: now });
const prismaRow = (i) => ({
  ...row(i),
  birth: new Date("2021-01-01"),
  vaccinated: 0,
  infos: "",
  createdAt: new Date(),
  updatedAt: new Date(),
});

// ---------- les trois rendent-ils les mêmes données ? ----------
{
  const m = await Animals.find()
    .populate("breed")
    .populate("breed.species")
    .orderBy("Animals.id")
    .limit(20)
    .exec();
  const d = await db
    .select()
    .from(animals)
    .leftJoin(breeds, eq(animals.breedId, breeds.id))
    .leftJoin(species, eq(breeds.speciesId, species.id))
    .orderBy(asc(animals.id))
    .limit(20);
  const p = await prisma.animal.findMany({
    include: { breed: { include: { species: true } } },
    orderBy: { id: "asc" },
    take: 20,
  });
  const ok = m.every(
    (r, i) =>
      r.breed.species.name === d[i].Species2.name &&
      r.breed.species.name === p[i].breed.species.name,
  );
  if (!ok) throw new Error("les trois ORM ne rendent pas les mêmes données");
}

// ---------- mesure ----------
async function measure(fn, n, parallel) {
  for (let i = 0; i < Math.min(50, n); i++) await fn(i); // échauffement
  const t = process.hrtime.bigint();
  if (parallel === 1) for (let i = 0; i < n; i++) await fn(i);
  else
    for (let i = 0; i < n; i += parallel) {
      await Promise.all(Array.from({ length: parallel }, (_, j) => fn(i + j)));
    }
  return Number(process.hrtime.bigint() - t) / 1000 / n; // µs par opération
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const results = [];
async function bench(label, { n = N, parallel = 1, morphine, drizzle, prisma }) {
  const impl = { morphine, drizzle, prisma };
  const runs = { morphine: [], drizzle: [], prisma: [] };
  const errors = {};
  for (let round = 0; round < 3; round++) {
    for (const [orm, fn] of Object.entries(impl)) {
      if (!fn || errors[orm]) continue;
      try {
        runs[orm].push(await measure(fn, n, parallel));
      } catch (e) {
        errors[orm] = (e.cause?.message || e.message).split("\n")[0];
      }
    }
  }
  const res = { label };
  for (const orm of Object.keys(impl)) {
    res[orm] = errors[orm] ? "erreur" : runs[orm].length ? median(runs[orm]) : null;
    if (errors[orm]) res.errors = { ...res.errors, [orm]: errors[orm] };
  }
  results.push(res);
  process.stderr.write(".");
}

const page = (i) => (i % 50) * 20;

await bench("findone par id", {
  morphine: (i) => Animals.findone(pick(an, i)).exec(),
  drizzle: (i) =>
    db
      .select()
      .from(animals)
      .where(eq(animals.id, pick(an, i)))
      .limit(1),
  prisma: (i) => prisma.animal.findUnique({ where: { id: pick(an, i) } }),
});
const pFindone = db
  .select()
  .from(animals)
  .where(eq(animals.id, sql.placeholder("id")))
  .limit(1)
  .prepare();
await bench("findone par id (Drizzle prepare())", {
  morphine: (i) => Animals.findone(pick(an, i)).exec(),
  drizzle: (i) => pFindone.execute({ id: pick(an, i) }),
});
await bench("findone par id, 50 en parallèle", {
  parallel: 50,
  morphine: (i) => Animals.findone(pick(an, i)).exec(),
  drizzle: (i) =>
    db
      .select()
      .from(animals)
      .where(eq(animals.id, pick(an, i)))
      .limit(1),
  prisma: (i) => prisma.animal.findUnique({ where: { id: pick(an, i) } }),
});
await bench("liste filtrée, triée, paginée (20 lignes)", {
  morphine: (i) =>
    Animals.find({ legs: { gte: 2 } })
      .orderBy("Animals.id")
      .limit(20)
      .offset(page(i))
      .exec(),
  drizzle: (i) =>
    db
      .select()
      .from(animals)
      .where(gte(animals.legs, 2))
      .orderBy(asc(animals.id))
      .limit(20)
      .offset(page(i)),
  prisma: (i) =>
    prisma.animal.findMany({
      where: { legs: { gte: 2 } },
      orderBy: { id: "asc" },
      take: 20,
      skip: page(i),
    }),
});
await bench("liste + 2 modèles liés (20 lignes)", {
  morphine: (i) =>
    Animals.find()
      .populate("breed")
      .populate("breed.species")
      .orderBy("Animals.id")
      .limit(20)
      .offset(page(i))
      .exec(),
  drizzle: (i) =>
    db
      .select()
      .from(animals)
      .leftJoin(breeds, eq(animals.breedId, breeds.id))
      .leftJoin(species, eq(breeds.speciesId, species.id))
      .orderBy(asc(animals.id))
      .limit(20)
      .offset(page(i)),
  prisma: (i) =>
    prisma.animal.findMany({
      include: { breed: { include: { species: true } } },
      orderBy: { id: "asc" },
      take: 20,
      skip: page(i),
    }),
});
await bench("liste + 2 modèles liés (Drizzle API relationnelle)", {
  drizzle: (i) =>
    db.query.animals.findMany({
      with: { breed: { with: { species: true } } },
      orderBy: [asc(animals.id)],
      limit: 20,
      offset: page(i),
    }),
});
await bench("count filtré", {
  morphine: () => Animals.count({ legs: { gt: 2 } }).exec(),
  drizzle: () => db.select({ n: count() }).from(animals).where(gt(animals.legs, 2)),
  prisma: () => prisma.animal.count({ where: { legs: { gt: 2 } } }),
});
await bench("une race et ses ~50 animaux", {
  n: Math.ceil(N / 4),
  morphine: (i) => Breeds.findone(pick(br, i)).onetomany("Animals", "breed", "animals").exec(),
  // pas d'API relationnelle sur MariaDB : la race, puis ses animaux
  drizzle: async (i) => {
    const id = pick(br, i);
    const [b] = await db.select().from(breeds).where(eq(breeds.id, id)).limit(1);
    b.animals = await db.select().from(animals).where(eq(animals.breedId, id));
    return b;
  },
  prisma: (i) =>
    prisma.breed.findUnique({ where: { id: pick(br, i) }, include: { animals: true } }),
});
await bench("insert 1 ligne, ligne complète rendue", {
  morphine: (i) => Animals.create(row(i)).exec(),
  drizzle: async (i) => {
    const [{ id }] = await db.insert(animals).values(drizzleRow(i)).$returningId();
    return (await db.select().from(animals).where(eq(animals.id, id)).limit(1))[0];
  },
  prisma: (i) => prisma.animal.create({ data: prismaRow(i) }),
});
await bench("insert 1 ligne, id seulement", {
  morphine: (i) => Animals.create(row(i)).exec(false),
  drizzle: (i) => db.insert(animals).values(drizzleRow(i)).$returningId(),
  prisma: (i) => prisma.animal.create({ data: prismaRow(i), select: { id: true } }),
});
await bench("update par id, ligne complète rendue", {
  morphine: (i) => Animals.updateone(pick(an, i), { legs: i % 5 }).exec(),
  drizzle: async (i) => {
    const id = pick(an, i);
    await db
      .update(animals)
      .set({ legs: i % 5, updatedAt: now })
      .where(eq(animals.id, id));
    return (await db.select().from(animals).where(eq(animals.id, id)).limit(1))[0];
  },
  prisma: (i) =>
    prisma.animal.update({
      where: { id: pick(an, i) },
      data: { legs: i % 5, updatedAt: new Date() },
    }),
});
await bench("update par id, nombre de lignes seulement", {
  morphine: (i) => Animals.updateone(pick(an, i), { legs: i % 5 }).exec(false),
  drizzle: (i) =>
    db
      .update(animals)
      .set({ legs: i % 5, updatedAt: now })
      .where(eq(animals.id, pick(an, i))),
  prisma: (i) =>
    prisma.animal.updateMany({
      where: { id: pick(an, i) },
      data: { legs: i % 5, updatedAt: new Date() },
    }),
});
await bench("insert 1 000 lignes", {
  n: 20,
  // MorphineOrm rend les ids (RETURNING sur MariaDB), Drizzle les déduit de insertId,
  // Prisma ne rend que le nombre de lignes (createManyAndReturn n'existe pas sur MySQL)
  morphine: (i) =>
    Animals.createMany(Array.from({ length: 1000 }, (_, j) => row(i * 1000 + j)))
      .returnRow(false)
      .exec(),
  drizzle: (i) =>
    db
      .insert(animals)
      .values(Array.from({ length: 1000 }, (_, j) => drizzleRow(i * 1000 + j)))
      .$returningId(),
  prisma: (i) =>
    prisma.animal.createMany({
      data: Array.from({ length: 1000 }, (_, j) => prismaRow(i * 1000 + j)),
    }),
});
// chaque ORM supprime ses propres lignes, jamais deux fois la même
const toDelete = { morphine: 0, drizzle: 3000, prisma: 6000 };
await bench("delete par id", {
  n: Math.min(500, Math.ceil(N / 4)),
  morphine: () => Animals.destroy(an[toDelete.morphine++]).exec(),
  drizzle: () => db.delete(animals).where(eq(animals.id, an[toDelete.drizzle++])),
  prisma: () => prisma.animal.delete({ where: { id: an[toDelete.prisma++] } }),
});

// ---------- résultats ----------
const [[{ version }]] = await pool.query("SELECT VERSION() AS version");
const fmt = (us) =>
  us === null
    ? "—"
    : us === "erreur"
      ? "erreur"
      : us >= 1000
        ? (us / 1000).toFixed(2) + " ms"
        : us.toFixed(0) + " µs";
process.stderr.write("\n");
console.log(`\nServeur ${version}, Node ${process.version}, ${N} itérations par cas\n`);
console.log("| Cas | MorphineOrm | Drizzle | Prisma | Plus rapide |");
console.log("|---|---|---|---|---|");
for (const r of results) {
  const times = ["morphine", "drizzle", "prisma"].filter((o) => typeof r[o] === "number");
  const best = times.sort((a, b) => r[a] - r[b])[0];
  const names = { morphine: "MorphineOrm", drizzle: "Drizzle", prisma: "Prisma" };
  const second = times[1];
  const lead = best && second ? ` (×${(r[second] / r[best]).toFixed(2)})` : "";
  console.log(
    `| ${r.label} | ${fmt(r.morphine)} | ${fmt(r.drizzle)} | ${fmt(r.prisma)} | ${best ? names[best] + lead : "—"} |`,
  );
}
for (const r of results) {
  for (const [orm, msg] of Object.entries(r.errors || {})) {
    console.log(`\n${r.label} — ${orm} : ${msg.slice(0, 160)}`);
  }
}

await reset();
await MorphineDb.close();
await pool.end();
await prisma.$disconnect();
