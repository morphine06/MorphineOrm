require("dotenv").config({ path: `.env.local` });

const { MorphineDb, Models, loadModels } = require("./index.js");

async function initApp() {
    await MorphineDb.init({
        host: process.env.DBHOST,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBNAME,
        migrate: "alter", // alter, recreate, safe
        port: process.env.DBPORT,
    });
    await loadModels();
}

initApp().then(async () => {
    const { Dogs, Kinds } = Models;

    let dogRex = await Dogs.create({
        name: "Rex",
        kind: {
            name: "Labrador",
        }
    }).populate("kind").exec(true);
    console.log("🚀 ~ file: test.js:26 ~ initApp ~ dogRex:", dogRex)

    // const dogs = await Dogs.find().populate('kind').exec();
    // console.log(dogs);
})
