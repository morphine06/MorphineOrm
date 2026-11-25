require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");

const { MorphineDb, Models, loadModels } = require("./index.js");

// Base visée : `node test.js mysql2|sqlite3|pg` (cf. scripts npm test-*).
const DB_TYPE = process.argv[2] || "mysql2";

// Code d'erreur renvoyé par chaque driver pour une table inexistante.
const NO_SUCH_TABLE = { mysql2: "ER_NO_SUCH_TABLE", sqlite3: "SQLITE_ERROR", pg: "42P01" };

function dbConfig(overrides = {}) {
  const common = {
    type: DB_TYPE,
    migrate: "alter",
    debug: false,
    catchError: true,
    quietMigration: true,
    ...overrides,
  };
  if (DB_TYPE === "sqlite3") return { ...common, database: "morphineorm-test" };
  if (DB_TYPE === "pg") {
    return {
      ...common,
      host: process.env.PGHOST || "localhost",
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "morphineorm",
      port: process.env.PGPORT || 5432,
      dateStrings: true,
    };
  }
  if (DB_TYPE === "mysql2") {
    return {
      ...common,
      host: process.env.DBHOST,
      user: process.env.DBUSER,
      password: process.env.DBPASSWORD,
      database: process.env.DBNAME,
      port: process.env.DBPORT,
      dateStrings: true,
      engine: "InnoDB",
      collation: "utf8mb4_general_ci",
    };
  }
  throw new Error(`Base inconnue : ${DB_TYPE} (mysql2, sqlite3 ou pg)`);
}

async function initApp() {
  console.log(`# Tests sur ${DB_TYPE}`);
  // SQLite : fichier jetable, recréé à chaque lancement
  if (fs.existsSync("./morphineorm-test.sqlite")) fs.unlinkSync("./morphineorm-test.sqlite");
  await MorphineDb.init(dbConfig());
  await loadModels();
}

initApp().then(async () => {
  const { Animals, Breeds, Species } = Models;

  async function truncateAll() {
    // await Species.truncate();
    // await Breeds.truncate();
    // await Animals.truncate();
    let animals = await Animals.find().exec();
    for (let animal of animals) {
      await Animals.destroy(animal.id).exec();
    }
    let breeds = await Breeds.find().exec();
    for (let breed of breeds) {
      await Breeds.destroy(breed.id).exec();
    }
    let species = await Species.find().exec();
    for (let specie of species) {
      await Species.destroy(specie.id).exec();
    }
  }

  await test("Test drop model", async () => {
    await Animals.drop().exec();
    await Breeds.drop().exec();
    await Species.drop().exec();
    await assert.rejects(Animals.find().exec(), (error) => {
      assert.strictEqual(error.code, NO_SUCH_TABLE[DB_TYPE]);
      return true;
    });
  });

  await test("Test loadModels()", async (t) => {
    // test
    await loadModels();
    const animals = await Animals.find().exec();
    assert.strictEqual(animals.length, 0);
  });

  await test("Test query()", async (t) => {
    // before
    await Species.create({ name: "Dog" }).exec();
    await Species.create({ name: "Bird" }).exec();
    // test
    const animals = await Animals.query("SELECT * FROM " + Species.def.tableName).exec();
    assert.strictEqual(animals.length, 2);
    // after
    await truncateAll();
  });

  await test("Test create() row", async (t) => {
    // test
    const bird = await Species.create({ name: "Bird" }).exec();
    assert.strictEqual(bird.name, "Bird");
    // after
    await truncateAll();
  });

  await test("Test count()", async (t) => {
    // before
    await Species.create({ name: "Bird" }).exec();
    await Species.create({ name: "Bird" }).exec();
    // test
    const nbbirds = await Species.count({ name: "Bird" }).exec();
    assert.strictEqual(nbbirds, 2);
    // after
    await truncateAll();
  });

  await test("Test findone() with ID integer", async () => {
    // before
    let species = await Species.create({ name: "Bird" }).exec();
    // test
    const bird = await Species.findone(species.id).exec();
    assert.strictEqual(bird.name, "Bird");
    // after
    await truncateAll();
  });

  await test("Test findone() with query", async () => {
    // before
    await Species.create({ name: "Bird" }).exec();
    // test
    const bird = await Species.findone("name='Bird'").exec();
    assert.strictEqual(bird.name, "Bird");
    // after
    await truncateAll();
  });

  await test("Test findone() with populate", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    let animal = await Animals.create({ name: "Charly", breedId: breed.id }).exec();
    // test
    const dogCharly = await Animals.findone(animal.id)
      .populate("breed")
      .populate("breed.species")
      .exec();
    assert.strictEqual(dogCharly.id, animal.id);
    assert.strictEqual(dogCharly.name, "Charly");
    assert.strictEqual(dogCharly.breed.name, "Labrador");
    assert.strictEqual(dogCharly.breed.species.name, "Dog");
    // after
    await truncateAll();
  });

  await test("Test findone() with onetomany", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    await Animals.create({ name: "Charly", breedId: breed.id }).exec();
    await Animals.create({ name: "Jazz", breedId: breed.id }).exec();
    // test
    let breeds = await Breeds.findone(breed.id)
      .onetomany("Animals", "breed", "animals")
      .populateAll()
      .exec();
    assert.strictEqual(breeds.animals.length, 2);
    // after
    await truncateAll();
  });

  await test("Test find()", async () => {
    // before
    await Species.create({ name: "Dog" }).exec();
    await Species.create({ name: "Bird" }).exec();
    await Species.create({ name: "Fish" }).exec();
    // test
    const species = await Species.find().exec();
    assert.strictEqual(species.length, 3);
    // after
    await truncateAll();
  });

  await test("Test find() with selected", async () => {
    // before
    await Species.create({ name: "Dog" }).exec();
    await Species.create({ name: "Bird" }).exec();
    // test
    const animals = await Species.find().select("id, name").exec(); // or .select(["id", "name"])
    assert.strictEqual(animals.length, 2);
    assert.strictEqual(animals[0].createdAt, undefined);
    // after
    await truncateAll();
  });

  await test("Test find() with query in joined model", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    let animalCharly = await Animals.create({ name: "Charly", breedId: breed.id }).exec();
    let animalJazz = await Animals.create({ name: "Jazz", breedId: breed.id }).exec();
    // test
    const dogs = await Animals.find("breed.name=?", ["Labrador"]).populateAll().exec();
    assert.strictEqual(dogs.length, 2);
    let ok = 0;
    for (let dog of dogs) {
      if (
        dog.id === animalCharly.id &&
        dog.name === "Charly" &&
        dog.breed.id === breed.id &&
        dog.breed.name === "Labrador"
      )
        ok++;
      if (
        dog.id === animalJazz.id &&
        dog.name === "Jazz" &&
        dog.breed.id === breed.id &&
        dog.breed.name === "Labrador"
      )
        ok++;
    }
    if (ok !== 2) assert.fail("Not all dogs found");
    // after
    await truncateAll();
  });

  await test("Test find() with onetomany", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breedLabrador = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    let breedChiwawa = await Breeds.create({ name: "Chiwawa", speciesId: species.id }).exec();
    await Animals.create({ name: "Charly", breedId: breedLabrador.id }).exec();
    await Animals.create({ name: "Rex", breedId: breedLabrador.id }).exec();
    await Animals.create({ name: "Jazz", breedId: breedChiwawa.id }).exec();
    // test
    let breeds = await Breeds.find().onetomany("Animals", "breed", "animals").populateAll().exec();
    assert.strictEqual(breeds.length, 2);
    assert.strictEqual(breeds[0].animals.length, 2);
    assert.strictEqual(breeds[1].animals.length, 1);
    // after
    await truncateAll();
  });

  await test("Test updateone() row", async () => {
    // before
    let species = await Species.create({ name: "Bird" }).exec();
    // test
    const bird = await Species.updateone(species.id, { name: "Bird 2" }).exec();
    assert.strictEqual(bird.name, "Bird 2");
    // after
    await truncateAll();
  });

  await test("Test updateone and populateAll()", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    let animal = await Animals.create({ name: "Charly", breedId: breed.id }).exec();
    // test
    const dogCharly = await Animals.updateone(animal.id, {
      name: "Charly 2",
    })
      .populateAll()
      .exec();
    assert.strictEqual(dogCharly.id, animal.id);
    assert.strictEqual(dogCharly.name, "Charly 2");
    // after
    await truncateAll();
  });

  await test("Test destroy() row", async () => {
    // before
    const fish = await Species.create({ name: "Fish" }).exec();
    // test
    await Species.destroy(fish.id).exec();
    const fish2 = await Species.findone(fish.id).exec();
    assert.strictEqual(fish2, null);
    // after
    await truncateAll();
  });

  await test("Test beforeCreate() and beforeUpdate()", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    // test
    let animalCharly = await Animals.create({ name: "toto", breedId: breed.id }).exec();
    assert.strictEqual(animalCharly.name, "toto not allowed");

    let animalCharly2 = await Animals.updateone(animalCharly.id, {
      name: "toto not allowed",
    }).exec();
    assert.strictEqual(animalCharly2.name, "toto");
    // after
    await truncateAll();
  });

  await test("Test virtuals fields", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    // test
    let birth = "2022-01-01";
    let animalCharly = await Animals.create({
      name: "Charly",
      breedId: breed.id,
      legs: 4,
      birth,
    }).exec();
    assert.strictEqual(animalCharly.age, new Date().getFullYear() - new Date(birth).getFullYear());
    // after
    await truncateAll();
  });

  await test("Test getPrimary() and getAttributes()", async () => {
    // test
    let primary = Animals.getPrimary();
    let attributes = Animals.getAttributes();
    assert.strictEqual(primary, "id");
    assert.strictEqual(attributes.id.type, "integer");
    assert.strictEqual(attributes.name.type, "string");
    // after
    await truncateAll();
  });

  await test("Personal test", async () => {
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    let animalCharly = await Animals.create({
      name: "Charly",
      breedId: breed.id,
      legs: 4,
      birth: "2022-01-01",
    }).exec();
    assert.strictEqual(animalCharly.legs, 4);
    assert.strictEqual(animalCharly.birth, "2022-01-01");
    // after
    await truncateAll();
  });

  await test("Test validator refuse create() et update()", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    // test : name doit faire de 2 à 255 caractères
    await assert.rejects(Animals.create({ name: "A", breedId: breed.id }).exec(), (error) => {
      assert.strictEqual(error.code, "E_VALIDATION");
      assert.strictEqual(error.errors[0].field, "name");
      assert.strictEqual(error.errors[0].error, "isLength");
      return true;
    });
    assert.strictEqual(await Animals.count().exec(), 0);
    const rex = await Animals.create({ name: "Rex", breedId: breed.id }).exec();
    await assert.rejects(Animals.updateone(rex.id, { name: "R" }).exec(), { code: "E_VALIDATION" });
    assert.strictEqual((await Animals.findone(rex.id).exec()).name, "Rex");
    // after
    await truncateAll();
  });

  await test("Test groupBy() et having()", async () => {
    // before
    let species = await Species.create({ name: "Dog" }).exec();
    let labrador = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    let chiwawa = await Breeds.create({ name: "Chiwawa", speciesId: species.id }).exec();
    await Animals.create({ name: "Charly", breedId: labrador.id }).exec();
    await Animals.create({ name: "Rex", breedId: labrador.id }).exec();
    await Animals.create({ name: "Jazz", breedId: chiwawa.id }).exec();
    // test
    const all = await Animals.find()
      .select("Animals.breedId, count(*) AS nb")
      .groupBy("Animals.breedId")
      .exec();
    assert.strictEqual(all.length, 2);
    const many = await Animals.find()
      .select("Animals.breedId, count(*) AS nb")
      .groupBy("Animals.breedId")
      .having("count(*) > 1")
      .exec();
    assert.strictEqual(many.length, 1);
    assert.strictEqual(Number(many[0].nb), 2);
    // count() ignore l'ordre, que PostgreSQL refuserait sans GROUP BY
    assert.strictEqual(await Animals.count().orderBy("Animals.name").exec(), 3);
    // after
    await truncateAll();
  });

  await test("Test returnRow(false)", async () => {
    const id = await Species.create({ name: "Bird" }).returnRow(false).exec();
    assert.strictEqual(typeof id, "number");
    const nb = await Species.updateone(id, { name: "Bird 2" }).returnRow(false).exec();
    assert.strictEqual(nb, 1);
    // after
    await truncateAll();
  });

  await test("Test destroy() renvoie le nombre de lignes", async () => {
    await Species.create({ name: "Fish" }).exec();
    await Species.create({ name: "Fish" }).exec();
    await Species.create({ name: "Bird" }).exec();
    assert.strictEqual(await Species.destroy({ name: "Fish" }).exec(), 2);
    assert.strictEqual(await Species.count().exec(), 1);
    // after
    await truncateAll();
  });

  await test("Test truncate()", async () => {
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    await Animals.create({ name: "Charly", breedId: breed.id }).exec();
    await Animals.truncate().exec();
    assert.strictEqual(await Animals.count().exec(), 0);
    const rex = await Animals.create({ name: "Rex", breedId: breed.id }).exec();
    assert.strictEqual(rex.id, 1); // l'autoincrement repart de 1
    // after
    await truncateAll();
  });

  // Une espèce, une race et, si demandé, des animaux de cette race.
  async function createDogs(...names) {
    const species = await Species.create({ name: "Dog" }).exec();
    const breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    const animals = [];
    for (const name of names)
      animals.push(await Animals.create({ name, breedId: breed.id }).exec());
    return { species, breed, animals };
  }

  await test("Sécurité : update() et destroy() sans condition sont refusés", async () => {
    const {
      animals: [rex],
    } = await createDogs("Rex");
    for (const where of [undefined, "", {}]) {
      await assert.rejects(Animals.destroy(where).exec(), /sans condition/);
      await assert.rejects(Animals.update(where, { legs: 9 }).exec(), /sans condition/);
    }
    await assert.rejects(Animals.updateone({}, { legs: 9 }).exec(), /sans condition/);
    assert.strictEqual(await Animals.count().exec(), 1);
    assert.strictEqual((await Animals.findone(rex.id).exec()).legs, 2);
    // after
    await truncateAll();
  });

  await test("Sécurité : l'identifiant 0 ne désigne aucune ligne", async () => {
    const {
      animals: [rex],
    } = await createDogs("Rex");
    assert.strictEqual(await Animals.findone(0).exec(), null);
    assert.strictEqual(await Animals.updateone(0, { legs: 9 }).exec(false), 0);
    assert.strictEqual(await Animals.destroy(0).exec(), 0);
    assert.strictEqual((await Animals.findone(rex.id).exec()).legs, 2);
    // after
    await truncateAll();
  });

  await test("Conditions : objet, identifiant en chaîne, update() à trois arguments, orderBy()", async () => {
    const { breed } = await createDogs();
    const rex = await Animals.create({ name: "Rex", breedId: breed.id, legs: 4 }).exec();
    await Animals.create({ name: "Jazz", breedId: breed.id, legs: 4 }).exec();
    await Animals.create({ name: "Charly", breedId: breed.id, legs: 3 }).exec();
    assert.strictEqual((await Animals.find({ legs: 4 }).exec()).length, 2);
    assert.strictEqual((await Animals.find({ legs: 4, name: "Rex" }).exec()).length, 1);
    assert.strictEqual((await Animals.findone(String(rex.id)).exec()).name, "Rex");
    const updated = await Animals.update("Animals.legs=?", [4], { birth: "2020-01-01" }).exec();
    assert.strictEqual(updated.length, 2);
    assert.ok(updated.every((a) => a.birth === "2020-01-01"));
    const sorted = await Animals.find().orderBy("Animals.name").exec();
    assert.deepStrictEqual(
      sorted.map((a) => a.name),
      ["Charly", "Jazz", "Rex"],
    );
    const desc = await Animals.find().orderBy("Animals.name DESC").exec();
    assert.strictEqual(desc[0].name, "Rex");
    // after
    await truncateAll();
  });

  await test("Valeurs : apostrophes, guillemets et SQL passent sans risque", async () => {
    const { breed } = await createDogs();
    const name = `O'Reilly "le" chien'); DROP TABLE ${Animals.def.tableName}; --`;
    const created = await Animals.create({ name, breedId: breed.id }).exec();
    assert.strictEqual(created.name, name);
    assert.strictEqual((await Animals.find({ name }).exec()).length, 1);
    assert.strictEqual((await Animals.find("Animals.name=?", [name]).exec()).length, 1);
    assert.strictEqual(await Animals.count().exec(), 1);
    // after
    await truncateAll();
  });

  await test("Un champ présent à null prend sa valeur par défaut", async () => {
    const { breed } = await createDogs();
    const rex = await Animals.create({ name: "Rex", breedId: breed.id, legs: null }).exec();
    assert.strictEqual(rex.legs, 2);
    await Animals.updateone(rex.id, { legs: 4 }).exec();
    const back = await Animals.updateone(rex.id, { legs: null }).exec();
    assert.strictEqual(back.legs, 2);
    // after
    await truncateAll();
  });

  await test("Dates : vides, invalides, createdAt et updatedAt", async () => {
    const { breed } = await createDogs();
    const empty = DB_TYPE === "pg" ? null : "0000-00-00";
    for (const birth of ["", null, "pas une date"]) {
      const a = await Animals.create({ name: "Rex", breedId: breed.id, birth }).exec();
      assert.strictEqual(a.birth, empty);
      assert.strictEqual(a.age, null);
    }
    const jazz = await Animals.create({
      name: "Jazz",
      breedId: breed.id,
      birth: "2021-05-04T10:00:00",
    }).exec();
    assert.strictEqual(jazz.birth, "2021-05-04");
    const datetime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    assert.match(jazz.createdAt, datetime);
    assert.match(jazz.updatedAt, datetime);
    const forced = await Animals.updateone(jazz.id, {
      legs: 3,
      updatedAtForced: "2020-01-01 00:00:00",
    }).exec();
    assert.strictEqual(forced.updatedAt, "2020-01-01 00:00:00");
    assert.strictEqual(forced.createdAt, jazz.createdAt);
    // after
    await truncateAll();
  });

  await test("Types json et boolean", async () => {
    const { breed } = await createDogs();
    const infos = { color: "black", tags: ["calme", "joueur"], weight: 32.5 };
    const rex = await Animals.create({
      name: "Rex",
      breedId: breed.id,
      vaccinated: true,
      infos,
    }).exec();
    assert.strictEqual(rex.vaccinated, true);
    assert.deepStrictEqual(rex.infos, infos);
    const jazz = await Animals.create({ name: "Jazz", breedId: breed.id }).exec();
    assert.strictEqual(jazz.vaccinated, false);
    assert.strictEqual(jazz.infos, null);
    const back = await Animals.updateone(rex.id, {
      vaccinated: false,
      infos: { color: "white" },
    }).exec();
    assert.strictEqual(back.vaccinated, false);
    assert.deepStrictEqual(back.infos, { color: "white" });
    // les valeurs du modèle lié sont converties aussi
    const breedWithAnimals = await Breeds.findone(breed.id)
      .onetomany("Animals", "breed", "animals")
      .orderBy("Animals.name")
      .exec();
    assert.strictEqual(breedWithAnimals.animals.length, 2);
    // after
    await truncateAll();
  });

  await test("createEmpty()", async () => {
    const empty = Animals.createEmpty();
    assert.strictEqual(empty.id, 0);
    assert.strictEqual(empty.name, "");
    assert.strictEqual(empty.legs, 2);
    assert.strictEqual(empty.breedId, 0);
    assert.strictEqual(empty.vaccinated, false);
    assert.strictEqual(empty.createdAt, null);
    const withJoined = Animals.createEmpty({ createJoined: true });
    assert.strictEqual(withJoined.breed.name, "");
    assert.strictEqual(withJoined.breedId, undefined);
  });

  await test("replace() crée puis met à jour", async () => {
    const { breed } = await createDogs();
    const rex = await Animals.replace({ name: "Rex", breedId: breed.id }).exec();
    assert.strictEqual(rex.name, "Rex");
    const rex2 = await Animals.replace({ id: rex.id, name: "Rex 2" }).exec();
    assert.strictEqual(rex2.id, rex.id);
    assert.strictEqual(rex2.name, "Rex 2");
    assert.strictEqual(await Animals.count().exec(), 1);
    // after
    await truncateAll();
  });

  await test("Condition sur un modèle lié à deux niveaux", async () => {
    await createDogs("Rex", "Jazz");
    const cat = await Species.create({ name: "Cat" }).exec();
    const siamese = await Breeds.create({ name: "Siamese", speciesId: cat.id }).exec();
    await Animals.create({ name: "Felix", breedId: siamese.id }).exec();
    const dogs = await Animals.find("breed.species.name=?", ["Dog"])
      .populate("breed")
      .populate("breed.species")
      .orderBy("Animals.name")
      .exec();
    assert.deepStrictEqual(
      dogs.map((d) => d.name),
      ["Jazz", "Rex"],
    );
    assert.strictEqual(dogs[0].breed.species.name, "Dog");
    assert.strictEqual(await Animals.count().exec(), 3);
    // after
    await truncateAll();
  });

  await test("Hooks beforeDestroy() et beforeTruncate()", async () => {
    const calls = [];
    // Animals : TRUNCATE est refusé sur une table référencée par une clé étrangère
    Animals.def.beforeDestroy = async (where, whereData) => calls.push(["destroy", where]);
    Animals.def.beforeTruncate = async () => calls.push(["truncate"]);
    try {
      const {
        animals: [rex],
      } = await createDogs("Rex", "Jazz");
      await Animals.destroy(rex.id).exec();
      await Animals.truncate().exec();
      assert.deepStrictEqual(calls, [["destroy", rex.id], ["truncate"]]);
      assert.strictEqual(await Animals.count().exec(), 0);
    } finally {
      delete Animals.def.beforeDestroy;
      delete Animals.def.beforeTruncate;
    }
    // after
    await truncateAll();
  });

  await test(
    "Clé étrangère RESTRICT : une race utilisée ne se supprime pas",
    { skip: DB_TYPE === "sqlite3" && "SQLite : pas de contrainte ajoutée après coup" },
    async () => {
      const { breed } = await createDogs("Rex");
      await assert.rejects(Breeds.destroy(breed.id).exec());
      assert.strictEqual((await Breeds.findone(breed.id).exec()).name, "Labrador");
      // after
      await truncateAll();
    },
  );

  await test("catchError: false : l'erreur est journalisée, la requête renvoie vide", async () => {
    const warn = console.warn;
    const logged = [];
    console.warn = (...args) => logged.push(args);
    MorphineDb.connection.catchError = false;
    try {
      assert.deepStrictEqual(await Animals.query("SELECT * FROM table_inexistante").exec(), []);
      assert.deepStrictEqual(await Animals.find("colonne_inexistante=1").exec(), []);
      assert.strictEqual(await Animals.findone("colonne_inexistante=1").exec(), null);
      assert.strictEqual(await Animals.count("colonne_inexistante=1").exec(), null);
      assert.ok(logged.length >= 4);
    } finally {
      MorphineDb.connection.catchError = true;
      console.warn = warn;
    }
  });

  await test("Requêtes sans résultat", async () => {
    assert.deepStrictEqual(await Animals.find().exec(), []);
    assert.deepStrictEqual(await Animals.find({ name: "Personne" }).populateAll().exec(), []);
    assert.strictEqual(await Animals.findone({ name: "Personne" }).exec(), null);
    assert.strictEqual(await Animals.findone(999999).populate("breed").exec(), null);
    assert.strictEqual(await Animals.count({ name: "Personne" }).exec(), 0);
    assert.strictEqual(await Animals.updateone(999999, { legs: 3 }).exec(), null);
    assert.deepStrictEqual(await Animals.update({ name: "Personne" }, { legs: 3 }).exec(), []);
    assert.strictEqual(await Animals.destroy({ name: "Personne" }).exec(), 0);
  });

  await test("populateAll() : exclusion et profondeur", async () => {
    const {
      animals: [rex],
    } = await createDogs("Rex");
    const full = await Animals.findone(rex.id).populateAll().exec();
    assert.strictEqual(full.breed.species.name, "Dog");
    const oneLevel = await Animals.findone(rex.id).populateAll([], 1).exec();
    assert.strictEqual(oneLevel.breed.name, "Labrador");
    assert.strictEqual(oneLevel.breed.species, undefined);
    const excluded = await Animals.findone(rex.id).populateAll(["breed.species"]).exec();
    assert.strictEqual(excluded.breed.name, "Labrador");
    assert.strictEqual(excluded.breed.species, undefined);
    const none = await Animals.findone(rex.id).populateAll(["breed"]).exec();
    assert.strictEqual(none.breed, undefined);
    // after
    await truncateAll();
  });

  await test("count() et conditions sur un modèle lié", async () => {
    await createDogs("Rex", "Jazz");
    const cat = await Species.create({ name: "Cat" }).exec();
    const siamese = await Breeds.create({ name: "Siamese", speciesId: cat.id }).exec();
    await Animals.create({ name: "Felix", breedId: siamese.id }).exec();
    assert.strictEqual(
      await Animals.count("breed.name=?", ["Labrador"]).populate("breed").exec(),
      2,
    );
    assert.strictEqual(
      (await Animals.find({ "breed.name": "Siamese" }).populate("breed").exec())[0].name,
      "Felix",
    );
    // after
    await truncateAll();
  });

  await test("onetomany() : un parent sans enfant a un tableau vide", async () => {
    const { breed } = await createDogs("Rex");
    const empty = await Breeds.create({ name: "Chiwawa", speciesId: breed.speciesId }).exec();
    const breeds = await Breeds.find()
      .onetomany("Animals", "breed", "animals")
      .orderBy("Breeds.name")
      .exec();
    assert.strictEqual(breeds.length, 2);
    assert.strictEqual(breeds[0].id, empty.id);
    assert.deepStrictEqual(breeds[0].animals, []);
    assert.strictEqual(breeds[1].animals.length, 1);
    assert.strictEqual(breeds[1].animals[0].name, "Rex");
    // after
    await truncateAll();
  });

  await test("updateone().populate() renvoie la ligne et ses modèles liés", async () => {
    const {
      animals: [rex],
    } = await createDogs("Rex");
    const back = await Animals.updateone(rex.id, { legs: 3 })
      .populate("breed")
      .populate("breed.species")
      .exec();
    assert.strictEqual(back.legs, 3);
    assert.strictEqual(back.breed.species.name, "Dog");
    // after
    await truncateAll();
  });

  await test("Clés inconnues ignorées, json reçu en chaîne", async () => {
    const { breed } = await createDogs();
    const rex = await Animals.create({
      name: "Rex",
      breedId: breed.id,
      inconnu: "x",
      infos: '{"color":"black"}',
    }).exec();
    assert.strictEqual(rex.inconnu, undefined);
    assert.deepStrictEqual(rex.infos, { color: "black" });
    const back = await Animals.updateone(rex.id, { inconnu: "y", legs: 5 }).exec();
    assert.strictEqual(back.legs, 5);
    assert.strictEqual(back.inconnu, undefined);
    // after
    await truncateAll();
  });

  await test("Créations en parallèle", async () => {
    const { breed } = await createDogs();
    const names = Array.from({ length: 20 }, (_, i) => `Chien ${i}`);
    const created = await Promise.all(
      names.map((name) => Animals.create({ name, breedId: breed.id }).exec()),
    );
    assert.strictEqual(new Set(created.map((a) => a.id)).size, 20);
    assert.deepStrictEqual(created.map((a) => a.name).sort(), [...names].sort());
    assert.strictEqual(await Animals.count().exec(), 20);
    // after
    await truncateAll();
  });

  await test("debug() journalise la requête", async () => {
    const warn = console.warn;
    const logged = [];
    console.warn = (...args) => logged.push(args.join(" "));
    try {
      await Species.find({ name: "Dog" }).debug().exec();
    } finally {
      console.warn = warn;
    }
    assert.ok(logged.some((l) => l.includes("SELECT") && l.includes("Dog")));
  });

  await test("Validator : règle inconnue, null non vérifié", async () => {
    const { breed } = await createDogs();
    const rule = Animals.def.attributes.name.validator;
    try {
      Animals.def.attributes.name.validator = { fn: "isInexistant" };
      await assert.rejects(Animals.create({ name: "Rex", breedId: breed.id }).exec(), /inconnu/);
    } finally {
      Animals.def.attributes.name.validator = rule;
    }
    const anonymous = await Animals.create({ name: null, breedId: breed.id }).exec();
    assert.strictEqual(anonymous.name, "");
    // after
    await truncateAll();
  });

  await test("loadModels(dir) : sous-dossier, table par défaut, clé texte, sans dates", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "morphine-models-"));
    fs.mkdirSync(path.join(dir, "geo"));
    fs.writeFileSync(
      path.join(dir, "geo", "Countries.model.js"),
      `module.exports = function () {
        return {
          useCreatedAt: false,
          useUpdatedAt: false,
          attributes: {
            code: { type: "char", length: 2, primary: true },
            label: { type: "string", defaultsTo: "" },
          },
        };
      };`,
    );
    try {
      await loadModels(dir);
      const { Countries } = Models;
      assert.ok(Countries);
      assert.strictEqual(Countries.def.tableName, "Countries");
      assert.strictEqual(Countries.getPrimary(), "code");
      assert.strictEqual(Countries.getAttributes().createdAt, undefined);
      const fr = await Countries.create({ code: "FR", label: "France" }).exec();
      assert.deepStrictEqual(fr, { code: "FR", label: "France" });
      await Countries.create({ code: "IT", label: "Italie" }).exec();
      const it = await Countries.updateone({ code: "IT" }, { label: "Italia" }).exec();
      assert.strictEqual(it.label, "Italia");
      assert.strictEqual(await Countries.destroy({ code: "FR" }).exec(), 1);
      assert.strictEqual(await Countries.count().exec(), 1);
    } finally {
      if (Models.Countries) {
        try {
          await Models.Countries.drop().exec();
        } finally {
          delete Models.Countries;
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Messages console.warn émis pendant fn().
  async function captureWarnings(fn) {
    const warn = console.warn;
    const logged = [];
    console.warn = (...args) =>
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    try {
      await fn();
    } finally {
      console.warn = warn;
    }
    return logged.join("\n");
  }

  await test("Sécurité : une clé de condition objet ne peut pas injecter de SQL", async () => {
    await createDogs("Rex", "Jazz");
    for (const key of [
      "1=1 OR Animals.name",
      "name) OR (1=1",
      "name; DROP TABLE x",
      "Animals.name--",
      "",
    ]) {
      await assert.rejects(Animals.find({ [key]: "x" }).exec(), { code: "E_INVALID_WHERE" });
      await assert.rejects(Animals.destroy({ [key]: "x" }).exec(), { code: "E_INVALID_WHERE" });
      await assert.rejects(Animals.update({ [key]: "x" }, { legs: 9 }).exec(), {
        code: "E_INVALID_WHERE",
      });
    }
    // un tableau n'est pas une condition
    await assert.rejects(Animals.find([1]).exec(), { code: "E_INVALID_WHERE" });
    assert.strictEqual(await Animals.count().exec(), 2);
    // les noms de colonne, préfixés ou non, restent acceptés
    assert.strictEqual((await Animals.find({ name: "Rex" }).exec()).length, 1);
    assert.strictEqual((await Animals.find({ "Animals.name": "Rex" }).exec()).length, 1);
    // after
    await truncateAll();
  });

  await test("Sécurité : une chaîne numérique est un identifiant, pas du SQL", async () => {
    const {
      animals: [rex, jazz, charly],
    } = await createDogs("Rex", "Jazz", "Charly");
    // " 1", "0x1", "1e0" valent 1 pour Number() mais `WHERE 0x1` est toujours vrai en SQL
    const disguised = (id) => [` ${id}`, `${id} `, `0x${id.toString(16)}`, `${id}e0`, `+${id}`];
    for (const id of disguised(rex.id)) {
      assert.strictEqual((await Animals.findone(id).exec()).name, "Rex");
      assert.strictEqual((await Animals.find(id).exec()).length, 1);
    }
    for (const id of disguised(jazz.id)) {
      assert.strictEqual((await Animals.updateone(id, { legs: 3 }).exec()).name, "Jazz");
    }
    assert.strictEqual((await Animals.findone(rex.id).exec()).legs, 2);
    assert.strictEqual(await Animals.destroy(`0x${charly.id.toString(16)}`).exec(), 1);
    assert.strictEqual(await Animals.count().exec(), 2);
    // after
    await truncateAll();
  });

  await test("Sécurité : update() n'écrit que les attributs du modèle", async () => {
    const {
      animals: [rex],
    } = await createDogs("Rex");
    // clés héritées de Object.prototype, et __proto__ propre (JSON.parse d'un corps de requête)
    const data = JSON.parse(
      '{"__proto__": {"legs": 9}, "constructor": 1, "toString": 2, "legs": 3}',
    );
    const back = await Animals.updateone(rex.id, data).exec();
    assert.strictEqual(back.legs, 3);
    assert.strictEqual({}.legs, undefined); // pas de pollution de prototype
    // after
    await truncateAll();
  });

  await test("updateone() refuse une condition qui désigne plusieurs lignes", async () => {
    await createDogs("Rex", "Jazz");
    await assert.rejects(Animals.updateone({ legs: 2 }, { legs: 4 }).exec(), {
      code: "E_UPDATEONE_MANY",
    });
    await assert.rejects(Animals.updateone("Animals.legs=?", [2], { legs: 4 }).exec(), {
      code: "E_UPDATEONE_MANY",
    });
    assert.strictEqual((await Animals.find({ legs: 4 }).exec()).length, 0); // rien n'a été modifié
    // une condition qui ne désigne qu'une ligne passe
    const rex = await Animals.updateone({ name: "Rex" }, { legs: 4 }).exec();
    assert.strictEqual(rex.legs, 4);
    assert.strictEqual((await Animals.findone({ name: "Jazz" }).exec()).legs, 2);
    // update() modifie toujours plusieurs lignes
    assert.strictEqual(await Animals.update({ breedId: rex.breedId }, { legs: 1 }).exec(false), 2);
    // after
    await truncateAll();
  });

  await test("Logs : les valeurs des requêtes sont masquées, sauf logValues", async () => {
    const secret = "motdepasse-tres-secret";
    MorphineDb.connection.catchError = false;
    try {
      let logs = await captureWarnings(() =>
        Animals.find("colonne_inexistante=?", [secret]).exec(),
      );
      assert.match(logs, /sql-error/);
      assert.ok(!logs.includes(secret), "la valeur ne doit pas être journalisée");
      MorphineDb.config.logValues = true;
      logs = await captureWarnings(() => Animals.find("colonne_inexistante=?", [secret]).exec());
      assert.ok(logs.includes(secret), "logValues réaffiche les valeurs");
    } finally {
      MorphineDb.config.logValues = false;
      MorphineDb.connection.catchError = true;
    }
    // catchError: true : l'erreur levée ne recopie pas la requête avec ses valeurs
    await captureWarnings(async () => {
      await assert.rejects(Animals.find("colonne_inexistante=?", [secret]).exec(), (error) => {
        assert.ok(!JSON.stringify({ ...error, message: error.message }).includes(secret));
        return true;
      });
    });
    // une erreur de validation ne contient pas la valeur refusée
    await assert.rejects(Animals.create({ name: "x" }).exec(), (error) => {
      assert.strictEqual(error.errors[0].value, undefined);
      return true;
    });
  });

  await test(
    "Migration : les données orphelines ne sont pas modifiées, la clé étrangère attend",
    { skip: DB_TYPE === "sqlite3" && "SQLite : pas de contrainte ajoutée après coup" },
    async () => {
      const table = Animals.def.tableName;
      const fk = `${table}_${Breeds.def.tableName}_breedId_fk`;
      const dropFk = () =>
        MorphineDb.query(
          DB_TYPE === "pg"
            ? `ALTER TABLE ${table} DROP CONSTRAINT ${fk.toLowerCase()}`
            : `ALTER TABLE ${table} DROP FOREIGN KEY ${fk}`,
        );
      const { breed } = await createDogs("Rex");
      await dropFk();
      // sans contrainte, une ligne peut pointer vers une race inexistante
      const orphan = await Animals.create({ name: "Orphelin", breedId: 999999 }).exec();
      const logs = await captureWarnings(() => loadModels());
      assert.match(logs, /1 ligne\(s\) pointent vers un Breeds inexistant/);
      assert.strictEqual((await Animals.findone(orphan.id).exec()).breedId, 999999); // intacte
      // la contrainte n'a pas été créée : un autre orphelin passe encore
      const orphan2 = await Animals.create({ name: "Orphelin 2", breedId: 888888 }).exec();
      // une règle inconnue n'est jamais insérée dans le SQL
      await Animals.destroy(orphan.id).exec();
      await Animals.destroy(orphan2.id).exec();
      const rule = Animals.def.attributes.breedId.onDelete;
      Animals.def.attributes.breedId.onDelete = "CASCADE; DROP TABLE x";
      try {
        const bad = await captureWarnings(() => MorphineDb.constraints(Animals));
        assert.match(bad, /règle de clé étrangère inconnue/);
      } finally {
        Animals.def.attributes.breedId.onDelete = rule;
      }
      // données corrigées : la contrainte est créée au chargement suivant
      await loadModels();
      await assert.rejects(Animals.create({ name: "Orphelin 3", breedId: 777777 }).exec());
      assert.strictEqual((await Animals.find({ breedId: breed.id }).exec()).length, 1);
      // after
      await truncateAll();
    },
  );

  await test("Test migrate alter : colonne supprimée puis rétablie", async () => {
    await MorphineDb.query(`ALTER TABLE ${Animals.def.tableName} DROP COLUMN legs`);
    await loadModels();
    let species = await Species.create({ name: "Dog" }).exec();
    let breed = await Breeds.create({ name: "Labrador", speciesId: species.id }).exec();
    const rex = await Animals.create({ name: "Rex", breedId: breed.id }).exec();
    assert.strictEqual(rex.legs, 2); // valeur par défaut de la colonne recréée
    // after
    await truncateAll();
  });

  await test(
    "Test migrate alter : type, défaut et NOT NULL rétablis",
    { skip: DB_TYPE === "sqlite3" && "SQLite ne sait pas modifier une colonne" },
    async () => {
      const table = Animals.def.tableName;
      if (DB_TYPE === "pg") {
        await MorphineDb.query(
          `ALTER TABLE ${table} ALTER COLUMN legs TYPE VARCHAR(20), ALTER COLUMN legs DROP NOT NULL, ALTER COLUMN legs SET DEFAULT '7'`,
        );
      } else {
        await MorphineDb.query(`ALTER TABLE ${table} MODIFY legs VARCHAR(20) NULL DEFAULT '7'`);
      }
      await loadModels();
      const schema = DB_TYPE === "pg" ? "current_schema()" : "DATABASE()";
      const [col] = await MorphineDb.query(
        `SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns WHERE table_schema = ${schema} AND LOWER(table_name) = ? AND column_name = 'legs'`,
        [table.toLowerCase()],
      );
      assert.strictEqual(col.t, DB_TYPE === "pg" ? "integer" : "int");
      assert.strictEqual(col.n, "NO");
      assert.strictEqual(Number(col.d), 2);
    },
  );

  await test("Test migrate recreate", async () => {
    await Species.create({ name: "Dog" }).exec();
    await MorphineDb.close();
    // refusé en production
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    await MorphineDb.init(dbConfig({ migrate: "recreate" }));
    await assert.rejects(loadModels(), /NODE_ENV=production/);
    process.env.NODE_ENV = env;
    assert.strictEqual(await Species.count().exec(), 1); // rien n'a été supprimé
    // sinon, toutes les tables sont vidées
    await loadModels();
    assert.strictEqual(await Species.count().exec(), 0);
    const bird = await Species.create({ name: "Bird" }).exec();
    assert.strictEqual(bird.id, 1);
  });

  await MorphineDb.close();

  // Il faudrait pouvoir faire ça !!!
  // Enfin... je ne sais pas... c'est peut-être pas nécessaire...
  // ici le soucis c'est que comme on renomme Animals.name, on ne peut pas faire de populateAll() car il ne trouve plus sur le champ name
  // il faudrait enregistrer les ID des champs modifiées pour pouvoir les retrouver après
  // await test("Test update with populate", async () => {
  // 	// before
  // 	let speciesDog1 = await Species.create({ name: "Dog" }).exec();
  // 	let speciesDog2 = await Species.create({ name: "Dog" }).exec();
  // 	// test
  // 	const dogs = await Species.update("name='Dog'", {
  // 		name: "Dog 2",
  // 	}).populateAll().exec();
  // 	assert.strictEqual(dogs[0].name, "Dog 2");
  // 	// after
  // 	await truncateAll();
  // });
});
