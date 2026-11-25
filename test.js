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

// Configuration de connexion de la base testée ; overrides l'emporte sur tout.
function dbConfig(overrides = {}) {
  const common = {
    type: DB_TYPE,
    migrate: "alter",
    debug: false,
    catchError: true,
    quietMigration: true,
  };
  const byType = {
    sqlite3: { database: "morphineorm-test" },
    pg: {
      host: process.env.PGHOST || "localhost",
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "morphineorm",
      port: process.env.PGPORT || 5432,
      dateStrings: true,
    },
    mysql2: {
      host: process.env.DBHOST,
      user: process.env.DBUSER,
      password: process.env.DBPASSWORD,
      database: process.env.DBNAME,
      port: process.env.DBPORT,
      dateStrings: true,
      engine: "InnoDB",
      collation: "utf8mb4_general_ci",
    },
  };
  if (!byType[DB_TYPE]) throw new Error(`Base inconnue : ${DB_TYPE} (mysql2, sqlite3 ou pg)`);
  return { ...common, ...byType[DB_TYPE], ...overrides };
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

  // Écrit des modèles temporaires, les charge, exécute fn, puis supprime leurs tables.
  async function withTempModels(files, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "morphine-models-"));
    for (const [name, def] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, `${name}.model.js`), `module.exports = () => (${def});`);
    }
    try {
      await loadModels(dir);
      await fn();
    } finally {
      for (const name of Object.keys(files).reverse()) {
        if (!Models[name]) continue;
        try {
          await Models[name].drop().exec();
        } catch {
          /* table jamais créée */
        } finally {
          delete Models[name];
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  await test("Unicode et emoji", async () => {
    const { breed } = await createDogs();
    const name = "Rex 🐶 Ça été naïve — 日本語 🇫🇷";
    const infos = { note: "très 👍", tags: ["café", "ß", "😀"] };
    const rex = await Animals.create({ name, breedId: breed.id, infos }).exec();
    assert.strictEqual(rex.name, name);
    assert.deepStrictEqual(rex.infos, infos);
    assert.strictEqual((await Animals.find({ name }).exec()).length, 1);
    // after
    await truncateAll();
  });

  await test("Longueur maximale d'un texte", async () => {
    const { breed } = await createDogs();
    const max = "é".repeat(255); // 255 caractères multi-octets
    const rex = await Animals.create({ name: max, breedId: breed.id }).exec();
    assert.strictEqual(rex.name, max);
    await assert.rejects(Animals.create({ name: max + "e", breedId: breed.id }).exec(), {
      code: "E_VALIDATION",
    });
    // after
    await truncateAll();
  });

  await test("Nombres : zéro, négatif, grand entier", async () => {
    const { breed } = await createDogs();
    for (const legs of [0, -3, 2147483647]) {
      const a = await Animals.create({ name: "Rex", breedId: breed.id, legs }).exec();
      assert.strictEqual(a.legs, legs); // 0 est falsy : il ne doit pas devenir la valeur par défaut
      assert.strictEqual((await Animals.updateone(a.id, { legs }).exec()).legs, legs);
    }
    // after
    await truncateAll();
  });

  await test("Dates : objets Date et dayjs, createdAtForced, ignoreUpdatedAt", async () => {
    const { breed } = await createDogs();
    const dayjs = require("dayjs");
    const rex = await Animals.create({
      name: "Rex",
      breedId: breed.id,
      birth: new Date(2021, 2, 4, 12, 0, 0),
      createdAtForced: "2020-02-02 10:00:00",
    }).exec();
    assert.strictEqual(rex.birth, "2021-03-04");
    assert.strictEqual(rex.createdAt, "2020-02-02 10:00:00");
    const jazz = await Animals.create({
      name: "Jazz",
      breedId: breed.id,
      birth: dayjs("2019-07-14"),
    }).exec();
    assert.strictEqual(jazz.birth, "2019-07-14");
    await Animals.updateone(rex.id, { updatedAtForced: "2020-03-03 10:00:00" }).exec();
    const kept = await Animals.updateone(rex.id, { legs: 3, ignoreUpdatedAt: true }).exec();
    assert.strictEqual(kept.legs, 3);
    assert.strictEqual(kept.updatedAt, "2020-03-03 10:00:00");
    // after
    await truncateAll();
  });

  await test("Un virtual qui lève une erreur vaut null", async () => {
    const { breed } = await createDogs();
    Animals.def.virtuals.broken = function () {
      throw new Error("boum");
    };
    try {
      let rex;
      const logs = await captureWarnings(async () => {
        rex = await Animals.create({ name: "Rex", breedId: breed.id, birth: "2020-01-01" }).exec();
      });
      assert.strictEqual(rex.broken, null);
      assert.strictEqual(typeof rex.age, "number"); // les autres virtuals sont calculés
      assert.match(logs, /error in virtuals/);
    } finally {
      delete Animals.def.virtuals.broken;
    }
    // after
    await truncateAll();
  });

  await test("populate() d'un alias inconnu est ignoré", async () => {
    await createDogs("Rex");
    const rows = await Animals.find().populate("inconnu").populate("breed.inconnu").exec();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].breed.name, "Labrador");
    // after
    await truncateAll();
  });

  await test("MorphineDb.query() : écriture et paramètres", async () => {
    await Species.create({ name: "A" }).exec();
    await Species.create({ name: "A" }).exec();
    const res = await MorphineDb.query(`UPDATE ${Species.def.tableName} SET name=? WHERE name=?`, [
      "B",
      "A",
    ]);
    assert.strictEqual(res.affectedRows, 2);
    const rows = await MorphineDb.query(`SELECT name FROM ${Species.def.tableName} WHERE name=?`, [
      "B",
    ]);
    assert.strictEqual(rows.length, 2);
    // after
    await truncateAll();
  });

  await test("Modèles : auto-référence et deux clés vers le même modèle", async () => {
    await withTempModels(
      {
        Teams: `{ attributes: { id: { type: "integer", autoincrement: true, primary: true }, name: { type: "string", defaultsTo: "" } } }`,
        Matches: `{ attributes: {
          id: { type: "integer", autoincrement: true, primary: true },
          homeId: { model: "Teams", alias: "home", onDelete: "RESTRICT", onUpdate: "RESTRICT" },
          awayId: { model: "Teams", alias: "away", onDelete: "RESTRICT", onUpdate: "RESTRICT" },
        } }`,
        Categories: `{ attributes: {
          id: { type: "integer", autoincrement: true, primary: true },
          name: { type: "string", defaultsTo: "" },
          parentId: { model: "Categories", alias: "parent" },
        } }`,
      },
      async () => {
        const { Teams, Matches, Categories } = Models;
        const lyon = await Teams.create({ name: "Lyon" }).exec();
        const nice = await Teams.create({ name: "Nice" }).exec();
        const m = await Matches.create({ homeId: lyon.id, awayId: nice.id })
          .populate("home")
          .populate("away")
          .exec();
        assert.strictEqual(m.home.name, "Lyon");
        assert.strictEqual(m.away.name, "Nice");
        const away = await Matches.find("away.name=?", ["Nice"]).populateAll().exec();
        assert.strictEqual(away.length, 1);
        assert.strictEqual(
          (await Matches.find("home.name=?", ["Nice"]).populateAll().exec()).length,
          0,
        );

        const root = await Categories.create({ name: "Animaux" }).exec();
        const dogs = await Categories.create({ name: "Chiens", parentId: root.id }).exec();
        await Categories.create({ name: "Chats", parentId: root.id }).exec();
        const child = await Categories.findone(dogs.id).populate("parent").exec();
        assert.strictEqual(child.parent.name, "Animaux");
        assert.strictEqual(
          (await Categories.findone(root.id).populate("parent").exec()).parent,
          null,
        );
        const withChildren = await Categories.findone(root.id)
          .onetomany("Categories", "parent", "children")
          .exec();
        assert.deepStrictEqual(withChildren.children.map((c) => c.name).sort(), [
          "Chats",
          "Chiens",
        ]);
      },
    );
  });

  await test("Modèle lié à un modèle inexistant, dossier de modèles absent", async () => {
    const before = Object.keys(Models).length;
    await loadModels(path.join(os.tmpdir(), "dossier-qui-n-existe-pas"));
    assert.strictEqual(Object.keys(Models).length, before);
    const logs = await captureWarnings(() =>
      withTempModels(
        {
          Ghosts: `{ attributes: { id: { type: "integer", autoincrement: true, primary: true }, ownerId: { model: "Inexistant", alias: "owner" } } }`,
        },
        async () => {
          assert.ok(Models.Ghosts);
        },
      ),
    );
    assert.match(logs, /Ghosts\.ownerId : modèle Inexistant introuvable/);
  });

  await test("Transaction validée : toutes les écritures et la valeur rendue", async () => {
    const result = await MorphineDb.transaction(async (tx) => {
      const dog = await Species.create({ name: "Dog" }).exec();
      const breed = await Breeds.create({ name: "Labrador", speciesId: dog.id }).exec();
      await Animals.create({ name: "Rex", breedId: breed.id }).exec();
      await tx.query(`UPDATE ${Species.def.tableName} SET name=? WHERE id=?`, ["Dog 2", dog.id]);
      // dans la transaction, les lectures voient ses propres écritures
      assert.strictEqual((await Species.findone(dog.id).exec()).name, "Dog 2");
      return breed.id;
    });
    assert.strictEqual(typeof result, "number");
    assert.strictEqual(await Animals.count().exec(), 1);
    assert.strictEqual((await Species.findone({ name: "Dog 2" }).exec()).name, "Dog 2");
    // after
    await truncateAll();
  });

  await test("Transaction annulée : une erreur défait tout et est relancée", async () => {
    await Species.create({ name: "Avant" }).exec();
    await assert.rejects(
      MorphineDb.transaction(async () => {
        await Species.create({ name: "Dog" }).exec();
        await Species.updateone({ name: "Avant" }, { name: "Modifié" }).exec();
        throw new Error("échec métier");
      }),
      /échec métier/,
    );
    assert.strictEqual(await Species.count().exec(), 1);
    assert.strictEqual((await Species.find().exec())[0].name, "Avant");
    // une erreur de validation annule aussi
    const { breed } = await createDogs();
    await assert.rejects(
      MorphineDb.transaction(async () => {
        await Animals.create({ name: "Rex", breedId: breed.id }).exec();
        await Animals.create({ name: "R", breedId: breed.id }).exec();
      }),
      { code: "E_VALIDATION" },
    );
    assert.strictEqual(await Animals.count().exec(), 0);
    // after
    await truncateAll();
  });

  await test("Transaction : une erreur SQL annule même avec catchError: false", async () => {
    MorphineDb.connection.catchError = false;
    try {
      await captureWarnings(() =>
        assert.rejects(
          MorphineDb.transaction(async () => {
            await Species.create({ name: "Dog" }).exec();
            await Species.find("colonne_inexistante=1").exec();
          }),
        ),
      );
    } finally {
      MorphineDb.connection.catchError = true;
    }
    assert.strictEqual(await Species.count().exec(), 0);
  });

  await test("Transaction imbriquée : rejoint la transaction en cours", async () => {
    await assert.rejects(
      MorphineDb.transaction(async () => {
        await Species.create({ name: "Dehors" }).exec();
        await MorphineDb.transaction(async () => {
          await Species.create({ name: "Dedans" }).exec();
        });
        throw new Error("annule les deux");
      }),
    );
    assert.strictEqual(await Species.count().exec(), 0);
    const nb = await MorphineDb.transaction(async () => {
      await MorphineDb.transaction(() => Species.create({ name: "A" }).exec());
      return Species.count().exec();
    });
    assert.strictEqual(nb, 1);
    // after
    await truncateAll();
  });

  await test("Transaction : isolée des autres requêtes jusqu'à sa validation", async () => {
    let created, open;
    const createdP = new Promise((r) => (created = r));
    const gate = new Promise((r) => (open = r));
    const tx = MorphineDb.transaction(async () => {
      await Species.create({ name: "Dog" }).exec();
      created();
      await gate;
    });
    await createdP;
    // requête lancée hors de la transaction
    const outside = Species.count().exec();
    if (DB_TYPE !== "sqlite3") {
      assert.strictEqual(await outside, 0); // la ligne n'est pas encore validée
      open();
    } else {
      open(); // SQLite : une seule connexion, la requête attend la fin de la transaction
      assert.strictEqual(await outside, 1);
    }
    await tx;
    assert.strictEqual(await Species.count().exec(), 1);
    // after
    await truncateAll();
  });

  await test("Transactions en parallèle", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `Espèce ${i}`);
    await Promise.all(
      names.map((name, i) =>
        MorphineDb.transaction(async () => {
          await Species.create({ name }).exec();
          await Species.create({ name: name + " bis" }).exec();
          if (i % 2) throw new Error("annulée");
        }).catch(() => {}),
      ),
    );
    const rows = await Species.find().exec();
    assert.strictEqual(rows.length, 8); // 4 transactions validées × 2 lignes
    assert.ok(rows.every((r) => Number(r.name.split(" ")[1]) % 2 === 0));
    // les connexions ont été rendues : une nouvelle transaction passe
    await MorphineDb.transaction(() => Species.create({ name: "Après" }).exec());
    assert.strictEqual(await Species.count().exec(), 9);
    // after
    await truncateAll();
  });

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
    // after
    await truncateAll();
  });

  await test("SQL brut : les instructions qui changent l'état de la connexion sont refusées", async () => {
    const refused = [
      "BEGIN",
      "  commit",
      "/* commentaire */ ROLLBACK",
      "-- commentaire\nBEGIN",
      "(BEGIN)",
    ];
    if (DB_TYPE !== "sqlite3") {
      refused.push(
        "START TRANSACTION",
        "SET autocommit = 0",
        "SET FOREIGN_KEY_CHECKS = 0",
        "CREATE TEMPORARY TABLE t (x INT)",
      );
    }
    if (DB_TYPE === "mysql2")
      refused.push("USE mysql", "LOCK TABLES Species2 WRITE", "XA START 'x'");
    if (DB_TYPE === "pg")
      refused.push("SET search_path = autre", "DISCARD ALL", "LISTEN canal", "END");
    for (const sql of refused) {
      await assert.rejects(MorphineDb.query(sql), { code: "E_SESSION_STATEMENT" }, sql);
      await assert.rejects(Species.query(sql).exec(), { code: "E_SESSION_STATEMENT" }, sql);
    }
    // les requêtes ordinaires passent, y compris un UPDATE … SET
    await Species.create({ name: "Dog" }).exec();
    const res = await MorphineDb.query(`UPDATE ${Species.def.tableName} SET name=? WHERE name=?`, [
      "Dog 2",
      "Dog",
    ]);
    assert.strictEqual(res.affectedRows, 1);
    assert.strictEqual(
      (await Species.query(`SELECT * FROM ${Species.def.tableName}`).exec()).length,
      1,
    );
    // after
    await truncateAll();
  });

  await test("Transaction : SAVEPOINT autorisé, SET refusé", async () => {
    const rollbackTo = DB_TYPE === "sqlite3" ? "ROLLBACK TO s1" : "ROLLBACK TO SAVEPOINT s1";
    await MorphineDb.transaction(async (tx) => {
      await Species.create({ name: "Gardée" }).exec();
      await tx.query("SAVEPOINT s1");
      await Species.create({ name: "Annulée" }).exec();
      await tx.query(rollbackTo);
      await tx.query("RELEASE SAVEPOINT s1");
      if (DB_TYPE !== "sqlite3") {
        await assert.rejects(tx.query("SET FOREIGN_KEY_CHECKS = 0"), {
          code: "E_SESSION_STATEMENT",
        });
      }
      await assert.rejects(tx.query("COMMIT"), { code: "E_SESSION_STATEMENT" });
    });
    assert.deepStrictEqual(
      (await Species.find().exec()).map((r) => r.name),
      ["Gardée"],
    );
    // after
    await truncateAll();
  });

  await test(
    "SQL brut : la connexion est remise à zéro, même si le refus est contourné",
    { skip: DB_TYPE === "sqlite3" && "SQLite : pas de pool" },
    async () => {
      // une seule connexion : si un état survivait, la requête suivante le verrait
      await MorphineDb.close();
      await MorphineDb.init(dbConfig({ migrate: "safe", connectionLimit: 1 }));
      try {
        if (DB_TYPE === "pg") {
          await MorphineDb.query("SELECT set_config('statement_timeout', '1234', false)");
          assert.strictEqual(
            (await MorphineDb.query("SHOW statement_timeout"))[0].statement_timeout,
            "0",
          );
          await MorphineDb.query("SELECT pg_advisory_lock(42)");
          const [locks] = await MorphineDb.query(
            "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'",
          );
          assert.strictEqual(locks.n, 0);
          // une seule instruction par requête, même sans valeurs
          await assert.rejects(MorphineDb.query("SELECT 1; SELECT 2"));
        } else {
          await MorphineDb.query("SELECT @v := 5 AS v");
          await MorphineDb.query("SELECT GET_LOCK('morphine-test', 0)");
          const [state] = await MorphineDb.query(
            "SELECT @v AS v, IS_FREE_LOCK('morphine-test') AS libre, @@sql_mode AS mode, @@collation_connection AS coll",
          );
          assert.strictEqual(state.v, null); // variable effacée
          assert.strictEqual(state.libre, 1); // verrou libéré
          assert.strictEqual(state.mode, ""); // nos réglages réappliqués
          assert.strictEqual(state.coll, "utf8mb4_general_ci");
        }
        // les requêtes de l'ORM fonctionnent toujours
        await Species.create({ name: "Dog" }).exec();
        assert.strictEqual(await Species.count().exec(), 1);
      } finally {
        await truncateAll();
        await MorphineDb.close();
        await MorphineDb.init(dbConfig({ migrate: "safe" }));
      }
    },
  );

  await test(
    "Transaction : un SET LOCAL ne survit pas à la transaction",
    { skip: DB_TYPE !== "pg" && "SET LOCAL : PostgreSQL" },
    async () => {
      await MorphineDb.close();
      await MorphineDb.init(dbConfig({ migrate: "safe", connectionLimit: 1 }));
      try {
        await MorphineDb.transaction(async (tx) => {
          await tx.query("SET LOCAL statement_timeout = 4321");
          assert.strictEqual(
            (await tx.query("SHOW statement_timeout"))[0].statement_timeout,
            "4321ms",
          );
          await tx.query("SELECT set_config('lock_timeout', '999', false)");
        });
        const [after] = await MorphineDb.query(
          "SELECT current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt",
        );
        assert.strictEqual(after.st, "0");
        assert.strictEqual(after.lt, "0"); // même un réglage de session fait dans la transaction
      } finally {
        await MorphineDb.close();
        await MorphineDb.init(dbConfig({ migrate: "safe" }));
      }
    },
  );

  await test(
    "Connexion : options du pool, collation, sql_mode",
    { skip: DB_TYPE === "sqlite3" && "SQLite : pas de pool" },
    async () => {
      await MorphineDb.close();
      try {
        await MorphineDb.init(
          dbConfig({
            migrate: "safe",
            connectionLimit: 3,
            collation: "utf8mb4_unicode_ci",
            sqlMode: "STRICT_TRANS_TABLES",
          }),
        );
        if (DB_TYPE === "pg") {
          assert.strictEqual(MorphineDb.connection.pool.options.max, 3);
        } else {
          const { pool } = MorphineDb.connection;
          assert.strictEqual(pool.pool.config.connectionLimit, 3);
          const [session] = await MorphineDb.query(
            "SELECT @@collation_connection AS coll, @@SESSION.sql_mode AS mode",
          );
          assert.strictEqual(session.coll, "utf8mb4_unicode_ci");
          assert.match(session.mode, /STRICT_TRANS_TABLES/);
          // chaque connexion du pool reçoit les réglages
          const sessions = await Promise.all(
            [1, 2, 3].map(() => MorphineDb.query("SELECT @@collation_connection AS coll")),
          );
          assert.ok(sessions.every(([r]) => r.coll === "utf8mb4_unicode_ci"));
        }
      } finally {
        await MorphineDb.close();
        await MorphineDb.init(dbConfig({ migrate: "safe" }));
      }
    },
  );

  await test(
    "Connexion : init() échoue si la base est injoignable",
    { skip: DB_TYPE === "sqlite3" && "SQLite : pas de serveur" },
    async () => {
      await MorphineDb.close();
      try {
        await assert.rejects(
          MorphineDb.init(dbConfig({ password: "mauvais-mot-de-passe", user: "personne" })),
          /connexion à la base impossible/,
        );
        await assert.rejects(
          MorphineDb.init(dbConfig({ port: 1 })),
          /connexion à la base impossible/,
        );
      } finally {
        await MorphineDb.init(dbConfig({ migrate: "safe" }));
      }
      // la connexion normale fonctionne
      await Species.create({ name: "Dog" }).exec();
      assert.strictEqual(await Species.count().exec(), 1);
      await truncateAll();
    },
  );

  await test("close() : une requête ensuite échoue clairement, un second close() est sans effet", async () => {
    await MorphineDb.close();
    await assert.rejects(Species.find().exec(), /connexion/);
    await MorphineDb.close();
  });

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
