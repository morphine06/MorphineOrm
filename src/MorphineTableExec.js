const dayjs = require("dayjs");
const clc = require("cli-color");
const validator = require("validator");

/*eslint indent: "off"*/
class MorphineTableExec {
	constructor(table) {
		this.table = table;
		this.MorphineDb = table.MorphineDb;
		this.connection = table.connection;
		this.def = table.def;
		this.modelname = this.def.modelname;
		this.selected = [];
		this.command = "SELECT";
		this.returnCompleteRow = true;
		this.primary = "id";
		// this.primaryType = "integer";
		// this.primaryLength = 11;
		this.where = "";
		this.whereData = [];
		this.onlyOne = false;
		this.order = "";
		this.having = "";
		this.groupby = "";
		this.tabAlreadyIncluded = {};
		this.logQuery = false;
		// this.catchErr = false;
		this.iscount = false;
		this.originalPopulate = [];
		// this.swallowerror = false;
		this.joinModels = [{ modelname: this.modelname, fieldJoin: null, modelnameto: null, modelalias: this.modelname }];
		for (const [fieldName, field] of Object.entries(this.def.attributes)) {
			if (field.primary) {
				this.primary = fieldName;
				// this.primaryType = field.type;
				// this.primaryLength = field.length;
			}
		}
	}
	select(fields) {
		if (typeof fields == "string") fields = fields.split(",").map((f) => f.trim());
		this.selected = fields;
		return this;
	}
	find(where, whereData) {
		this.command = "SELECT";
		this.onlyOne = false;
		this.where = where;
		if (whereData === undefined) this.whereData = [];
		else this.whereData = whereData;
		return this;
	}
	count(where, whereData) {
		this.iscount = true;
		return this.find(where, whereData);
	}
	findone(where, whereData) {
		this.onlyOne = true;
		this.where = where;
		this.whereData = whereData === undefined ? [] : whereData;
		return this;
	}
	create(data) {
		this.onlyOne = false;
		this.command = "INSERT";
		this.data = data;
		return this;
	}
	cloneDeep(what) {
		return JSON.parse(JSON.stringify(what));
	}
	update(where, whereData, data) {
		if (data === undefined) {
			data = whereData;
			this.whereData = [];
		} else {
			this.whereData = whereData;
		}
		this.originalWhere = this.cloneDeep(where);
		this.originalWhereData = this.cloneDeep(this.whereData);
		this.whereData = [];

		this.onlyOne = false;
		this.command = "UPDATE";
		this.where = where;
		this.data = data;
		return this;
	}
	replace(data) {
		this.whereData = [];

		this.onlyOne = false;
		this.command = "REPLACE";
		this.where = "";
		this.data = data;
		return this;
	}
	updateone(where, whereData, data) {
		this.update(where, whereData, data);
		this.onlyOne = true;
		return this;
	}
	query(query, data) {
		this.command = "QUERY";
		this.whereData = data;
		this.querySaved = query;
		return this;
	}
	destroy(where, whereData) {
		if (whereData === undefined) this.whereData = [];
		else this.whereData = whereData;
		this.onlyOne = false;
		this.command = "DELETE";
		this.where = where;
		return this;
	}
	truncate() {
		this.command = "TRUNCATE";
		return this;
	}
	drop() {
		this.command = "DROP";
		return this;
	}


	_searchModelFromFieldName(fieldJoin, fromModelName) {
		let foundField = null,
			isNotAlias = false;
		for (const [fieldName, fieldInfos] of Object.entries(this.MorphineDb.models[fromModelName].def.attributes)) {
			if (fieldInfos.model && (fieldInfos.alias == fieldJoin || fieldName == fieldJoin)) {
				foundField = { ...fieldInfos, field: fieldName };
				isNotAlias = (fieldName === fieldJoin);
			}
		}
		return { modeltolink: foundField, isNotAlias };
	}
	log() {
		this.logQuery = true;
		return this;
	}
	debug() {
		this.logQuery = true;
		return this;
	}
	// swallowError() {
	// 	this.catchErr = false;
	// 	return this;
	// }
	// catchError() {
	// 	this.catchErr = true;
	// 	return this;
	// }
	returnRow(returnCompleteRow) {
		this.returnCompleteRow = returnCompleteRow;
		return this;
	}
	populateAll(exclude = [], maxlevel = 3) {
		this.thenPopulateAll = { exclude, maxlevel };

		const populateRec = (table, origins = "", level = 1) => {
			for (const [, fieldInfos] of Object.entries(table.def.attributes)) {
				if (!fieldInfos.model) continue;
				if (exclude.includes(origins + fieldInfos.alias)) continue;
				this.populate(origins + fieldInfos.alias);
				if (level < maxlevel) {
					populateRec(this.MorphineDb.models[fieldInfos.model], origins + fieldInfos.alias + ".", level + 1);
				}
			}
		};

		populateRec(this.table);
		return this;
	}

	populate(fieldJoin) {
		this.originalPopulate.push(fieldJoin);

		const parts = fieldJoin.split(".");
		let prevModelName = this.modelname;
		let prevModelAlias = this.modelname;
		let tabOrigin = [];

		for (const joinPart of parts) {
			let { modeltolink, isNotAlias } = this._searchModelFromFieldName(joinPart, prevModelName);
			if (!modeltolink || !modeltolink.alias) break;
			let join = isNotAlias ? modeltolink.alias : joinPart;

			tabOrigin.push(join);
			const key = modeltolink.model + "__" + tabOrigin.join("_");
			let modelalias = this.tabAlreadyIncluded[key] || tabOrigin.join("__");

			if (!this.tabAlreadyIncluded[key]) {
				this.joinModels.push({
					modelname: modeltolink.model,
					modelalias: modeltolink.alias,
					modelid: this.MorphineDb.models[modeltolink.model].primary,
					fieldJoin: modeltolink.field,
					modelnameto: prevModelName,
					modelaliasto: prevModelAlias,
					modelidto: modeltolink.field,
					origin: tabOrigin.join("."),
					fieldJoinName: modeltolink.alias || null,
				});
				this.tabAlreadyIncluded[key] = modelalias;
			}

			prevModelName = modeltolink.model;
			prevModelAlias = modelalias;
		}

		return this;
	}

	onetomany(modelJoin, fieldJoin, alias) {
		// let tabFieldsJoins = fieldJoin.split(".");
		let { modeltolink } = this._searchModelFromFieldName(fieldJoin, modelJoin);
		this.joinModels.push({
			isOneToMany: true,
			modelname: modelJoin,
			modelalias: alias,
			modelid: modeltolink.field,
			fieldJoin: modeltolink.field,
			modelnameto: this.modelname,
			modelaliasto: this.modelname,
			modelidto: this.MorphineDb.models[this.modelname].primary,
			origin: modelJoin + "__" + fieldJoin,
			fieldJoinName: alias,
		});

		return this;
	}
	orderBy(order) {
		this.order = order;
		return this;
	}
	groupBy(groupby) {
		this.groupby = groupby;
		return this;
	}
	having(having) {
		this.having = having;
		return this;
	}

	_createWhere(fromUpdate) {
		let where = "";
		if (!this.where) {
			where = "1=1";
		} else if (Number.isInteger(this.where)) {
			where = `${this.modelname}.${this.primary}=?`;
			this.whereData.push(this.where);
		} else if (typeof this.where === "string") {
			where = this.where;
			this.joinModels.forEach(model => {
				if (model.origin) {
					const reg = new RegExp(model.origin, "gi");
					where = where.replace(reg, model.modelalias);
				}
			});
			if (fromUpdate) {
				this.whereData.push(...this.originalWhereData);
			}
		} else {
			where = "1=1";
			Object.entries(this.where).forEach(([key, val]) => {
				if (!key.includes(".")) key = `${this.modelname}.${key}`;
				where += ` AND ${key}=?`;
				this.whereData.push(val);
			});
		}
		return where;
	}

	_createSelect() {
		let tabSelect = [];
		this.joinModels.forEach(model => {
			for (const [fieldName] of Object.entries(this.MorphineDb.models[model.modelname].def.attributes)) {
				const as = model.modelnameto ? `AS ${model.modelalias}_${model.fieldJoin}_${fieldName}` : "";
				tabSelect.push(`${model.modelalias}.${fieldName} ${as}`);
			}
		});
		if (this.selected.length) tabSelect = this.selected;
		return tabSelect.join(", ");
	}

	_createJoin() {
		let tabJoin = [];
		this.joinModels.forEach(model => {
			if (!model.modelnameto) {
				tabJoin.push(this.MorphineDb.models[model.modelname].def.tableName + " " + model.modelalias);
			} else {
				tabJoin.push(`LEFT JOIN ${this.MorphineDb.models[model.modelname].def.tableName} ${model.modelalias} ON ${model.modelalias}.${model.modelid}=${model.modelaliasto}.${model.modelidto}`);
			}
		});
		return tabJoin.join(" ");
	}

	_createOrder() {
		return this.order ? `ORDER BY ${this.order}` : "";
	}

	_createSelectQuery() {
		let query = `SELECT ${this._createSelect()} FROM ${this._createJoin()} WHERE ${this._createWhere()} ${this._createOrder()}`;
		if (this.iscount) {
			query = `SELECT count(${this.modelname}.${this.primary}) as cmpt FROM ${this._createJoin()} WHERE ${this._createWhere()} ${this._createOrder()}`;
		}
		return query;
	}

	async _createOrUpdateJoinedData() {
		let hasObjectToCreateOrUpdate = false;
		for (const [, val] of Object.entries(this.def.attributes)) {
			if (val.model && this.data[val.alias] && typeof this.data[val.alias] === "object") {
				hasObjectToCreateOrUpdate = true;
				if (!this.originalPopulate.includes(val.alias)) this.populate(val.alias);
			}
		}
		if (!hasObjectToCreateOrUpdate) return;

		for (const [key, val] of Object.entries(this.def.attributes)) {
			if (val.model && this.data[val.alias] && typeof this.data[val.alias] === "object" && this.originalPopulate.includes(val.alias)) {
				const modelJoin = this.MorphineDb.models[val.model];
				const modelJoinData = this.data[val.alias];
				let createJoin = false, modifyJoin = false;
				if (modelJoinData[modelJoin.primary]) {
					const found = await new MorphineTableExec(modelJoin)
						.findone(`${modelJoin.modelname}.${modelJoin.primary}=?`, [modelJoinData[modelJoin.primary]], modelJoinData)
						.exec();
					if (found) modifyJoin = found; else createJoin = true;
				} else createJoin = true;

				let tabNewJoins = [];
				for (const toPopulate of this.originalPopulate) {
					if (toPopulate.includes(val.alias + ".")) {
						tabNewJoins.push(toPopulate.replace(val.alias + ".", ""));
					}
				}

				if (createJoin) {
					const mt = new MorphineTableExec(modelJoin).create(modelJoinData);
					tabNewJoins.forEach(tp => mt.populate(tp));
					const c = await mt.exec();
					this.data[key] = c[modelJoin.primary];
				}
				if (modifyJoin) {
					const mt = new MorphineTableExec(modelJoin)
						.updateone(`${modelJoin.modelname}.${modelJoin.primary}=?`, [modelJoinData[modelJoin.primary]], modelJoinData);
					tabNewJoins.forEach(tp => mt.populate(tp));
					const c = await mt.exec();
					this.data[key] = c[modelJoin.primary];
				}
			}
		}
	}

	async _createInsertQuery() {
		let fields = [], vals = [];

		for (const [key, val] of Object.entries(this.def.attributes)) {
			if (val.primary && val.autoincrement) continue;
			fields.push(key);
			vals.push("?");

			if (Object.prototype.hasOwnProperty.call(this.data, key)) {
				this.whereData.push(this.data[key]);
			} else {
				let defaultValue = val.defaultsTo ??
					(["int", "integer", "tinyint", "smallint", "mediumint", "year", "float", "double", "boolean"].includes(val.type)
						? 0
						: "");
				this.whereData.push(defaultValue);
			}
		}

		let query = `INSERT INTO ${this.def.tableName} (${fields.join(", ")}) VALUES (${vals.join(", ")})`;
		if (this.MorphineDb.config.type === "pg") {
			query += ` RETURNING ${this.primary}`;
		}
		return query;
	}

	_createUpdateQuery() {
		let vals = [];
		for (const [key, val] of Object.entries(this.data)) {
			if (this.def.attributes[key]) {
				vals.push(`${this.modelname}.${key}=?`);
				this.whereData.push(val);
			}
		}
		let query = `UPDATE ${this.def.tableName} AS ${this.modelname} SET ${vals.join(", ")} WHERE ${this._createWhere(true)}`;
		return query;
	}
	// _createReplaceQuery() {
	// 	let vals = [];
	// 	for (const [key, val] of Object.entries(this.data)) {
	// 		if (this.def.attributes[key]) {
	// 			vals.push(key + "=?");
	// 			this.whereData.push(val);
	// 		}
	// 	}
	// 	let query = "UPDATE " + this.def.tableName + " SET " + vals.join(", ") + " WHERE " + this._createWhere(true);
	// 	return query;
	// }
	_createDestroyQuery() {
		let query = `DELETE FROM ${this.def.tableName} ${this.modelname} WHERE ${this._createWhere()}`;
		return query;
	}
	_createTruncateQuery() {
		let query = "";
		if (this.MorphineDb.config.type == "sqlite3") query = `DELETE FROM ${this.def.tableName}; delete from sqlite_sequence where name='${this.def.tableName}'; VACUUM;`;
		else query = `TRUNCATE ${this.def.tableName}`;
		return query;
	}
	_createDropQuery() {
		let query = "";
		query = `DROP TABLE ${this.def.tableName}`;
		return query;
	}

	_preTreatment() {
		for (const [fieldName, field] of Object.entries(this.def.attributes)) {
			if (field.type === "date" && this.data[fieldName] === undefined) {
				this.data[fieldName] = this.MorphineDb.config.type === "pg" ? null : "0000-00-00";
				continue;
			}

			if (!fieldName || this.data[fieldName] === undefined) continue;

			if (field.type === "json" && typeof this.data[fieldName] === "object") {
				try {
					this.data[fieldName] = JSON.stringify(this.data[fieldName]);
				} catch {
					this.data[fieldName] = "";
				}
			}
			if (field.type === "json" && typeof this.data[fieldName] !== "object") {
				try {
					this.data[fieldName] = JSON.parse(this.data[fieldName]);
				} catch {}
				try {
					this.data[fieldName] = JSON.stringify(this.data[fieldName]);
				} catch {
					this.data[fieldName] = "";
				}
			}

			if (field.type === "boolean") {
				if (this.data[fieldName] === false || this.data[fieldName] === "false") this.data[fieldName] = 0;
				if (this.data[fieldName] === true || this.data[fieldName] === "true") this.data[fieldName] = 1;
			}

			if (field.type === "datetime" && this.data[fieldName]) {
				this.data[fieldName] = dayjs(this.data[fieldName]).format("YYYY-MM-DD HH:mm:ss");
			}

			if (field.type === "date" && this.data[fieldName] !== undefined) {
				let m = dayjs(this.data[fieldName]);
				if (!this.data[fieldName] || this.data[fieldName] === "0000-00-00" || !m.isValid()) {
					this.data[fieldName] = this.MorphineDb.config.type === "pg" ? null : "0000-00-00";
				} else {
					this.data[fieldName] = m.format("YYYY-MM-DD");
				}
			}

			if (field.type === "datetime" && this.data[fieldName]) {
				let m = dayjs(this.data[fieldName]);
				if (
					this.data[fieldName] === "0000-00-00" ||
					this.data[fieldName] === "0000-00-00 00:00:00" ||
					!m.isValid()
				) {
					this.data[fieldName] = "0000-00-00 00:00:00";
				} else {
					this.data[fieldName] = m.format("YYYY-MM-DD HH:mm:ss");
				}
			}
		}
	}

	_postTreatment(rows) {
		let hasOneToMany = false;
		rows.forEach((row) => {
			for (const [fieldName, field] of Object.entries(this.def.attributes)) {
				if (field.type == "json") {
					try {
						if (row[fieldName]) row[fieldName] = JSON.parse(row[fieldName]);
						else row[fieldName] = null;
					} catch (e) {
						console.warn(`json parse error - fieldName:"${fieldName}" - value:"${row[fieldName]}"`);
						row[fieldName] = null;
					}
				}
				if (field.type == "boolean") {
					if (row[fieldName] === true || row[fieldName] === "true" || row[fieldName] === 1 || row[fieldName] === "1") row[fieldName] = true;
					else row[fieldName] = false;
				}
			}
			this.joinModels.forEach((model, num) => {
				if (model.isOneToMany) {
					hasOneToMany = true;
				}
				if (model.modelnameto) {
					let obj = {};

					for (const [fieldName, field] of Object.entries(this.MorphineDb.models[model.modelname].def.attributes)) {
						// let f = MorphineDb.models[model.modelname].def.tableName+'_'+model.fieldJoin+'_'+fieldName ;
						let f = model.modelalias + "_" + model.fieldJoin + "_" + fieldName;
						if (Object.prototype.hasOwnProperty.call(row, f)) {
							if (field.type == "json") {
								try {
									if (row[f]) row[f] = JSON.parse(row[f]);
									else row[f] = null;
								} catch (e) {
									console.warn("json parse error", e, f, row[f]);
									row[f] = null;
								}
							}
							obj[fieldName] = row[f];
							delete row[f];
						}
					}
					// console.log("model.modelaliasto", model.modelaliasto);
					if (model.fieldJoinName && model.modelaliasto == "t1") {
						row[model.fieldJoinName] = obj;
					} else {
						if (!obj[this.MorphineDb.models[model.modelname].primary]) {
							obj = null;
						}
						let tabFieldsJoins = model.origin.split(".");
						let previousObj = row;
						let lastO = null;
						tabFieldsJoins.forEach((o, index) => {
							lastO = o;
							if (index >= tabFieldsJoins.length - 1) return;
							previousObj = previousObj[o];
						});
						if (previousObj) previousObj[lastO] = obj;
					}
				}
			});
		});
		if (hasOneToMany) {
			let rowsOk = [];
			this.joinModels.forEach((model, num) => {
				if (!model.isOneToMany) return;
				rows.forEach((row) => {
					let f = rowsOk.find((r) => {
						return r[this.primary] === row[this.primary];
					});
					if (!f) {
						row[model.fieldJoinName] = [row[model.origin]];
						rowsOk.push(row);
						delete row[model.origin];
					} else {
						f[model.fieldJoinName].push(row[model.origin]);
					}
				});
			});
			return rowsOk;
		}
		return rows;
	}

	async _beforeQuery() {
		let fn = null,
			fn2 = null;
		switch (this.command) {
			case "UPDATE":
				// if (this.def.useUpdatedAt && !this.data.updatedAt) this.data.updatedAt = new Date();
				if (this.def.useUpdatedAt) this.data.updatedAt = new Date();
				if (this.data.updatedAtForced) this.data.updatedAt = this.data.updatedAtForced;
				if (this.def.beforeUpdate) fn = this.def.beforeUpdate;
				break;
			case "DELETE":
				if (this.def.beforeDestroy) fn2 = this.def.beforeDestroy;
				break;
			case "INSERT":
				// if (this.def.useCreatedAt && !this.data.createdAt) this.data.createdAt = new Date();
				// if (this.def.useUpdatedAt && !this.data.updatedAt) this.data.updatedAt = new Date();
				if (this.def.useCreatedAt) this.data.createdAt = dayjs();
				if (this.def.useUpdatedAt) this.data.updatedAt = dayjs();
				if (this.data.createdAtForced) this.data.createdAt = this.data.createdAtForced;
				if (this.data.updatedAtForced) this.data.updatedAt = this.data.updatedAtForced;
				if (this.def.beforeCreate) fn = this.def.beforeCreate;
				break;
			case "TRUNCATE":
				if (this.def.beforeTruncate) fn = this.def.beforeTruncate;
				break;
			case "DROP":
				if (this.def.beforeDrop) fn = this.def.beforeDrop;
				break;
			// case 'REPLACE':
			// if (this.def.beforeCreate) fn = this.def.beforeCreate ;
			// break;
			default:
				if (this.def.beforeSelect) fn = this.def.beforeSelect;
		}
		if (fn) await fn(this.data);
		else if (fn2) await fn();
	}
	_validate() {
		let errors = [];
		for (const [fieldName, field] of Object.entries(this.def.attributes)) {
			if (field.validator &&
				field.validator.fn &&
				field.validator.args &&
				this.data[fieldName] !== undefined
			) {
				let args = [this.data[fieldName]];
				// if (typeof args == "string") args = [args];
				if (!validator[field.validator.fn].apply(null, args)) {
					errors.push({ field: fieldName, error: field.validator.fn, args: field.validator.args });
				}
			}
		}
		// console.log("🚀 ~ file: MorphineTableExec.js:648 ~ MorphineTableExec ~ _validate ~ errors:", errors);
		return errors;
	}

	async exec(returnCompleteRow = true) {
		if (this.command == "REPLACE") {
			let w = "0",
				wData = [];
			if (this.data[this.primary]) {
				w = this.primary + "=?";
				wData.push(this.data[this.primary]);
			}
			let query = "SELECT " + this.primary + " FROM " + this.def.tableName + " WHERE " + w;
			rows = await this.connection.query(query, wData);
			if (rows.length) {
				this.command = "UPDATE";
				this.where = this.primary + "=?";
				this.whereData = [];
				this.originalWhere = this.primary + "=?";
				this.originalWhereData = [rows[0][this.primary]];
			} else {
				this.command = "INSERT";
				delete this.data[this.primary];
			}
		}

		await this._beforeQuery();
		let query;

		switch (this.command) {
			case "QUERY":
				query = this.querySaved;
				break;
			case "INSERT":
				this._validate();
				this._preTreatment();
				await this._createOrUpdateJoinedData();
				query = await this._createInsertQuery();
				break;
			case "UPDATE":
				this._validate();
				this._preTreatment();
				await this._createOrUpdateJoinedData();
				query = this._createUpdateQuery();
				break;
			case "DELETE":
				query = this._createDestroyQuery();
				break;
			case "TRUNCATE":
				query = this._createTruncateQuery();
				break;
			case "DROP":
				query = this._createDropQuery();
				break;
			default:
				query = this._createSelectQuery();
		}

		if (this.def.debug || this.logQuery) console.warn(clc.yellow("query:"), query, this.whereData);
		let rows;
		// try {
		rows = await this.connection.query(query, this.whereData);
		// } catch (error) {
		// 	throw error;
		// }
		let data = await this.postTreatmentMain(rows, returnCompleteRow);
		return data;
		// }
	}
	async postTreatmentMain(rows, returnCompleteRow) {
		// console.log("🚀 ~ file: MorphineTableExec.js:718 ~ postTreatmentMain ~ rows:", rows);
		let res;
		if (!rows) {
			res = {};
			switch (this.command) {
				case "QUERY": res = []; break;
				case "UPDATE": res = null; break;
				case "DELETE": res = 0; break;
				case "INSERT": res = null; break;
				case "TRUNCATE": res = []; break;
				case "DROP": res = null; break;
				default: res = {}; break;
			}
			return res;
		}
		switch (this.command) {
			case "QUERY": res = rows; break;
			case "UPDATE":
			case "DELETE":
			case "TRUNCATE":
			case "DROP":
				res = rows.affectedRows;
				break;
			case "INSERT":
				if (this.MorphineDb.config.type == "sqlite3") {
					let lastinsert = await this.MorphineDb.query("SELECT last_insert_rowid()");
					res = lastinsert[0]["last_insert_rowid()"];
				} else if (this.MorphineDb.config.type == "pg") {
					res = rows[0][this.primary];
				} else {
					res = rows.insertId;
				}
				if (res) this.data[this.primary] = res;
				break;
			default:
				if (this.iscount) res = rows[0].cmpt;
				else {
					rows = this._postTreatment(rows);
					if (this.onlyOne) {
						if (rows.length) res = rows[0];
						else res = null;
					} else res = rows;
				}
		}
		if (this.def.debug) console.warn("res", res);
		if (returnCompleteRow && (this.command === "UPDATE" || this.command === "INSERT")) {
			let tableToExec;
			if (this.command === "UPDATE") {
				tableToExec = this.table.find(this.originalWhere, this.originalWhereData);
			} else {
				let ftemp = {};
				ftemp[this.modelname + "." + this.primary] = res || this.data[this.primary];
				tableToExec = this.table.findone(ftemp);
			}
			if (this.logQuery) tableToExec.debug();
			this.originalPopulate.forEach(fieldJoin => tableToExec.populate(fieldJoin));
			let rows2 = await tableToExec.exec();
			return this.onlyOne && this.command === "UPDATE" ? rows2[0] : rows2;
		}
		return res;
	}
}

module.exports = MorphineTableExec;
