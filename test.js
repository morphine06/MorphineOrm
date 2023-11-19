const { DbMysql, Models, loadModels } = require("./index.js");

async function initApp() {
    await DbMysql.init({
        host: process.env.DBHOST,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBNAME,
        migrate: "alter", // alter, prod
        port: 3306,
    });
    await loadModels();
}

initApp().then(async () => {
    const users = await Models.User.findAll();
    console.log(users);
}
