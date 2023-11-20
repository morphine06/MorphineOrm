const path = require("path");
const mysql = require("mysql2/promise");

const clc = require("cli-color");

const globule = require("globule");
const DbTable = require("./DbTable.js");
// const { Config } = require("./Config.js");

const DbMysql = new (class {
	constructor() {
		this.models = {};
	}
	async init(config) {
		this.config = config;
		const pool = mysql.createPool({
			host: this.config.host || "localhost",
			user: this.config.user || "root",
			password: this.config.password || "",
			database: this.config.database || "test",
			port: this.config.port || 3306,
		});
		this.connection = {
			pool: pool,
			query: async function (sql, sqlData = [], catchError = false) {
				let connection;
				try {
					connection = await this.pool.getConnection();
				} catch (error) {
					console.warn("connection-error", error);
					return null;
				}
				try {
					let results = await connection.query(sql, sqlData);
					// console.log("sql, sqlData", sql, sqlData); //, results
					connection.release();
					return results[0];
				} catch (error) {
					connection.release();
					if (catchError) throw error;
					console.warn(clc.red("sql-error"), error, sql, sqlData);
					return null;
					// } finally {
					// 	connection.release(); // always put connection back in pool after last query
				}
			},
		};
	}

	async constraints(model) {
		let toLink = [];
		for (const [fieldName, field] of Object.entries(model.def.attributes)) {
			if (field.model) toLink.push({ key: fieldName, val: field });
		}
		// console.log("toLink", toLink);
		if (toLink.length) {
			// console.log("1");
			let q = `select * from information_schema.KEY_COLUMN_USAGE where TABLE_NAME='${model.def.tableName}' && TABLE_SCHEMA='${this.config.database}'`; //COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_COLUMN_NAME, REFERENCED_TABLE_NAME
			let actualConstraints = await this.connection.query(q);
			// console.log("2", q);
			for (let iLink = 0; iLink < toLink.length; iLink++) {
				const link = toLink[iLink];

				let tocreate = true,
					todelete = false;
				for (let iActualConstraint = 0; iActualConstraint < actualConstraints.length; iActualConstraint++) {
					const actualConstraint = actualConstraints[iActualConstraint];
					let q2 = `select * from information_schema.referential_constraints where \`CONSTRAINT_NAME\` like '${actualConstraint.CONSTRAINT_NAME}'`;
					// console.log("3", q2);
					let actualConstraintBis = (await this.connection.query(q2))[0];
					if (!this.models[link.val.model]) {
						console.warn(`Model not found : ${link.val.model}`);
						continue;
					}
					// console.log("4");
					if (
						actualConstraint.COLUMN_NAME == link.key &&
						actualConstraint.REFERENCED_TABLE_NAME == this.models[link.val.model].def.tableName
					) {
						if (actualConstraintBis.UPDATE_RULE == link.val.onUpdate && actualConstraintBis.DELETE_RULE == link.val.onDelete) {
							tocreate = false;
						} else {
							todelete = actualConstraint.CONSTRAINT_NAME;
							tocreate = true;
						}
					}
					// console.log("5");
				}
				if (todelete) {
					let q = `ALTER TABLE \`${model.def.tableName}\` DROP FOREIGN KEY \`${todelete}\``;
					console.warn(q);
					await this.connection.query(q);
				}
				if (tocreate && (link.val.onDelete || link.val.onUpdate)) {
					let q = `ALTER TABLE \`${model.def.tableName}\` ADD CONSTRAINT \`${model.def.tableName}_${this.models[link.val.model].def.tableName
						}_${link.key}_fk\` FOREIGN KEY (\`${link.key}\`) REFERENCES \`${this.models[link.val.model].def.tableName}\`(\`${this.models[link.val.model].primary
						}\`)`;
					if (link.val.onDelete) q += ` ON DELETE ${link.val.onDelete}`;
					if (link.val.onUpdate) q += ` ON UPDATE ${link.val.onUpdate}`;
					console.warn(q);
					await this.connection.query(q);
				}
			}
		}
	}

	async createTable(def) {
		let what = [];
		for (const [fieldName, field] of Object.entries(def.attributes)) {
			if (field.model) {
				let f = this._getJoinedModel(field);
				if (f) what.push(fieldName + " " + this._ormTypeToDatabaseType(f[0], f[1]) + this._getNotnull(field));
			} else {
				what.push(
					fieldName +
					" " +
					this._ormTypeToDatabaseType(field.type, field.length) +
					this._getNotnull(field) +
					this._getIndex(field) +
					this._getDefault(field, fieldName),
				);
			}
		}
		let q = "CREATE TABLE IF NOT EXISTS " + def.tableName + " (" + what.join(", ") + ")";
		console.warn("q", q);
		await this.connection.query(q);
	}
	async updateTable(def) {
		let describe = await this.connection.query("DESCRIBE " + def.tableName + "");
		for (const [fieldName, field] of Object.entries(def.attributes)) {
			let type1 = null;
			if (field.model) {
				let f = this._getJoinedModel(field);
				if (f) {
					type1 = this._ormTypeToDatabaseType(f[0], f[1]);
					field.type = f[0];
					field.length = f[1];
				}
			} else {
				type1 = this._ormTypeToDatabaseType(field.type, field.length);
			}
			let type2 = null,
				def2 = null;
			let nullChanged = false;
			for (let iRow = 0; iRow < describe.length; iRow++) {
				const row = describe[iRow];
				// console.log("row", row);
				if (row.Field == fieldName) {
					if (field.notnull === false && row.Null == "NO") nullChanged = true;
					if (field.notnull !== false && row.Null == "YES") nullChanged = true;
					type2 = row.Type;
					def2 = row.Default;
				}
			}
			// console.log("nullChanged", nullChanged, def.tableName, fieldName);
			// if (nullChanged)

			if (type2 === null) {
				if (field.model) {
					let f = this._getJoinedModel(field);
					field.type = f[0];
					field.length = f[1];
				}
				let q =
					"ALTER TABLE " +
					def.tableName +
					" ADD " +
					fieldName +
					" " +
					this._ormTypeToDatabaseType(field.type, field.length) +
					this._getNotnull(field) +
					this._getIndex(field) +
					this._getDefault(field, fieldName);
				console.warn("q", q);
				await this.connection.query(q);
			} else if (
				type1 &&
				type2 &&
				(type1.toLowerCase() != type2.toLowerCase() || (def2 != field.defaultsTo && type1.toLowerCase() != "text"))
			) {
				let q =
					"ALTER TABLE " +
					def.tableName +
					" CHANGE " +
					fieldName +
					" " +
					fieldName +
					" " +
					this._ormTypeToDatabaseType(field.type, field.length) +
					this._getNotnull(field) +
					this._getDefault(field, fieldName);
				console.warn("q", q);
				await this.connection.query(q);
			} else if (nullChanged && !field.model) {
				let q =
					"ALTER TABLE " +
					def.tableName +
					" CHANGE " +
					fieldName +
					" " +
					fieldName +
					" " +
					this._ormTypeToDatabaseType(field.type, field.length) +
					this._getNotnull(field) +
					this._getIndex(field) +
					this._getDefault(field, fieldName);
				console.warn("q", q);
				await this.connection.query(q);
			}
		}
	}

	async synchronize(def) {
		let exists = true;

		let rows1 = await this.connection.query("SELECT * FROM " + def.tableName + " LIMIT 0,1");
		if (rows1 && this.config.migrate == "recreate") await this.connection.query("DROP TABLE IF EXISTS " + def.tableName + "");
		if (rows1 === null || this.config.migrate == "recreate") exists = false;

		if (this.config.migrate == "alter" || this.config.migrate == "recreate") {
			if (!exists) await this.createTable(def);
			else await this.updateTable(def);

			let rows2 = await this.connection.query("SHOW INDEX FROM " + def.tableName + "");
			for (const [fieldName, field] of Object.entries(def.attributes)) {
				let createIndex = false;
				//let createUnique = false;
				if (field.model || field.index) {
					createIndex = true;
					for (let iRows = 0; iRows < rows2.length; iRows++) {
						const row2 = rows2[iRows];
						if (row2.Column_name == fieldName) createIndex = false;
					}
				}
				// if (field.unique) {
				// 	createUnique = true;
				// 	for (let iRows = 0; iRows < rows2.length; iRows++) {
				// 		const row2 = rows2[iRows];
				// 		if (row2.Column_name == fieldName) createIndex = false;
				// 	}
				// }

				if (createIndex) {
					let q = "ALTER TABLE " + def.tableName + " ADD INDEX (" + fieldName + ")";
					console.warn("q", q);
					await this.connection.query(q);
				}
				// if (createUnique) {
				// 	let q = "ALTER TABLE " + def.tableName + " ADD UNIQUE (" + fieldName + ")";
				// 	console.warn("q", q);
				// 	await this.connection.query(q);

				// }
			}
		}
	}
	_ormTypeToDatabaseType(ormtype, length, info) {
		if (!info) info = "type";
		let typeJS = "";
		ormtype = ormtype.toLowerCase();
		let res = "";
		if (ormtype == "int" || ormtype == "integer") {
			if (!length) length = 11;
			res = "INT(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "tinyint") {
			if (!length) length = 4;
			res = "TINYINT(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "smallint") {
			if (!length) length = 6;
			res = "SMALLINT(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "mediumint") {
			if (!length) length = 9;
			res = "MEDIUMINT(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "year") {
			if (!length) length = 4;
			res = "YEAR(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "float") {
			res = "FLOAT";
			if (length) res += "(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "double") {
			res = "DOUBLE";
			typeJS = "number";

			// } else if (ormtype=='timestamp') {
			//     res = 'TIMESTAMP' ;
		} else if (ormtype == "date") {
			res = "DATE";
			typeJS = "date";
		} else if (ormtype == "datetime") {
			res = "DATETIME";
			typeJS = "date";
		} else if (ormtype == "char") {
			if (!length) length = 1;
			res = "CHAR(" + length + ")";
			typeJS = "string";
		} else if (ormtype == "varchar" || ormtype == "string") {
			if (!length) length = 255;
			res = "VARCHAR(" + length + ")";
			typeJS = "string";
		} else if (ormtype == "tinytext") {
			res = "TINYTEXT";
			typeJS = "string";
		} else if (ormtype == "mediumtext") {
			res = "MEDIUMTEXT";
			typeJS = "string";
		} else if (ormtype == "longtext") {
			res = "LONGTEXT";
			typeJS = "string";
		} else if (ormtype == "text" || ormtype == "json") {
			res = "TEXT";
			typeJS = "string";
		} else if (ormtype == "enum") {
			res = "ENUM";
			typeJS = "string";
		} else if (ormtype == "set") {
			res = "SET";
			typeJS = "string";
		} else if (ormtype == "decimal" || ormtype == "price") {
			if (!length) length = "10,2";
			res = "DECIMAL(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "bigint") {
			if (!length) length = 20;
			res = "BIGINT(" + length + ")";
			typeJS = "number";
		} else if (ormtype == "time") {
			res = "TIME";
			typeJS = "number";
		} else if (ormtype == "tinyblob") {
			res = "TINYBLOB";
			typeJS = "string";
		} else if (ormtype == "mediumblob") {
			res = "MEDIUMBLOB";
			typeJS = "string";
		} else if (ormtype == "longblob") {
			res = "LONGBLOB";
			typeJS = "string";
		} else if (ormtype == "blob") {
			res = "BLOB";
			typeJS = "string";
		} else if (ormtype == "binary") {
			res = "BINARY";
			typeJS = "binary";
		} else if (ormtype == "varbinary") {
			res = "VARBINARY";
			typeJS = "binary";
		} else if (ormtype == "bit") {
			res = "BIT";
			typeJS = "boolean";
		} else if (ormtype == "boolean") {
			res = "TINYINT(4)";
			typeJS = "boolean";
		}

		if (info == "typejs") return typeJS;
		else return res;
	}
	_getIndex(field) {
		let res = "";
		if (field.primary) res += " PRIMARY KEY";
		if (field.autoincrement) res += " AUTO_INCREMENT";
		return res;
	}
	_getNotnull(field) {
		let res = "";
		// if (field.notnull || typeof field.notnull == "undefined") res = " NOT NULL";
		// else res = " NULL";
		if (field.notnull === false) res = " NULL";
		else res = " NOT NULL";
		return res;
	}
	_getDefault(field, fieldName = "") {
		let defaultsTo = "";
		if (typeof field.defaultsTo !== "undefined") {
			defaultsTo = ` DEFAULT "${field.defaultsTo}"`;
			if (field.type == "boolean" && (field.defaultsTo === true || field.defaultsTo === "true")) defaultsTo = " DEFAULT 1";
			if (field.type == "boolean" && (field.defaultsTo === false || field.defaultsTo === "false")) defaultsTo = " DEFAULT 0";
			if (field.type == "json") {
				try {
					if (typeof field.defaultsTo == "object") {
						defaultsTo = ` DEFAULT "${JSON.stringify(field.defaultsTo).replace(/"/g, "\\\"")}"`;
					} else {
						defaultsTo = ` DEFAULT "${JSON.stringify(JSON.parse(field.defaultsTo)).replace(/"/g, "\\\"")}"`;
					}
				} catch (error) {
					defaultsTo = "";
					console.warn(clc.red(`defaultsTo '${fieldName}' must be a valid Json object`));
				}
			}
		}
		return defaultsTo;
	}
	_getJoinedModel(field) {
		if (this.models[field.model]) {
			return [this.models[field.model].primaryType, this.models[field.model].primaryLength];
		} else {
			console.warn("Model " + field.model + " not found");
		}
		return null;
	}
	getModels() {
		return this.models;
	}
})();

function Model(models = []) {
	if (models instanceof Array) {
	} else models = [models];
	return function decorator(target) {
		if (!target.prototype._models) target.prototype._models = [];
		target.prototype._models = [...target.prototype._models, ...models];
	};
}

async function loadModels() {
	// console.log("loadModels");
	// let d = new Date();
	// let where = "/models";
	// if (Config.app.mode == "production") where = "/lib";
	// console.log("process.cwd() + where", process.cwd() + where);
	let files = globule.find(`${process.cwd()}${path.sep}models${path.sep}**${path.sep}*.model.js`);
	console.warn(clc.yellow("@Info - Models availables :"));
	// console.log("d1b = ", new Date() - d);
	// d = new Date();
	for (let iFile = 0; iFile < files.length; iFile++) {
		let file = files[iFile];
		file = file.substring(0, file.length - 3);
		let { default: mymodel } = await import(file + ".js");
		let def = mymodel();
		if (def.useUpdatedAt === undefined) def.useUpdatedAt = true;
		if (def.useCreatedAt === undefined) def.useCreatedAt = true;
		if (def.useCreatedAt) def.attributes["createdAt"] = { type: "datetime", index: true };
		if (def.useUpdatedAt) def.attributes["updatedAt"] = { type: "datetime", index: true };
		def.modelname = path.basename(file);
		def.modelname = def.modelname.substring(0, def.modelname.indexOf(".model"));
		def.debug = DbMysql.config.debug;
		if (!def.tableName) def.tableName = def.modelname;
		DbMysql.models[def.modelname] = new DbTable(def, DbMysql);
		module.exports[def.modelname] = DbMysql.models[def.modelname];
		console.warn(`- ${def.modelname}`);
	}
	if (DbMysql.config.migrate == "alter") {
		// console.log("d2b = ", new Date() - d);
		// d = new Date();

		for (const model of Object.values(DbMysql.models)) {
			await DbMysql.synchronize(model.def);
		}
		// console.log("d3b = ", new Date() - d);
		// d = new Date();

		// warning, je désactive les contraintes car trop long à calculer
		// for (const model of Object.values(DbMysql.models)) {
		// 	await DbMysql.constraints(model);
		// }

		// console.log("d4b = ", new Date() - d);
		// d = new Date();
	}
	// console.log("DbMysql.models", DbMysql.models);
}

const Migration = new (class {
	dropTable(tableName) {}
	dropField(tableName, fieldName) {}
	renameField(model, oldField, newField) {}
	exec() {}
})();

const Models = DbMysql.models;
module.exports = { DbMysql, Model, Models, Migration, loadModels };
