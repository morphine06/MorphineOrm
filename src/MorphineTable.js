const MorphineTableExec = require("./MorphineTableExec.js");

class MorphineTable {
  constructor(def, MorphineDb) {
    this.MorphineDb = MorphineDb;
    this.def = def;
    this.connection = MorphineDb.connection;
    this.modelname = this.def.modelname;
    this.primary = "";
    // this.primaryType = "integer";
    // this.primaryLength = 11;
    this.primaryField = null;

    const attributesEntries = Object.entries(this.def.attributes);
    const meta = {
      attributesEntries,
      attributeNames: [],
      jsonFields: [],
      booleanFields: [],
      dateFields: [],
      datetimeFields: [],
      insertableFields: [],
      notNullFields: new Set(),
      validatableFields: [],
      modelFields: [],
      modelLookup: {},
    };
    for (const [fieldName, field] of attributesEntries) {
      field.fieldName = fieldName;
      meta.attributeNames.push(fieldName);
      if (field.primary) {
        this.primary = fieldName;
        // this.primaryType = field.type;
        // if (field.length) this.primaryLength = field.length;
        this.primaryField = field;
      }
      if (field.type === "json") meta.jsonFields.push(fieldName);
      if (field.type === "boolean") meta.booleanFields.push(fieldName);
      if (field.type === "date") meta.dateFields.push(fieldName);
      if (field.type === "datetime") meta.datetimeFields.push(fieldName);
      if (!(field.primary && field.autoincrement)) meta.insertableFields.push(fieldName);
      // Colonnes que MySQL crée NOT NULL et dont `_preTreatment` ramène le `null`
      // sur la valeur par défaut. Les date et datetime ont leur propre
      // normalisation juste au-dessus, qui met volontairement `null` sur
      // PostgreSQL — les y inclure la défairait.
      if (
        !(field.primary && field.autoincrement) &&
        field.notnull !== false &&
        field.type !== "date" &&
        field.type !== "datetime"
      ) {
        meta.notNullFields.add(fieldName);
      }
      if (field.validator && field.validator.fn && field.validator.args) {
        meta.validatableFields.push(fieldName);
      }
      if (field.model) {
        const info = { ...field, field: fieldName };
        meta.modelFields.push(info);
        if (field.alias) meta.modelLookup[field.alias] = { fieldInfo: info, isNotAlias: false };
        meta.modelLookup[fieldName] = { fieldInfo: info, isNotAlias: true };
      }
    }
    meta.insertFieldsList = meta.insertableFields.join(", ");
    meta.insertPlaceholdersList = meta.insertableFields.map(() => "?").join(", ");
    this._meta = meta;
  }
  createEmpty(options = {}) {
    let opts = {
      createJoined: false,
      ...options,
    };
    let row = {};
    for (const [fieldName, field] of Object.entries(this.def.attributes)) {
      if (field.model && opts.createJoined) {
        row[field.alias] = this.MorphineDb.models[field.model].createEmpty({ createJoined: false });
      } else {
        row[fieldName] = "";
        let typejs = this.MorphineDb._ormTypeToDatabaseType(field, "typejs");
        if (typejs == "number") row[fieldName] = 0;
        if (typejs == "date") row[fieldName] = null;
        if (typejs == "boolean") row[fieldName] = false;
        if (field.defaultsTo) row[fieldName] = field.defaultsTo;
      }
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
  getPrimary() {
    return this.primary;
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
  drop() {
    let exec = new MorphineTableExec(this);
    return exec.drop();
  }
}

module.exports = MorphineTable;
