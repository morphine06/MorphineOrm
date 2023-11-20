# MorphineOrm

## Features

- [x] Original ! No other ORM is like MorphineOrm.
- [x] Really fast !
- [x] Support MySQL, MariaDB, PostgreSQL, CockroachDB, SQLite, Microsoft SQL Server and Oracle.
- [x] Support associations one-to-one, one-to-many. Easy to do many-to-one or many-to-many associations (but not automatized... it's a developper choice).
- [x] Easy to learn, easy to use.
- [x] Synchronize the database with the models that you define (columns, indexes, tables).
- [x] Easy to do your own SQL queries.

## Installation

- Install the npm package:

```js
npm install morphine-orm
```

- Install a database driver:

    - for MySQL or MariaDB `npm install mysql2` (you can install mysql instead of mysql2)

    - for PostgreSQL or CockroachDB `npm install pg`
    - for SQLite `npm install sqlite3`
    - for Microsoft SQL Server `npm install mssql`
    - for Oracle `npm install oracledb`

## Usage

### 1. Define models

The models that you define are pure JavaScript objects. No need to extend any class or register anything.

Tables are automatically created from models when the application starts.

    
```js
// /models/Dogs.model.js
module.exports = function mymodel() {
	return {
		attributes: {
			id: {
				type: "integer",
				autoincrement: true,
				primary: true,
			},
			name: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
            birth: {
				type: "date",
				defaultsTo: "0000-00-00",
				index: true,
			},
			kindId: {
				model: "Kinds",
				alias: "kind",
			},
		},
	};
}
```

```js
// /models/Kinds.model.js
module.exports = function mymodel() {
	return {
		attributes: {
			id: {
				type: "integer",
				autoincrement: true,
				primary: true,
			},
			name: {
				type: "string",
				defaultsTo: "",
				index: true,
			},
		},
	};
}
```

By default the table name is the model name in lowercase. You can override this by setting the `tableName` attribute in the model.

Types are the same as in [MySQL](https://dev.mysql.com/doc/refman/8.0/en/data-types.html).


### 2. Initialize the ORM

Try to initialize the ORM in the `app.js` file of your application **before require your controllers**.

```js
// /app.js
await DbMysql.init({
    host: process.env.DBHOST,
    user: process.env.DBUSER,
    password: process.env.DBPASSWORD,
    database: process.env.DBNAME,
    migrate: "alter", // alter, recreate, safe
    port: 3306,
});
await loadModels("./models");
```

`migrate: "alter"` will create the tables if they don't exist and add new columns and indexes. It will not delete columns or tables.

`migrate: "recreate"` will create the tables if they don't exist and add new columns and indexes. It will delete columns or tables and **delete all records**.

`migrate: "safe"` will not create tables or add columns or indexes. None modification on tables will be done.

`loadModels(pathModels)` will load all models in the folder and subfolders passed as `pathModels`. 

### 3. Create a new record

#### 3.1. Create a record with only the attributes of the model



```js
const { Models } = require("morphine-orm");
const { Dogs } = Models;

const dogRex = await Dogs.create({
    name: "Rex",
    birth: "2019-10-06",
}).exec();

// dogRex = {
//     id: 1,
//     name: "Rex",
//     birth: "2019-10-06",
//     kindId: 0,
// }
```

#### 3.2. Create a record with the attributes of the model and the attributes of the associated model

```js
const dogJazz = await Dogs.create({
    name: "Jazz",
    birth: "2019-10-06",
    kind: {
        name: "Labrador",
    },
}).populate('kind').exec();

// dogJazz = {
//     id: 2,
//     name: "Jazz",
//     kindId: 1,
//     kind: {
//         id: 1,
//         name: "Labrador",
//     },
// }
```

Note the `populate('kind')` method. This method will populate the `kind` attribute of the dog with the associated kind. This will create a new record in the `Dogs` table and a new record in the `Kinds` table !

Now, if you create a new dog with the same kind, it will not create a new record in the `Kinds` table but will use the existing one :

```js
const dogNewton = await Dogs.create({
    name: "Newton",
    birth: "2019-10-06",
    kind: {
        id: 1,
        name: "Labrador",
    },
}).populate('kind').exec();

// strictly the same as :
const dogNewtonBis = await Dogs.create({
    name: "Newton",
    birth: "2019-10-06",
    kindId: 1,
}).populate('kind').exec();

// dogNewton = dogNewtonBis = {
//     id: 2,
//     name: "Jazz",
//     kindId: 1,
//     kind: {
//         id: 1,
//         name: "Labrador",
//     },
// }
```

### 4. Find one records

#### 4.1. Find one record with the ID

```js
const dog1 = await Dogs.findone(1).exec();
const dog2 = await Dogs.findone({ id: 1 }).exec();
// if you pass an object, the keys are the attributes of the
// model and the values are the values to search :
const dog3 = await Dogs.findone({ name: "Rex", birth:"2019-10-06" }).exec();
// the first argument is the string after the where clause and
// the second argument is an array of values to replace 
// the ? in the string :
const dog4 = await Dogs.findone("name=? && birth=?",["Rex", "2019-10-06"]).exec(); 

// dog1 = dog2 = dog3 = dog4 = {
//     id: 1,
//     name: "Rex",
//     birth: "2019-10-06",
//     kindId: 0,
// }
```

#### 4.2. Find one record and populate the attributes of the associated model

```js
const dog1 = await Dogs.findone(1).populate('kind').exec();

// dog1 = {
//     id: 1,
//     name: "Rex",
//     birth: "2019-10-06",
//     kindId: 1,
//     kind: {
//         id: 1,
//         name: "Labrador",
//     },
// }
```

### 5. Find many records

#### 5.1. Find many records without associations

```js
// find all records
const dogs1 = await Dogs.find().exec();
// find all records with the kindId=1
const dogs2 = await Dogs.find({ kindId: 1 }).exec();
const dogs3 = await Dogs.find("kindId=? AND (name like ? OR name like ?)", [1, "Jazz", "%e%"]).exec();

// dogs1 = dogs2 = dogs3 = [
//     {
//         id: 1,
//         name: "Rex",
//         birth: "2019-10-06",
//         kindId: 1,
//     },
//     {
//         id: 2,
//         name: "Jazz",
//         birth: "2019-10-06",
//         kindId: 1,
//     },
//    {
//         id: 3,
//         name: "Newton",
//         birth: "2019-10-06",
//         kindId: 1,
//     }
// ]
```

#### 5.2. Find many records and populate the attributes of the associated model

```js
const dogs1 = await Dogs.find().populate("kind").exec();
// populateAll() will populate all associations of the model and 
// the associations of the associations and so on...
const dogs2 = await Dogs.find().populateAll().exec();

// dogs1 = dogs2 = [
//     {
//         id: 1,
//         name: "Rex",
//         birth: "2019-10-06",
//         kindId: 1,
//         kind: {
//             id: 1,
//             name: "Labrador",
//         }
//     },
//     {
//         id: 2,
//         name: "Jazz",
//         birth: "2019-10-06",
//         kindId: 1,
//         kind: {
//             id: 1,
//             name: "Labrador",
//         }
//     },
//    {
//         id: 3,
//         name: "Newton",
//         birth: "2019-10-06",
//         kindId: 1,
//         kind: {
//             id: 1,
//             name: "Labrador",
//         }
//     }
// ]
```

### 6. Update one record

