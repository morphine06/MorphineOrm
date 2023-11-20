const dayjs = require("dayjs");

class DbTableExec {
	constructor(table) {
		this.table = table;
		this.DbMysql = table.DbMysql;
		this.connection = table.connection;
		this.def = table.def;
		this.modelname = this.def.modelname;
		this.selected = [];
		this.command = "SELECT";
		this.returnCompleteRow = true;
		this.primary = "id";
		this.primaryType = "integer";
		this.primaryLength = 11;
		this.where = "";
		this.whereData = [];
		this.onlyOne = false;
		this.order = "";
		this.having = "";
		this.groupby = "";
		this.tabAlreadyIncluded = {};
		this.logQuery = false;
		this.catchErr = false;
		this.iscount = false;
		this.tabOriginalsPopulate = [];
		// this.swallowerror = false;
		this.joinModels = [{ modelname: this.modelname, fieldJoin: null, modelnameto: null, modelalias: this.modelname }];
		for (const [fieldName, field] of Object.entries(this.def.attributes)) {
			if (field.primary) {
				this.primary = fieldName;
				this.primaryType = field.type;
				this.primaryLength = field.length;
			}
		}
	}
	select(fields) {
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
		if (whereData === undefined) this.whereData = [];
		else this.whereData = whereData;
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
		this.original_where = this.cloneDeep(where);
		this.original_whereData = this.cloneDeep(this.whereData);
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
	_searchModelFromFieldName(fieldJoin, fromModelName) {
		let f = null,
			n = "",
			isNotAlias = false;
		for (const [fieldName, field] of Object.entries(this.DbMysql.models[fromModelName].def.attributes)) {
			if (field.model && (field.alias == fieldJoin || fieldName == fieldJoin)) {
				f = field;
				n = fieldName;
				if (fieldName == fieldJoin) isNotAlias = true;
			}
		}
		return { modeltolink: f, modeltolinkname: n, isNotAlias };
	}
	log() {
		this.logQuery = true;
		return this;
	}
	debug() {
		this.logQuery = true;
		return this;
	}
	swallowError() {
		this.catchErr = false;
		return this;
	}
	catchError() {
		this.catchErr = true;
		return this;
	}
	returnRow(returnCompleteRow) {
		this.returnCompleteRow = returnCompleteRow;
		return this;
	}
	populateAll(exclude = [], maxlevel = 2) {
		// console.log("populateAll");
		let me = this;
		function populateThis(table, origins, level) {
			// console.log("table", table.def.tableName, origins);
			// eslint-disable-next-line
			for (const [field, defField] of Object.entries(table.def.attributes)) {
				if (defField.model) {
					// console.log("field", field, level);
					if (exclude.indexOf(origins + defField.alias) >= 0) continue;
					me.populate(origins + defField.alias);
					// console.log("origins + defField.alias", origins + defField.alias);
					level++;
					if (level < maxlevel) populateThis(me.DbMysql.models[defField.model], origins + defField.alias + ".", level);
				}
			}
		}
		populateThis(this.table, "", 1);
		//origins=[]
		return this;
	}
	populate(fieldJoin) {
		this.tabOriginalsPopulate.push(fieldJoin);
		let tabFieldsJoins = fieldJoin.split(".");
		let previousModelName = this.modelname;
		let previousModelAlias = this.modelname;
		let tabOrigin = [];
		for (let iJoin = 0; iJoin < tabFieldsJoins.length; iJoin++) {
			let join = tabFieldsJoins[iJoin];

			let { modeltolink, modeltolinkname, isNotAlias } = this._searchModelFromFieldName(join, previousModelName);
			if (!modeltolink) {
				console.warn(`The alias ${join} not found in table ${previousModelName}. Can't populate ${fieldJoin}.`);
				break;
			}
			if (!modeltolink.alias) {
				console.warn(`Alias name is mandatory for field ${modeltolinkname}`);
				break;
			}
			if (isNotAlias) {
				// console.warn(chalk.magenta(`It's better to indicate alias name '${modeltolink.alias}' rather field name ${join} to populate`));
				join = modeltolink.alias;
			}
			let modelalias = this.modelname;
			tabOrigin.push(join);
			if (!this.tabAlreadyIncluded[modeltolink.model + "__" + tabOrigin.join("_")]) {
				modelalias = tabOrigin.join("__"); //+ modeltolink.alias
				this.joinModels.push({
					modelname: modeltolink.model,
					modelalias: modelalias,
					fieldJoin: modeltolinkname,
					modelnameto: previousModelName,
					modelaliasto: previousModelAlias,
					origin: tabOrigin.join("."),
					fieldJoinName: modeltolink.alias || null,
				});
				this.tabAlreadyIncluded[modeltolink.model + "__" + tabOrigin.join("_")] = modelalias;
			} else {
				modelalias = this.tabAlreadyIncluded[modeltolink.model + "__" + tabOrigin.join("_")];
			}
			previousModelName = modeltolink.model;
			previousModelAlias = modelalias;
		}
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
			where += this.primary + "=?";
			this.whereData.push(this.where);
		} else if (typeof this.where === "string") {
			where = this.where;
			this.joinModels.forEach((model, num) => {
				if (model.origin) {
					let reg = new RegExp(model.origin, "gi");
					where = where.replace(reg, model.modelalias);
				}
			});
			if (fromUpdate) {
				this.whereData = this.whereData.concat(this.original_whereData);
			}
		} else {
			where += "1";
			Object.entries(this.where).forEach(([key, val], index) => {
				where += " && " + key + "=?";
				this.whereData.push(val);
			});
		}

		return where;
	}
	_createSelect() {
		let tabSelect = [];
		this.joinModels.forEach((model, num) => {
			for (const [fieldName] of Object.entries(this.DbMysql.models[model.modelname].def.attributes)) {
				let as = "";
				if (model.modelnameto) as = " AS " + model.modelalias + "_" + model.fieldJoin + "_" + fieldName;
				tabSelect.push(model.modelalias + "." + fieldName + as);
			}
		});
		if (this.selected.length) tabSelect = this.selected;
		return tabSelect.join(", ");
	}
	_createJoin() {
		let tabJoin = [];
		this.joinModels.forEach((model, num) => {
			if (!model.modelnameto) tabJoin.push(this.DbMysql.models[model.modelname].def.tableName + " " + model.modelalias);
			else
				tabJoin.push(
					"LEFT JOIN " +
					this.DbMysql.models[model.modelname].def.tableName +
					" " +
					model.modelalias +
					" ON " +
					model.modelalias +
					"." +
					this.DbMysql.models[model.modelname].primary +
					"=" +
					model.modelaliasto +
					"." +
					model.fieldJoin,
				);
		});
		return tabJoin.join(" ");
	}
	_createOrder() {
		let order = "";
		if (this.order) order = " ORDER BY " + this.order;
		return order;
	}
	_createSelectQuery() {
		let query = "SELECT " + this._createSelect() + " FROM " + this._createJoin() + " WHERE " + this._createWhere() + this._createOrder();
		if (this.iscount) {
			query =
				"SELECT count(t1." + this.primary + ") as cmpt FROM " + this._createJoin() + " WHERE " + this._createWhere() + this._createOrder();
		}
		return query;
	}

	async _createOrUpdateJoinedData() {
		// create first the models to join
		for (const [key, val] of Object.entries(this.def.attributes)) {
			if (val.model && this.data[val.alias] && typeof this.data[val.alias] == "object" && this.tabOriginalsPopulate.indexOf(val.alias) >= 0) {
				// console.log("data to insert into " + val.model, this.data[val.alias]);
				let modelJoin = this.DbMysql.models[val.model];
				let modelJoinData = this.data[val.alias];
				let createJoin = false;
				if (modelJoinData[modelJoin.primary]) {
					let f = await (new DbTableExec(modelJoin)).findone(modelJoin.primary + "=?", [modelJoinData[modelJoin.primary]], modelJoinData).exec();
					if (f) createJoin = false;
				} else createJoin = true;
				if (createJoin) {
					let c = await (new DbTableExec(modelJoin)).create(modelJoinData).exec();
					this.data[key] = c[modelJoin.primary];
				}
			}
		}
	}

	async _createInsertQuery() {
		let fields = [],
			vals = [];
		// console.log("this.data", this.data);
		for (const [key, val] of Object.entries(this.def.attributes)) {
			if (val.primary && val.autoincrement) continue;
			fields.push(key);
			vals.push("?");
			if (this.data.hasOwnProperty(key)) {
				this.whereData.push(this.data[key]);
			} else {
				if (val.defaultsTo) this.whereData.push(val.defaultsTo);
				else {
					if (
						val.type == "int" ||
						val.type == "integer" ||
						val.type == "tinyint" ||
						val.type == "smallint" ||
						val.type == "mediumint" ||
						val.type == "year" ||
						val.type == "float" ||
						val.type == "double" ||
						val.type == "boolean"
					)
						this.whereData.push(0);
					else this.whereData.push("");
				}
			}
		}
		let query = "INSERT INTO " + this.def.tableName + "(" + fields.join(", ") + ") VALUES (" + vals.join(", ") + ")";
		return query;
	}
	_createUpdateQuery() {
		let vals = [];
		for (const [key, val] of Object.entries(this.data)) {
			if (this.def.attributes[key]) {
				vals.push(key + "=?");
				this.whereData.push(val);
			}
		}
		let query = "UPDATE " + this.def.tableName + " SET " + vals.join(", ") + " WHERE " + this._createWhere(true);
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
		let query = "DELETE FROM " + this.def.tableName + " WHERE " + this._createWhere();
		return query;
	}
	_preTreatment() {
		for (const [fieldName, field] of Object.entries(this.def.attributes)) {
			if (!fieldName || this.data[fieldName] === undefined) continue;
			// if (this.data[fieldName]===null)

			if (field.type == "json" && typeof this.data[fieldName] == "object") {
				try {
					this.data[fieldName] = JSON.stringify(this.data[fieldName]);
				} catch (e) {
					console.warn("json stringify error", e);
					this.data[fieldName] = "";
				}
			}
			if (field.type == "json" && typeof this.data[fieldName] !== "object") {
				try {
					this.data[fieldName] = JSON.parse(this.data[fieldName]);
				} catch (e) {}
				try {
					this.data[fieldName] = JSON.stringify(this.data[fieldName]);
				} catch (e) {
					console.warn("json stringify error", e);
					this.data[fieldName] = "";
				}
			}
			if (field.type == "boolean") {
				if (this.data[fieldName] === false) this.data[fieldName] = 0;
				if (this.data[fieldName] === true) this.data[fieldName] = 1;
				if (this.data[fieldName] === "false") this.data[fieldName] = 0;
				if (this.data[fieldName] === "true") this.data[fieldName] = 1;
			}
			if (field.type == "datetime" && this.data[fieldName]) {
				this.data[fieldName] = dayjs(this.data[fieldName]).format("YYYY-MM-DD HH:mm:ss");
			}
			if (field.type == "date" && this.data[fieldName]) {
				let m = dayjs(this.data[fieldName]);
				if (this.data[fieldName] == "0000-00-00" || this.data[fieldName] == "" || !m.isValid()) this.data[fieldName] = "0000-00-00";
				else this.data[fieldName] = m.format("YYYY-MM-DD");
			}
			if (field.type == "datetime" && this.data[fieldName]) {
				let m = dayjs(this.data[fieldName]);
				if (
					this.data[fieldName] == "0000-00-00" ||
					this.data[fieldName] == "0000-00-00 00:00:00" ||
					this.data[fieldName] == "" ||
					!m.isValid()
				)
					this.data[fieldName] = "0000-00-00 00:00:00";
				else this.data[fieldName] = m.format("YYYY-MM-DD HH:mm:ss");
			}
		}
	}
	_postTreatment(rows) {
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
				if (model.modelnameto) {
					let obj = {};

					for (const [fieldName, field] of Object.entries(this.DbMysql.models[model.modelname].def.attributes)) {
						// let f = DbMysql.models[model.modelname].def.tableName+'_'+model.fieldJoin+'_'+fieldName ;
						let f = model.modelalias + "_" + model.fieldJoin + "_" + fieldName;
						if (row.hasOwnProperty(f)) {
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
					if (model.fieldJoinName && model.modelaliasto == "t1") {
						row[model.fieldJoinName] = obj;
					} else {
						if (!obj[this.DbMysql.models[model.modelname].primary]) {
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
			// case 'REPLACE':
			// if (this.def.beforeCreate) fn = this.def.beforeCreate ;
			// break;
			default:
				if (this.def.beforeSelect) fn = this.def.beforeSelect;
		}
		if (fn) await fn(this.data);
		else if (fn2) await fn();
		// console.log("this.data", this.data);
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
			rows = await this.connection.query(query, wData, this.catchErr);
			if (rows.length) {
				this.command = "UPDATE";
				this.where = this.primary + "=?";
				this.whereData = [];
				this.original_where = this.primary + "=?";
				this.original_whereData = [rows[0][this.primary]];
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
				this._preTreatment();
				await this._createOrUpdateJoinedData();
				query = await this._createInsertQuery();
				break;
			case "UPDATE":
				this._preTreatment();
				await this._createOrUpdateJoinedData();
				query = this._createUpdateQuery();
				break;
			case "DELETE":
				query = this._createDestroyQuery();
				break;
			default:
				query = this._createSelectQuery();
		}

		if (this.def.debug || this.logQuery) console.warn("query", query, this.whereData);
		let rows;
		try {
			rows = await this.connection.query(query, this.whereData, this.catchErr);
		} catch (error) {
			throw error;
		}
		let data = await this.postTreatmentMain(rows, returnCompleteRow);
		return data;
		// }
	}
	async postTreatmentMain(rows, returnCompleteRow) {
		let res;
		if (!rows) {
			res = {};
			switch (this.command) {
				case "QUERY":
					res = [];
					break;
				case "UPDATE":
					res = null;
					break;
				case "DELETE":
					res = 0;
					break;
				case "INSERT":
					res = null;
					break;
				default:
					res = {};
					break;
			}
			return res;
		}
		switch (this.command) {
			case "QUERY":
				res = rows;
				break;
			case "UPDATE":
				res = rows.affectedRows;
				break;
			case "DELETE":
				res = rows.affectedRows;
				break;
			case "INSERT":
				res = rows.insertId;
				if (res) this.data[this.primary] = rows.insertId;
				break;
			default:
				if (this.iscount) res = rows[0].cmpt;
				else {
					this._postTreatment(rows);
					if (this.onlyOne) {
						if (rows.length) res = rows[0];
						else res = null;
					} else res = rows;
				}
		}
		if (this.def.debug) console.warn("res", res);
		if (returnCompleteRow && (this.command == "UPDATE" || this.command == "INSERT")) {
			if (this.command == "UPDATE") {
				let rows2 = await this.table.find(this.original_where, this.original_whereData).exec();
				if (this.onlyOne) return rows2[0];
				return rows2;
			}
			if (this.command == "INSERT") {
				let ftemp = {};
				ftemp[this.modelname + "." + this.primary] = res;
				if (!res) {
					ftemp[this.modelname + "." + this.primary] = this.data[this.primary];
				}
				// console.log('this.tabOriginalsPopulate', this.tabOriginalsPopulate);
				let tableToExec = this.table.findone(ftemp);
				for (let iOp = 0; iOp < this.tabOriginalsPopulate.length; iOp++) {
					const fieldJoin = this.tabOriginalsPopulate[iOp];
					tableToExec.populate(fieldJoin);
				}
				let rows2 = await tableToExec.exec();
				return rows2;
			}
		} else return res;
	}
}

module.exports = DbTableExec;
