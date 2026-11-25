require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
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
    console.log("🚀 ~ awaittest ~ primary:", primary);
    let attributes = Animals.getAttributes();
    console.log("🚀 ~ awaittest ~ attributes:", attributes);
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
    console.log("🚀 ~ awaittest ~ animalCharly:", animalCharly);
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
