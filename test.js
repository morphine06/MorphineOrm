require("dotenv").config({ path: `.env.local` });
const fs = require("fs");

const { MorphineDb, Models, loadModels } = require("./index.js");

async function initApp() {
    if (fs.existsSync("./morphineorm.sqlite")) fs.unlinkSync("./morphineorm.sqlite");
    await MorphineDb.init({
        type: "sqlite3",
        host: process.env.DBHOST,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBNAME,
        migrate: "alter", // alter, recreate, safe
        port: process.env.DBPORT,
        dateStrings: true
    });
    await loadModels();
}

initApp().then(async () => {
    const { Animals, Breeds, Species } = Models;

    await Animals.truncate().exec();
    await Breeds.truncate().exec();
    await Species.truncate().exec();

    let dogRex = await Animals.create({
        name: "Rex",
        breed: {
            name: "Labrador",
            species: {
                name: "Dog",
            }
        }
    }).populate("breed").populate("breed.species").exec(true);
    console.log("🚀 ~ file: test.js:26 ~ initApp ~ dogRex:", dogRex)

    let dogJazz = await Animals.create({
        name: "Jazz",
        breed: {
            name: "Fox Terrier",
            species: {
                id: 1,
                name: "Dog 2",
            }
        }
    }).populate("breed").populate("breed.species").exec(true);
    console.log("🚀 ~ file: test.js:38 ~ initApp ~ dogJazz:", dogJazz)

    let dog1 = await Animals.findone(2).populate("breed").populate("breed.species").exec(true);
    console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog1:", dog1)

    let dog2 = await Animals.findone({ id: 2 }).populate("breed").populate("breed.species").exec(true);
    console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog2:", dog2)

    let dog3 = await Animals.findone("breed.name=?", ["Labrador"]).populate("breed").populate("breed.species").exec(true);
    console.log("🚀 ~ file: test.js:51 ~ initApp ~ dog3:", dog3)

    // const dogs = await Dogs.find().populate('kind').exec();
    // console.log(dogs);
})


