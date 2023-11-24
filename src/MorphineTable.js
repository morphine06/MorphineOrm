const MorphineTableExec = require("./MorphineTableExec.js");

class MorphineTable {
	constructor(def, MorphineDb) {
		this.MorphineDb = MorphineDb;
		this.def = def;
		this.connection = MorphineDb.connection;
		this.modelname = this.def.modelname;
		this.primary = "";
		this.primaryType = "integer";
		this.primaryLength = 11;
		for (const [fieldName, field] of Object.entries(this.def.attributes)) {
			if (field.primary) {
				this.primary = fieldName;
				this.primaryType = field.type;
				if (field.length) this.primaryLength = field.length;
			}
		}
	}
	createEmpty() {
		let row = {};
		for (const [fieldName, field] of Object.entries(this.def.attributes)) {
			if (field.model) continue;
			row[fieldName] = "";
			let typejs = this.MorphineDb._ormTypeToDatabaseType(field.type, "", "typejs");
			if (typejs == "number") row[fieldName] = 0;
			if (typejs == "date") row[fieldName] = null;
			if (typejs == "boolean") row[fieldName] = false;
			if (field.defaultsTo) row[fieldName] = field.defaultsTo;
		}
		return row;
	}
	use(connectionId) {
		let exec = new MorphineTableExec(this);
		return exec;
	}
	select(fields) {
		let exec = new MorphineTableExec(this);
		return exec.select(fields);
	}
	find(where, whereData) {
		let exec = new MorphineTableExec(this);
		return exec.find(where, whereData);
	}
	count(where, whereData) {
		let exec = new MorphineTableExec(this);
		return exec.count(where, whereData);
	}
	findone(where, whereData) {
		let exec = new MorphineTableExec(this);
		return exec.findone(where, whereData);
	}
	create(data) {
		let exec = new MorphineTableExec(this);
		return exec.create(data);
	}
	update(where, whereData, data) {
		let exec = new MorphineTableExec(this);
		return exec.update(where, whereData, data);
	}
	updateone(where, whereData, data) {
		let exec = new MorphineTableExec(this);
		return exec.updateone(where, whereData, data);
	}
	cloneDeep(what) {
		return JSON.parse(JSON.stringify(what));
	}
	replace(data) {
		let exec = new MorphineTableExec(this);
		return exec.replace(data);
	}
	// async replace(where, whereData, data, returnCompleteRow) {
	// 	let where2 = this.cloneDeep(where);
	// 	let whereData2 = this.cloneDeep(whereData);
	// 	let _rowold = await this.findone(where, whereData).exec();
	// 	if (!_rowold) {
	// 		let idTemp = await this.create(data).exec();
	// 		if (returnCompleteRow) {
	// 			let _row = await this.findone(idTemp).exec();
	// 			return { row: _row, rowold: null };
	// 		} else return { id: idTemp, rowold: null };
	// 	} else {
	// 		let rows = await this.update(where2, whereData2, data).exec(returnCompleteRow);
	// 		if (returnCompleteRow && rows.length) return { row: rows[0], rowold: _rowold };
	// 		return { id: _rowold[this.primary], rowold: _rowold };
	// 	}
	// }
	destroy(where, whereData) {
		let exec = new MorphineTableExec(this);
		return exec.destroy(where, whereData);
	}
	query(query, data) {
		let exec = new MorphineTableExec(this);
		return exec.query(query, data);
	}
	getAttributes() {
		return this.def.attributes;
	}
	getAttributesEntries() {
		return Object.entries(this.def.attributes);
	}
	truncate() {
		let exec = new MorphineTableExec(this);
		return exec.truncate();
	}
}

module.exports = MorphineTable;
