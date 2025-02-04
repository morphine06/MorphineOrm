

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const test = require("node:test");
const assert = require("node:assert");

const { MorphineDb, Models, loadModels } = require("./index.js");

async function initApp() {
	if (fs.existsSync("./morphineorm.sqlite")) fs.unlinkSync("./morphineorm.sqlite");
	await MorphineDb.init({
		type: "mysql2",
		host: process.env.DBHOST,
		user: process.env.DBUSER,
		password: process.env.DBPASSWORD,
		database: process.env.DBNAME,
		migrate: "alter", // alter, recreate, safe
		port: process.env.DBPORT,
		// port: 5432,
		debug: false,
		dateStrings: true,

		catchError: true,
		engine: "InnoDB",
		collation: "utf8mb4_general_ci",
	});
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
		try {
			// test
			await Animals.drop().exec();
			await Breeds.drop().exec();
			await Species.drop().exec();

			await Animals.find().exec();
		} catch (error) {
			// console.log("error", error);
			assert.strictEqual(error.code, "ER_NO_SUCH_TABLE");
		}
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
		const dogCharly = await Animals.findone(animal.id).populate("breed").populate("breed.species").exec();
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
		let breeds = await Breeds.findone(breed.id).onetomany("Animals", "breed", "animals").populateAll().exec();
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
			if (dog.id === animalCharly.id && dog.name === "Charly" && dog.breed.id === breed.id && dog.breed.name === "Labrador") ok++;
			if (dog.id === animalJazz.id && dog.name === "Jazz" && dog.breed.id === breed.id && dog.breed.name === "Labrador") ok++;
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
		}).populateAll().exec();
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

	await test("Test create() nested", async () => {
		// test
		const dogRex = await Animals.create({
			name: "Rex",
			breed: {
				name: "Labrador",
				species: {
					name: "Dog",
				},
			},
		}).populateAll().exec();
		assert.strictEqual(dogRex.name, "Rex");
		assert.strictEqual(dogRex.breed.name, "Labrador");
		assert.strictEqual(dogRex.breed.species.name, "Dog");
		// after
		await truncateAll();
	});

	await test("Test create() nested already exists and update", async () => {
		// before
		let species = await Species.create({ name: "Dog" }).exec();
		// test
		const dogCharly = await Animals.create({
			name: "Charly",
			breed: {
				name: "Labrador",
				species: {
					id: species.id, // already exists, should update
					name: "Dog 2",
				},
			},
		}).populate("breed").populate("breed.species").exec();
		assert.strictEqual(dogCharly.name, "Charly");
		assert.strictEqual(dogCharly.breed.name, "Labrador");
		assert.strictEqual(dogCharly.breed.species.name, "Dog 2");
		assert.strictEqual(dogCharly.breed.species.id, species.id);
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

		let animalCharly2 = await Animals.updateone(animalCharly.id, { name: "toto not allowed" }).exec();
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
		let animalCharly = await Animals.create({ name: "Charly", breedId: breed.id, legs: 4, birth }).exec();
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
		let animalCharly = await Animals.create({ name: "Charly", breedId: breed.id, legs: 4, birth: "2022-01-01" }).exec();
		console.log("🚀 ~ awaittest ~ animalCharly:", animalCharly);
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


