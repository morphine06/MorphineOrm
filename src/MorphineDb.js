const path = require("path");
const clc = require("cli-color");

const globule = require("globule");
const MorphineTable = require("./MorphineTable.js");
// const { Config } = require("./Config.js");

const MorphineDb = new (class {
	constructor() {
		this.models = {};
	}
	async init(config) {
		this.config = config;
		if (!this.config.migrate) this.config.migrate = "safe";
		if (!this.config.debug) this.config.debug = false;
		if (!this.config.type) this.config.type = "mysql2";

		if (this.config.type == "sqlite3") {
			const sqlite3 = require("sqlite3").verbose();
			const db = new sqlite3.Database(this.config.database + ".sqlite");
			this.connection = {
				db: db,
				query: async function (sql, sqlData = [], catchError = false) {
					return new Promise((resolve, reject) => {
						this.db.all(sql, sqlData, function (err, rows) {
							// console.log("🚀 ~ file: MorphineDb.js:61 ~ rows:", sql, sqlData, rows)
							if (err) {
								if (catchError) reject(err);
								else {
									console.warn(clc.red("sql-error"), err, sql, sqlData);
									resolve(null);
								}
							} else resolve(rows);
						});
					});
				},
			};
		} else if (this.config.type == "pg") {
			const { Client } = require("pg");
			const client = new Client({
				...config,
				host: this.config.host || "localhost",
				user: this.config.user || "root",
				password: this.config.password || "",
				database: this.config.database || "test",
				port: this.config.port || 3306,
			});
			await client.connect();
			this.connection = {
				client: client,
				query: async function (sql, sqlData = [], catchError = false) {
					//replace ? by $1, $2, $3, ...
					let i = 1;
					while (sql.indexOf("?") != -1) {
						sql = sql.replace("?", "$" + i);
						i++;
					}
					try {
						let results = await this.client.query(sql, sqlData);
						return results.rows;
					} catch (error) {
						if (catchError) throw error;
						console.warn(clc.red("sql-error"), error, sql, sqlData);
						return null;
					}
				},
			};
		} else {
			const mysql = require("mysql2/promise");
			const pool = mysql.createPool({
				...config,
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
	}

	async query(sql, sqlData = [], catchError = false) {
		return await this.connection.query(sql, sqlData, catchError);
	}

	async constraints(model) {
		let toLink = [];
		for (const [fieldName, field] of Object.entries(model.def.attributes)) {
			if (field.model) toLink.push({ key: fieldName, val: field });
		}
		// console.log("toLink", toLink);
		if (toLink.length) {
			// let d = new Date();
			// console.log("1");
			let q = `select * from information_schema.KEY_COLUMN_USAGE where TABLE_NAME='${model.def.tableName}' && TABLE_SCHEMA='${this.config.database}'`; //COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_COLUMN_NAME, REFERENCED_TABLE_NAME
			if (this.config.type == "pg") q = `select * from information_schema.constraint_column_usage where TABLE_NAME='${model.def.tableName}' AND CONSTRAINT_SCHEMA='${this.config.database}'`;
			let actualConstraints = await this.connection.query(q);
			// console.log("🚀 ~ file: MorphineDb.js:91 ~ constraints ~ actualConstraints:", actualConstraints)
			// console.log("2", q, d - new Date());
			// d = new Date();
			for (let iLink = 0; iLink < toLink.length; iLink++) {
				const link = toLink[iLink];

				let tocreate = true,
					todelete = false;
				for (let iActualConstraint = 0; iActualConstraint < actualConstraints.length; iActualConstraint++) {
					const actualConstraint = actualConstraints[iActualConstraint];
					// console.log("🚀 ~ file: MorphineDb.js:100 ~ constraints ~ actualConstraint:", actualConstraint)
					let q2 = `select * from information_schema.referential_constraints where \`CONSTRAINT_NAME\` like '${actualConstraint.CONSTRAINT_NAME}' AND TABLE_NAME='${model.def.tableName}' AND UNIQUE_CONSTRAINT_SCHEMA='${this.config.database}'`;
					// console.log("3", q2, d - new Date());
					// d = new Date();
					let actualConstraintBis = (await this.connection.query(q2))[0];
					// console.log("🚀 ~ file: MorphineDb.js:106 ~ constraints ~ actualConstraintBis:", actualConstraintBis)
					if (!this.models[link.val.model]) {
						console.warn(`Model not found : ${link.val.model}`);
						continue;
					}
					// console.log("4", d - new Date());
					// d = new Date();
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
					// console.log("5", d - new Date());
					// d = new Date();
				}
				if (todelete) {
					let q = `ALTER TABLE \`${model.def.tableName}\` DROP FOREIGN KEY \`${todelete}\``;
					console.warn(clc.yellow("info:"), q);
					await this.connection.query(q);
				}
				if (tocreate && (link.val.onDelete || link.val.onUpdate)) {
					// console.log("6");
					// warning remet à null les valeurs qui ne sont pas dans la table liée
					await this.connection.query(`UPDATE \`${model.def.tableName}\` SET \`${link.key}\` = NULL WHERE \`${link.key}\` NOT IN (SELECT \`${this.models[link.val.model].primary}\` FROM \`${this.models[link.val.model].def.tableName}\`)`);

					let q = "";
					if (this.config.type == "pg") {
						q = `ALTER TABLE ${model.def.tableName} ADD CONSTRAINT ${model.def.tableName}_${this.models[link.val.model].def.tableName}_${link.key}_fk FOREIGN KEY (${link.key}) REFERENCES ${this.models[link.val.model].def.tableName} (${this.models[link.val.model].primary})`;
						if (link.val.onDelete) q += ` ON DELETE ${link.val.onDelete}`;
						if (link.val.onUpdate) q += ` ON UPDATE ${link.val.onUpdate}`;
					} else {
						q = `ALTER TABLE \`${model.def.tableName}\` ADD CONSTRAINT \`${model.def.tableName}_${this.models[link.val.model].def.tableName}_${link.key}_fk\` FOREIGN KEY (\`${link.key}\`) REFERENCES \`${this.models[link.val.model].def.tableName}\`(\`${this.models[link.val.model].primary}\`)`;
						if (link.val.onDelete) q += ` ON DELETE ${link.val.onDelete}`;
						if (link.val.onUpdate) q += ` ON UPDATE ${link.val.onUpdate}`;
					}

					console.warn(clc.yellow("info:"), q);
					await this.connection.query(q);
					// console.log("7");
				}
			}
		}
	}

	async createTable(def) {
		let what = [];
		for (const [fieldName, field] of Object.entries(def.attributes)) {

			if (field.model) {
				let f = this._getJoinedModel(field);
				if (f) what.push(fieldName + " " + this._ormTypeToDatabaseType(f, "ismodel") + this._getNotnull(field));
			} else {
				what.push(
					fieldName +
					" " +
					this._ormTypeToDatabaseType(field) +
					this._getNotnull(field) +
					this._getIndex(field) +
					this._getDefault(field, fieldName),
				);
			}
		}
		let q = `CREATE TABLE IF NOT EXISTS ${def.tableName} (${what.join(", ")})`;
		console.warn(clc.yellow("info:"), q);
		await this.connection.query(q, [], true);
	}
	async updateTable(def) {
		let describe;
		if (this.config.type == "sqlite3") describe = await this.connection.query(`PRAGMA table_info(${def.tableName})`);
		else describe = await this.connection.query(`DESCRIBE ${def.tableName}`);

		for (const [fieldName, field] of Object.entries(def.attributes)) {
			let type1 = null;
			if (field.model) {
				let f = this._getJoinedModel(field);
				if (f) {
					type1 = this._ormTypeToDatabaseType(f);
					field.type = f.type;
					field.length = f.length ? f.length : 11;
				}
			} else {
				type1 = this._ormTypeToDatabaseType(field);
			}
			let type2 = null,
				def2 = null;
			let nullChanged = false;
			for (let iRow = 0; iRow < describe.length; iRow++) {
				const row = describe[iRow];
				// console.log("row", row);
				if (this.config.type == "sqlite3") {
					if (row.name == fieldName) {
						if (field.notnull === false && row.notnull == 1) nullChanged = true;
						if (field.notnull !== false && row.notnull == 0) nullChanged = true;
						type2 = row.type;
						def2 = row.dflt_value;
					}
				} else {
					if (row.Field == fieldName) {
						if (field.notnull === false && row.Null == "NO") nullChanged = true;
						if (field.notnull !== false && row.Null == "YES") nullChanged = true;
						type2 = row.Type;
						def2 = row.Default;
					}
				}
			}
			// console.log("nullChanged", nullChanged, def.tableName, fieldName);
			// if (nullChanged)

			if (type2 === null) {
				if (field.model) {
					let f = this._getJoinedModel(field);
					field.type = f.type;
					field.length = f.length ? f.length : 11;
				}
				let q =
					"ALTER TABLE " +
					def.tableName +
					" ADD " +
					fieldName +
					" " +
					this._ormTypeToDatabaseType(field) +
					this._getNotnull(field) +
					this._getIndex(field) +
					this._getDefault(field, fieldName);
				console.warn(clc.yellow("info:"), q);
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
					this._ormTypeToDatabaseType(field) +
					this._getNotnull(field) +
					this._getDefault(field, fieldName);
				if (this.config.type == "sqlite3") {
					console.warn(clc.yellow(`info: Field ${def.tableName}.${fieldName} has changed but impossible to modify field in sqlite3`), q);
				} else {
					console.warn(clc.yellow("info:"), q);
					await this.connection.query(q);
				}
			} else if (nullChanged && !field.model) {
				let q =
					"ALTER TABLE " +
					def.tableName +
					" CHANGE " +
					fieldName +
					" " +
					fieldName +
					" " +
					this._ormTypeToDatabaseType(field) +
					this._getNotnull(field) +
					this._getIndex(field) +
					this._getDefault(field, fieldName);
				if (this.config.type == "sqlite3") {
					console.warn(clc.yellow(`info: Field ${def.tableName}.${fieldName} has changed but impossible to modify field in sqlite3`), q);
				} else {
					console.warn(clc.yellow("info:"), q);
					await this.connection.query(q);
				}
			}
		}

	}
	async updateIndexes(def) {
		let rows2;
		if (this.config.type == "sqlite3") rows2 = await this.connection.query(`SELECT * from sqlite_master WHERE type='index' AND tbl_name='${def.tableName}'`);
		else if (this.config.type == "pg") rows2 = await this.connection.query(`SELECT * FROM pg_indexes WHERE tablename='${def.tableName.toLowerCase()}'`);
		else rows2 = await this.connection.query(`SHOW INDEX FROM ${def.tableName}`);
		// console.log("🚀 ~ file: MorphineDb.js:306 ~ updateIndexes ~ rows2:", `SELECT * FROM pg_indexes WHERE tablename='${def.tableName}'`, rows2);
		for (const [fieldName, field] of Object.entries(def.attributes)) {
			let createIndex = false;
			//let createUnique = false;
			if (field.model || field.index) {
				createIndex = true;
				for (let iRows = 0; iRows < rows2.length; iRows++) {
					const row2 = rows2[iRows];
					if (this.config.type == "sqlite3" && row2.name == `${def.tableName}_${fieldName}_idx`) createIndex = false;
					else if (this.config.type == "pg" && row2.indexname == `${def.tableName}_${fieldName}_idx`.toLowerCase()) createIndex = false;
					else if (row2.Column_name == fieldName) createIndex = false;
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
				let q = "";
				if (this.config.type == "sqlite3") q = `CREATE INDEX ${def.tableName}_${fieldName}_idx ON ${def.tableName} (${fieldName})`;
				else if (this.config.type == "pg") q = `CREATE INDEX IF NOT EXISTS ${def.tableName}_${fieldName}_idx ON ${def.tableName} (${fieldName})`;
				else q = `ALTER TABLE ${def.tableName} ADD INDEX (${fieldName})`;
				console.warn(clc.yellow("info:"), q);
				await this.connection.query(q);
			}
			// if (createUnique) {
			// 	let q = "ALTER TABLE " + def.tableName + " ADD UNIQUE (" + fieldName + ")";
			// 	console.warn("q", q);
			// 	await this.connection.query(q);
			// }
		}
	}

	async synchronize(def) {
		let exists = true;
		try {
			let rows1 = await this.connection.query(`SELECT * FROM ${def.tableName} LIMIT 0,1`, [], true);
			if (rows1 && this.config.migrate == "recreate") await this.connection.query(`DROP TABLE IF EXISTS ${def.tableName}`);
			if (rows1 === null || this.config.migrate == "recreate") exists = false;
		} catch (error) {
			exists = false;
		}

		if (this.config.migrate == "alter" || this.config.migrate == "recreate") {
			if (!exists) await this.createTable(def);
			else await this.updateTable(def);
			await this.updateIndexes(def);
		}
	}
	_ormTypeToDatabaseType(field, info = "type") {
		// console.log("🚀 ~ file: MorphineDb.js:369 ~ _ormTypeToDatabaseType ~ field:", field);
		let typeJS = "";
		let ormtype = field.type.toLowerCase();
		let ormlength = field.length;
		if (this.config.type == "pg" && field.primary && !field.model && ormtype == "integer" && info == "type") {
			return "";
		}
		let res = "";
		if (ormtype == "int" || ormtype == "integer") {
			if (!ormlength) ormlength = 11;
			if (this.config.type == "sqlite3") res = "INTEGER";
			else if (this.config.type == "pg") res = "INTEGER";
			else res = "INT(" + ormlength + ")";
			typeJS = "number";
		} else if (ormtype == "tinyint") {
			if (!ormlength) ormlength = 4;
			res = "TINYINT(" + ormlength + ")";
			typeJS = "number";
		} else if (ormtype == "smallint") {
			if (!ormlength) ormlength = 6;
			res = "SMALLINT(" + ormlength + ")";
			typeJS = "number";
		} else if (ormtype == "mediumint") {
			if (!ormlength) ormlength = 9;
			res = "MEDIUMINT(" + ormlength + ")";
			typeJS = "number";
		} else if (ormtype == "year") {
			if (!ormlength) ormlength = 4;
			res = "YEAR(" + ormlength + ")";
			typeJS = "number";
		} else if (ormtype == "float") {
			res = "FLOAT";
			if (ormlength) res += "(" + ormlength + ")";
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
			if (this.config.type == "pg") res = "TIMESTAMP";
		} else if (ormtype == "char") {
			if (!ormlength) ormlength = 1;
			res = "CHAR(" + ormlength + ")";
			typeJS = "string";
		} else if (ormtype == "varchar" || ormtype == "string") {
			if (!ormlength) ormlength = 255;
			res = "VARCHAR(" + ormlength + ")";
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
			if (!ormlength) ormlength = "10,2";
			res = "DECIMAL(" + ormlength + ")";
			typeJS = "number";
		} else if (ormtype == "bigint") {
			if (!ormlength) ormlength = 20;
			res = "BIGINT(" + ormlength + ")";
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
		return res;
	}
	_getIndex(field) {
		let res = [];
		if (field.primary) {
			if (this.config.type == "pg") res.push("SERIAL UNIQUE");
			else res.push("PRIMARY KEY");
		}
		if (field.autoincrement) {
			if (this.config.type == "sqlite3") res.push("AUTOINCREMENT");
			else if (this.config.type == "pg") res.push("");
			else res.push("AUTO_INCREMENT");
		}
		return " " + res.join(" ");
	}
	_getNotnull(field) {
		if (this.config.type == "pg" && field.primary && field.type == "integer") return "";
		let res = "";
		// if (field.notnull || typeof field.notnull == "undefined") res = " NOT NULL";
		// else res = " NULL";
		if (field.notnull === false) res = " NULL";
		else res = " NOT NULL";
		// if (this.config.type == "sqlite3") res = "";
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
			if (this.config.type == "pg") {
				if (!field.defaultsTo) defaultsTo = "";
				if (field.defaultsTo == "0000-00-00" || field.defaultsTo == "0000-00-00 00:00:00") defaultsTo = "";
			}
		}
		return defaultsTo;
	}
	_getJoinedModel(field) {
		if (this.models[field.model]) {
			// return [this.models[field.model].primaryType, this.models[field.model].primaryLength];
			return this.models[field.model].primaryField;
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
	if (!(models instanceof Array)) models = [models];
	return function decorator(target) {
		if (!target.prototype._models) target.prototype._models = [];
		target.prototype._models = [...target.prototype._models, ...models];
	};
}

async function loadModels(dir) {
	// console.log("loadModels");
	// let d = new Date();
	// let where = "/models";
	// if (Config.app.mode == "production") where = "/lib";
	// console.log("process.cwd() + where", process.cwd() + where);
	if (!dir) dir = `${process.cwd()}${path.sep}models${path.sep}**${path.sep}*.model.js`;
	else dir = `${dir}${path.sep}**${path.sep}*.model.js`;
	let files = globule.find(dir);
	console.warn(clc.yellow("@Info - Models availables :"));
	// console.log("d1b = ", new Date() - d);
	// d = new Date();
	for (let iFile = 0; iFile < files.length; iFile++) {
		let file = files[iFile];
		file = file.substring(0, file.length - 3);
		let { default: mymodel } = await import(`file://${file}.js`);
		let def = mymodel();
		if (def.useUpdatedAt === undefined) def.useUpdatedAt = true;
		if (def.useCreatedAt === undefined) def.useCreatedAt = true;
		if (def.useCreatedAt) def.attributes["createdAt"] = { type: "datetime", index: true };
		if (def.useUpdatedAt) def.attributes["updatedAt"] = { type: "datetime", index: true };
		def.modelname = path.basename(file);
		def.modelname = def.modelname.substring(0, def.modelname.indexOf(".model"));
		def.debug = MorphineDb.config.debug;
		if (!def.tableName) def.tableName = def.modelname;
		MorphineDb.models[def.modelname] = new MorphineTable(def, MorphineDb);
		module.exports[def.modelname] = MorphineDb.models[def.modelname];
		console.warn(`- ${def.modelname}`);
	}
	if (MorphineDb.config.migrate == "alter") {
		// console.log("d2b = ", new Date() - d);
		// d = new Date();

		for (const model of Object.values(MorphineDb.models)) {
			await MorphineDb.synchronize(model.def);
		}
		// console.log("d3b = ", new Date() - d);
		// d = new Date();

		// warning, je désactive les contraintes car trop long à calculer
		for (const model of Object.values(MorphineDb.models)) {
			await MorphineDb.constraints(model);
		}

		// console.log("d4b = ", new Date() - d);
		// d = new Date();
	}
	// console.log("MorphineDb.models", MorphineDb.models);
}

const Migration = new (class {
	dropTable(tableName) {}
	dropField(tableName, fieldName) {}
	renameField(model, oldField, newField) {}
	exec() {}
})();

const Models = MorphineDb.models;
module.exports = { MorphineDb, Model, Models, Migration, loadModels };
