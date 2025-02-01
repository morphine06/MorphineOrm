

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

	await test("Test drop model", async () => {
		try {
			await Animals.drop().exec();
			await Breeds.drop().exec();
			await Species.drop().exec();

			await Animals.find().exec();
		} catch (error) {
			// console.log("error", error);
			assert.strictEqual(error.code, "ER_NO_SUCH_TABLE");
		}
	});

	await test("Test loadModels()", async () => {
		await loadModels();
		const animals = await Animals.find().exec();
		assert.strictEqual(animals.length, 0);
	});

	await test("Test create row", async () => {
		const bird = await Species.create({ name: "Bird" }).exec(true);
		assert.strictEqual(bird.name, "Bird");
	});

	await test("Test findone row with ID", async () => {
		const bird = await Species.findone(1).exec(true);
		assert.strictEqual(bird.name, "Bird");
	});
	await test("Test findone row with query", async () => {
		const bird = await Species.findone("name='Bird'").exec(true);
		assert.strictEqual(bird.name, "Bird");
	});

	await test("Test updateone row", async () => {
		const bird = await Species.updateone(1, { name: "Bird 2" }).exec(true);
		assert.strictEqual(bird.name, "Bird 2");
	});

	await test("Test destroy row", async () => {
		const fish = await Species.create({ name: "Fish" }).exec(true);
		await Species.destroy(fish.id).exec();
		const bird = await Species.findone(fish.id).exec(true);
		console.log("🚀 ~ awaittest ~ bird:", bird);
		// assert.strictEqual(bird, undefined);
	});

	await test("Test create nested", async () => {
		const dogRex = await Animals.create({
			name: "Rex",
			breed: {
				name: "Labrador",
				species: {
					name: "Dog",
				},
			},
		}).populate("breed").populate("breed.species").exec(true);
		assert.strictEqual(dogRex.name, "Rex");
		assert.strictEqual(dogRex.breed.name, "Labrador");
		assert.strictEqual(dogRex.breed.species.name, "Dog");
	});

	await test("Test create nested already exists and update", async () => {
		const dogCharly = await Animals.create({
			name: "Charly",
			breed: {
				id: 1, // already exists
				name: "Labrador",
				species: {
					id: 2, // already exists, should update
					name: "Dog 2",
				},
			},
		}).populate("breed").populate("breed.species").exec(true);
		assert.strictEqual(dogCharly.id, 2);
		assert.strictEqual(dogCharly.name, "Charly");
		assert.strictEqual(dogCharly.breed.name, "Labrador");
		assert.strictEqual(dogCharly.breed.species.name, "Dog 2");
	});


	await test("Test findone", async () => {
		const dog2 = await Animals.findone(2).exec(true);
		assert.strictEqual(dog2.name, "Charly");
	});

	await test("Test findone with populate", async () => {
		const dog2 = await Animals.findone(2).populate("breed").populate("breed.species").exec(true);
		assert.strictEqual(dog2.id, 2);
		assert.strictEqual(dog2.name, "Charly");
		assert.strictEqual(dog2.breed.name, "Labrador");
		assert.strictEqual(dog2.breed.species.name, "Dog 2");
	});

	await test("Test find with query string", async () => {
		const dogs = await Animals.find("breed.name=?", ["Labrador"]).populate("breed").populate("breed.species").exec(true);
		assert.strictEqual(dogs.length, 2);
		let dog2 = dogs[1];
		assert.strictEqual(dog2.id, 2);
		assert.strictEqual(dog2.name, "Charly");
		assert.strictEqual(dog2.breed.name, "Labrador");
		assert.strictEqual(dog2.breed.species.name, "Dog 2");
	});

	await test("Test find with where and populate", async () => {
		const dogs = await Animals.find("breed.speciesId=?", [4]).populate("breed").populate("breed.species").exec(true);
		assert.strictEqual(dogs.length, 2);
		let dog2 = dogs[1];
		assert.strictEqual(dog2.id, 2);
		assert.strictEqual(dog2.name, "Charly");
		assert.strictEqual(dog2.breed.name, "Labrador");
		assert.strictEqual(dog2.breed.species.name, "Dog 2");
	});

	await test("Test find with query string and populateAll", async () => {
		const dogs = await Animals.find("breed.speciesId=?", [4]).populateAll().exec(true);
		assert.strictEqual(dogs.length, 2);
		let dog2 = dogs[1];
		assert.strictEqual(dog2.id, 2);
		assert.strictEqual(dog2.name, "Charly");
		assert.strictEqual(dog2.breed.name, "Labrador");
		assert.strictEqual(dog2.breed.species.name, "Dog 2");
	});

	await test("Test find with onetomany", async () => {
		let breeds = await Breeds.find().onetomany("Animals", "breed", "animals").populateAll().exec();
		assert.strictEqual(breeds.length, 1);
		let breed = breeds[0];
		assert.strictEqual(breed.animals.length, 2);
		assert.strictEqual(breed.name, "Labrador");
		assert.strictEqual(breed.species.name, "Dog 2");
	});

	await test("Test find with selected", async () => {
		const dogs = await Animals.find().select("id, name").exec(true); // or .select(["id", "name"])
		assert.strictEqual(dogs.length, 2);
		assert.strictEqual(dogs[0].breedId, undefined);
	});



	await test("Test updateone", async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		const dogCharly = await Animals.updateone(2, {
			name: "Charly 2",
		}).debug().exec(true);
		assert.strictEqual(dogCharly.id, 2);
		assert.strictEqual(dogCharly.name, "Charly 2");
	});

	await test("Test updateone and populateAll()", async () => {
		const dogCharly = await Animals.updateone(2, {
			name: "Charly 2",
		}).populateAll().exec(true);
		console.log("🚀 ~ awaittest ~ dogCharly:", dogCharly);
		assert.strictEqual(dogCharly.id, 2);
		assert.strictEqual(dogCharly.name, "Charly 2");
	});

	// Il faudrait pouvoir faire ça !!!
	// await test("Test updateone with populate", async () => {
	// 	const dogCharly = await Animals.update("name='Charly 2'", {
	// 		name: "Charly",
	// 	}).exec(true);
	// 	console.log("🚀 ~ awaittest ~ dogCharly:", dogCharly);
	// 	assert.strictEqual(dogCharly.id, 2);
	// 	assert.strictEqual(dogCharly.name, "Charly");
	// 	assert.strictEqual(dogCharly.species.name, "Dog 2");
	// });




	// // console.log("🚀 ~ file: test.js:26 ~ initApp ~ dogRex:", dogRex)

	// let dogJazz = await Animals.create({
	// 	name: "Jazz",
	// 	breed: {
	// 		name: "Fox Terrier",
	// 		species: {
	// 			id: 1,
	// 			name: "Dog 2",
	// 		},
	// 	},
	// }).populate("breed").populate("breed.species").exec(true);
	// // console.log("🚀 ~ file: test.js:38 ~ initApp ~ dogJazz:", dogJazz)

	// let dogCharly = await Animals.create({
	// 	name: "Charly",
	// 	breedId: 1,
	// }).populate("breed").populate("breed.species").exec(true);
	// // console.log("🚀 ~ file: test.js:26 ~ initApp ~ dogCharly:", dogCharly)


	// let dog2 = await Animals.findone(2).populate("breed").populate("breed.species").exec(true);
	// // console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog2:", dog2)

	// let dog2 = await Animals.findone({ id: 2 }).populateAll().exec(true);
	// // console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog2:", dog2)

	// let dog3 = await Animals.findone("breed.name=?", ["Labrador"]).populate("breed").populate("breed.species").exec(true);
	// // console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog3:", dog3)

	// const animals1 = await Animals.find().populate("breed").populate("breed.species").exec();
	// // console.log("🚀 ~ file: test.js:61 ~ initApp ~ animals:", JSON.stringify(animals1, null, 2))

	// const animals2 = await Animals.find({ "breed.speciesId": 1 }).populate("breed").populate("breed.species").exec();
	// // console.log("🚀 ~ file: test.js:61 ~ initApp ~ animals:", JSON.stringify(animals2, null, 2))

	// let breeds = await Breeds.find().debug().onetomany("Animals", "breed", "animals").populateAll().exec();
	// console.log("🚀 ~ file: test.js:67 ~ initApp ~ breeds:", JSON.stringify(breeds, null, 2));

});


