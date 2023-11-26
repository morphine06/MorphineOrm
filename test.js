require("dotenv").config({ path: ".env.local" });
const fs = require("fs");

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
		dateStrings: true,
	});
	await loadModels();
}

initApp().then(async () => {
	const { Animals, Breeds, Species } = Models;

	// await Animals.truncate().exec();
	// await Breeds.truncate().exec();
	// await Species.truncate().exec();
	await Animals.drop().exec();
	await Breeds.drop().exec();
	await Species.drop().exec();
	await loadModels();


	let dogRex = await Animals.create({
		name: "Rex",
		breed: {
			name: "Labrador",
			species: {
				name: "Dog",
			},
		},
	}).populate("breed").populate("breed.species").exec(true);
	// console.log("🚀 ~ file: test.js:26 ~ initApp ~ dogRex:", dogRex)

	let dogJazz = await Animals.create({
		name: "Jazz",
		breed: {
			name: "Fox Terrier",
			species: {
				id: 1,
				name: "Dog 2",
			},
		},
	}).populate("breed").populate("breed.species").exec(true);
	// console.log("🚀 ~ file: test.js:38 ~ initApp ~ dogJazz:", dogJazz)

	let dogCharly = await Animals.create({
		name: "Charly",
		breedId: 1,
	}).populate("breed").populate("breed.species").exec(true);
	// console.log("🚀 ~ file: test.js:26 ~ initApp ~ dogCharly:", dogCharly)


	let dog1 = await Animals.findone(2).populate("breed").populate("breed.species").exec(true);
	// console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog1:", dog1)

	let dog2 = await Animals.findone({ id: 2 }).populateAll().exec(true);
	// console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog2:", dog2)

	let dog3 = await Animals.findone("breed.name=?", ["Labrador"]).populate("breed").populate("breed.species").exec(true);
	// console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog3:", dog3)

	const animals1 = await Animals.find().populate("breed").populate("breed.species").exec();
	// console.log("🚀 ~ file: test.js:61 ~ initApp ~ animals:", JSON.stringify(animals1, null, 2))

	const animals2 = await Animals.find({ "breed.speciesId": 1 }).populate("breed").populate("breed.species").exec();
	// console.log("🚀 ~ file: test.js:61 ~ initApp ~ animals:", JSON.stringify(animals2, null, 2))

	let breeds = await Breeds.find().debug().onetomany("Animals", "breed", "animals").populateAll().exec();
	console.log("🚀 ~ file: test.js:67 ~ initApp ~ breeds:", JSON.stringify(breeds, null, 2));

});


