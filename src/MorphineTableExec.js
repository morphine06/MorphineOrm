const dayjs = require("dayjs");
const clc = require("cli-color");
const validator = require("validator");

const NUMERIC_TYPES = new Set([
  "int",
  "integer",
  "tinyint",
  "smallint",
  "mediumint",
  "year",
  "float",
  "double",
  "boolean",
]);

/*eslint indent: "off"*/
/**
 * Valeur d'une colonne NOT NULL à laquelle l'appelant n'a rien fourni.
 *
 * Une colonne déclarée `model:` n'a pas de `type` — elle emprunte celui de la clé
 * primaire qu'elle référence, entière dans tous les modèles du projet. Sans ce
 * cas, une clé étrangère absente recevait la chaîne vide : MySQL la convertit en
 * 0 puisque sql_mode est vidé à la connexion, mais l'intention était fausse et
 * PostgreSQL, lui, refuserait.
 */
function defaultValueFor(field) {
  // Un booléen s'écrit 0 / 1 : PostgreSQL refuse `false` dans sa colonne SMALLINT.
  if (field.type === "boolean") {
    const v = field.defaultsTo;
    return v === true || v === "true" || v === 1 || v === "1" ? 1 : 0;
  }
  return field.defaultsTo ?? (NUMERIC_TYPES.has(field.type) || field.model ? 0 : "");
}

class MorphineTableExec {
  constructor(table) {
    this.table = table;
    this.MorphineDb = table.MorphineDb;
    this.connection = table.connection;
    this.def = table.def;
    this._meta = table._meta;
    this.modelname = this.def.modelname;
    this.selected = [];
    this.command = "SELECT";
    this.returnCompleteRow = true;
    this.primary = table.primary || "id";
    // this.primaryType = "integer";
    // this.primaryLength = 11;
    this.where = "";
    this.whereData = [];
    this.onlyOne = false;
    this.order = "";
    // _having / _groupBy : une propriété `having` masquerait la méthode having().
    this._having = "";
    this._groupBy = "";
    this.tabAlreadyIncluded = {};
    this.logQuery = false;
    // this.catchErr = false;
    this.iscount = false;
    this.originalPopulate = [];
    // this.swallowerror = false;
    this.joinModels = [
      { modelname: this.modelname, fieldJoin: null, modelnameto: null, modelalias: this.modelname },
    ];
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
    // undefined (update() sans condition) ne survit pas à JSON.stringify
    if (what === undefined) return undefined;
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
    const lookup = this.MorphineDb.models[fromModelName]._meta.modelLookup;
    const found = lookup[fieldJoin];
    if (!found) return { modeltolink: null, isNotAlias: false };
    return { modeltolink: found.fieldInfo, isNotAlias: found.isNotAlias };
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
      for (const fieldInfos of table._meta.modelFields) {
        if (exclude.includes(origins + fieldInfos.alias)) continue;
        this.populate(origins + fieldInfos.alias);
        if (level < maxlevel) {
          populateRec(
            this.MorphineDb.models[fieldInfos.model],
            origins + fieldInfos.alias + ".",
            level + 1,
          );
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
    this._groupBy = groupby;
    return this;
  }
  having(having) {
    this._having = having;
    return this;
  }

  _createWhere(fromUpdate) {
    let where = "";
    // console.log('this.where', this.where);
    // Un identifiant filtre TOUJOURS sur la clé primaire, 0 et NaN compris : ces deux
    // valeurs étant falsy, elles tombaient auparavant dans le `!this.where` ci-dessous,
    // donc findone(0) renvoyait la première ligne venue et updateone(0, data) écrivait
    // dans toute la table (WHERE 1=1).
    if (
      typeof this.where === "number" ||
      (typeof this.where === "string" && /^\d+$/.test(this.where))
    ) {
      if (Number.isNaN(this.where)) {
        where = "1=0";
        this.whereData = [];
      } else {
        where = `${this.modelname}.${this.primary}=?`;
        this.whereData.push(this.where);
      }
    } else if (!this.where) {
      where = "1=1";
    } else if (typeof this.where === "string") {
      where = this.where;
      this.joinModels.forEach((model) => {
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
    if (this.selected.length) return this.selected.join(", ");
    // PostgreSQL range en minuscules les noms non cités (breedId → breedid) :
    // on y cite les alias pour retrouver les noms des attributs dans les lignes.
    const isPg = this.MorphineDb.config.type === "pg";
    let tabSelect = [];
    for (const model of this.joinModels) {
      const names = this.MorphineDb.models[model.modelname]._meta.attributeNames;
      if (model.modelnameto) {
        const aliasPrefix = model.modelalias + "_" + model.fieldJoin + "_";
        for (let i = 0; i < names.length; i++) {
          const fieldName = names[i];
          const as = isPg ? `"${aliasPrefix}${fieldName}"` : aliasPrefix + fieldName;
          tabSelect.push(`${model.modelalias}.${fieldName} AS ${as}`);
        }
      } else {
        for (let i = 0; i < names.length; i++) {
          if (isPg) tabSelect.push(`${model.modelalias}.${names[i]} AS "${names[i]}"`);
          else tabSelect.push(`${model.modelalias}.${names[i]} `);
        }
      }
    }
    return tabSelect.join(", ");
  }

  _createJoin() {
    let tabJoin = [];
    this.joinModels.forEach((model) => {
      if (!model.modelnameto) {
        tabJoin.push(
          this.MorphineDb.models[model.modelname].def.tableName + " " + model.modelalias,
        );
      } else {
        tabJoin.push(
          `LEFT JOIN ${this.MorphineDb.models[model.modelname].def.tableName} ${model.modelalias} ON ${model.modelalias}.${model.modelid}=${model.modelaliasto}.${model.modelidto}`,
        );
      }
    });
    return tabJoin.join(" ");
  }

  _createOrder() {
    let res = "";
    if (this._groupBy) res += `GROUP BY ${this._groupBy} `;
    if (this._having) res += `HAVING ${this._having} `;
    if (this.order) res += `ORDER BY ${this.order}`;
    return res;
  }

  _createSelectQuery() {
    // _createWhere() empile les valeurs dans whereData : un seul appel par requête.
    const what = this.iscount
      ? `count(${this.modelname}.${this.primary}) as cmpt`
      : this._createSelect();
    const tail = this.iscount ? "" : this._createOrder();
    return `SELECT ${what} FROM ${this._createJoin()} WHERE ${this._createWhere()} ${tail}`;
  }

  async _createInsertQuery() {
    const meta = this._meta;
    const attrs = this.def.attributes;
    const isPg = this.MorphineDb.config.type === "pg";
    for (const fieldName of meta.insertableFields) {
      if (Object.prototype.hasOwnProperty.call(this.data, fieldName)) {
        this.whereData.push(this.data[fieldName]);
      } else {
        let v = defaultValueFor(attrs[fieldName]);
        // PostgreSQL refuse la date zéro : une date absente y vaut NULL.
        if (isPg && typeof v === "string" && v.startsWith("0000-00-00")) v = null;
        this.whereData.push(v);
      }
    }

    let query = `INSERT INTO ${this.def.tableName} (${meta.insertFieldsList}) VALUES (${meta.insertPlaceholdersList})`;
    if (this.MorphineDb.config.type === "pg") {
      query += ` RETURNING ${this.primary}`;
    }
    return query;
  }

  _createUpdateQuery() {
    let vals = [];
    for (const [key, val] of Object.entries(this.data)) {
      if (this.def.attributes[key]) {
        // Colonne non qualifiée : SQLite et PostgreSQL refusent `alias.colonne`
        // dans SET, et pour un UPDATE mono-table MySQL l'entend de la même façon.
        vals.push(`${key}=?`);
        this.whereData.push(val);
      }
    }
    const where = this._createWhere(true);
    this._refuseWhereOnEveryRow(where, "UPDATE");
    let query = `UPDATE ${this.def.tableName} AS ${this.modelname} SET ${vals.join(", ")} WHERE ${where}`;
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
    const where = this._createWhere();
    this._refuseWhereOnEveryRow(where, "DELETE");
    const { tableName } = this.def;
    // _createWhere() préfixe les colonnes par le nom du modèle (`Animals.id=?`) :
    // quand la table porte un autre nom, il faut l'aliaser, comme le fait déjà
    // l'UPDATE. MySQL (< 8.0.16) et MariaDB (< 11.6) n'acceptent l'alias qu'avec
    // la forme multi-table `DELETE alias FROM table AS alias`.
    if (tableName === this.modelname) return `DELETE FROM ${tableName} WHERE ${where}`;
    if (this.MorphineDb.config.type === "mysql2")
      return `DELETE ${this.modelname} FROM ${tableName} AS ${this.modelname} WHERE ${where}`;
    return `DELETE FROM ${tableName} AS ${this.modelname} WHERE ${where}`;
  }

  // Un WHERE absent ou réduit à "1=1" porte sur la table entière : c'est toujours un
  // appel fautif (id manquant, filtre vide), jamais une intention. Pour vider une
  // table volontairement, il y a truncate() et drop().
  _refuseWhereOnEveryRow(where, command) {
    if (where.trim() !== "1=1") return;
    throw new Error(
      `${command} sur ${this.def.tableName} sans condition : refusé (toutes les lignes seraient touchées). ` +
        `Vérifiez l'identifiant passé ; utilisez truncate() ou drop() pour un vidage volontaire.`,
    );
  }
  _createTruncateQuery() {
    let query;
    if (this.MorphineDb.config.type == "sqlite3") query = `DELETE FROM ${this.def.tableName}`;
    // RESTART IDENTITY : PostgreSQL ne remet pas la séquence SERIAL à zéro sans cela
    else if (this.MorphineDb.config.type == "pg")
      query = `TRUNCATE ${this.def.tableName} RESTART IDENTITY`;
    else query = `TRUNCATE ${this.def.tableName}`;
    return query;
  }
  _createDropQuery() {
    let query;
    query = `DROP TABLE ${this.def.tableName}`;
    return query;
  }

  _preTreatment() {
    const meta = this._meta;
    const data = this.data;

    for (const fieldName of meta.jsonFields) {
      if (data[fieldName] === undefined) continue;
      if (typeof data[fieldName] === "object") {
        try {
          data[fieldName] = JSON.stringify(data[fieldName]);
        } catch {
          data[fieldName] = "";
        }
      } else {
        try {
          data[fieldName] = JSON.parse(data[fieldName]);
        } catch {
          /* already a scalar */
        }
        try {
          data[fieldName] = JSON.stringify(data[fieldName]);
        } catch {
          data[fieldName] = "";
        }
      }
    }

    for (const fieldName of meta.booleanFields) {
      const v = data[fieldName];
      if (v === undefined) continue;
      if (v === false || v === "false") data[fieldName] = 0;
      else if (v === true || v === "true") data[fieldName] = 1;
    }

    const isPg = this.MorphineDb.config.type === "pg";
    // Les colonnes datetime sont créées NOT NULL (cf. _getNotnull), alors que
    // createEmpty() met `null` dans toutes les dates du gabarit vierge. Un client
    // qui remplit ce gabarit et nous le renvoie provoquait donc un INSERT refusé
    // par MySQL (« Column 'x' cannot be null » — une erreur, pas un simple
    // avertissement, même avec sql_mode vide). On ramène ces null sur la date
    // vide, comme le fait déjà la boucle des champs date ci-dessous.
    for (const fieldName of meta.datetimeFields) {
      const v = data[fieldName];
      if (v === undefined) continue;
      const m = dayjs(v);
      if (
        !v ||
        v === "0000-00-00" ||
        v === "0000-00-00 00:00:00" ||
        !m.isValid() ||
        m.isBefore("1900-01-01")
      ) {
        data[fieldName] = isPg ? null : "0000-00-00 00:00:00";
      } else {
        data[fieldName] = m.format("YYYY-MM-DD HH:mm:ss");
      }
    }

    for (const fieldName of meta.dateFields) {
      const v = data[fieldName];
      if (v === undefined) continue;
      const m = dayjs(v);
      if (m.isValid() && m.isBefore("1900-01-01")) {
        data[fieldName] = "0000-00-00";
      } else if (!v || v === "0000-00-00" || !m.isValid()) {
        data[fieldName] = isPg ? null : "0000-00-00";
      } else {
        data[fieldName] = m.format("YYYY-MM-DD");
      }
    }

    // Une colonne NOT NULL ne tolère pas `null` : MySQL refuse la ligne entière
    // (erreur 1048), même avec sql_mode vide. L'INSERT ne donnait sa valeur par
    // défaut qu'au champ ABSENT ; un champ présent à `null` partait tel quel et
    // faisait échouer l'écriture. Le client, lui, ne distingue pas les deux :
    // createEmpty() rend un gabarit à `null` et un formulaire renvoie `null`
    // pour ce qu'il n'a pas rempli. Un champ présent à `null` vaut donc un champ
    // absent. Sans cela, cinq personnes n'ont pas pu créer leur demande d'achat
    // (`ah_emailfournisseur`), une sixième a perdu deux demandes de dix et
    // dix-huit lignes (`ahli_montant`), et les projets refusaient `en_id` et
    // `co_id` — le même défaut, quatre colonnes, trois modules.
    // On parcourt les clés reçues, et non les colonnes du modèle : une écriture
    // porte presque toujours quelques champs, là où co_contact en compte 126 — et
    // cette table est écrite à chaque requête authentifiée (co_lastrequest).
    for (const fieldName of Object.keys(data)) {
      if (!meta.notNullFields.has(fieldName)) continue;
      const v = data[fieldName];
      if (v !== null && v !== undefined) continue;
      data[fieldName] = defaultValueFor(this.def.attributes[fieldName]);
    }
  }

  _postTreatment(rows) {
    const selfMeta = this._meta;
    const selectedSet = this.selected.length ? new Set(this.selected) : null;

    // Precompute per-join field descriptors once.
    let hasOneToMany = false;
    const joinSpecs = this.joinModels.map((model) => {
      if (model.isOneToMany) hasOneToMany = true;
      if (!model.modelnameto) return null;
      const targetMeta = this.MorphineDb.models[model.modelname]._meta;
      const primary = this.MorphineDb.models[model.modelname].primary;
      const prefix = model.modelalias + "_" + model.fieldJoin + "_";
      const originParts = model.origin ? model.origin.split(".") : [];
      const fields = targetMeta.attributesEntries.map(([fieldName, field]) => ({
        fieldName,
        colAlias: prefix + fieldName,
        isJson: field.type === "json",
      }));
      return { model, fields, primary, originParts };
    });

    const virtualsEntries = this.def.virtuals ? Object.entries(this.def.virtuals) : null;

    rows.forEach((row) => {
      for (const fieldName of selfMeta.jsonFields) {
        if (selectedSet && !selectedSet.has(fieldName)) continue;
        const v = row[fieldName];
        if (v) {
          try {
            row[fieldName] = JSON.parse(v);
          } catch {
            console.warn(`json parse error - fieldName:"${fieldName}" - value:"${v}"`);
            row[fieldName] = null;
          }
        } else {
          row[fieldName] = null;
        }
      }
      for (const fieldName of selfMeta.booleanFields) {
        if (selectedSet && !selectedSet.has(fieldName)) continue;
        const v = row[fieldName];
        row[fieldName] = v === true || v === "true" || v === 1 || v === "1";
      }

      joinSpecs.forEach((spec) => {
        if (!spec) return;
        const { model, fields, primary, originParts } = spec;
        let obj = {};
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          const colAlias = f.colAlias;
          if (!Object.prototype.hasOwnProperty.call(row, colAlias)) continue;
          let val = row[colAlias];
          if (f.isJson) {
            if (val) {
              try {
                val = JSON.parse(val);
              } catch (e) {
                console.warn("json parse error", e, colAlias, val);
                val = null;
              }
            } else {
              val = null;
            }
          }
          obj[f.fieldName] = val;
          delete row[colAlias];
        }

        if (model.fieldJoinName && model.modelaliasto == "t1") {
          row[model.fieldJoinName] = obj;
        } else {
          if (!obj[primary]) obj = null;
          let previousObj = row;
          let lastO = null;
          for (let i = 0; i < originParts.length; i++) {
            lastO = originParts[i];
            if (i >= originParts.length - 1) break;
            previousObj = previousObj[lastO];
          }
          if (previousObj) previousObj[lastO] = obj;
        }
      });

      if (virtualsEntries) {
        for (const [key, fn] of virtualsEntries) {
          if (typeof fn == "function") {
            try {
              row[key] = fn.call(row);
            } catch (e) {
              row[key] = null;
              console.warn("error in virtuals", e);
            }
          }
        }
      }
    });
    if (hasOneToMany) {
      let rowsOk = [];
      const primaryField = this.primary;
      this.joinModels.forEach((model) => {
        if (!model.isOneToMany) return;
        rows.forEach((row) => {
          const f = rowsOk.find((r) => r[primaryField] === row[primaryField]);
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
        if (this.def.useUpdatedAt && !this.data.ignoreUpdatedAt) this.data.updatedAt = dayjs();
        if (this.data.createdAtForced) this.data.createdAt = this.data.createdAtForced;
        if (this.data.updatedAtForced) this.data.updatedAt = this.data.updatedAtForced;
        if (this.def.beforeUpdate) fn = this.def.beforeUpdate;
        break;
      case "DELETE":
        if (this.def.beforeDestroy) fn2 = this.def.beforeDestroy;
        break;
      case "INSERT":
        // if (this.def.useCreatedAt && !this.data.createdAt) this.data.createdAt = new Date();
        // if (this.def.useUpdatedAt && !this.data.updatedAt) this.data.updatedAt = new Date();
        if (this.def.useCreatedAt && !this.data.ignoreUpdatedAt) this.data.createdAt = dayjs();
        if (this.def.useUpdatedAt && !this.data.ignoreUpdatedAt) this.data.updatedAt = dayjs();
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
    if (fn) await fn.call(this.data, this.data);
    else if (fn2) await fn2.call(this, this.where, this.whereData);
  }
  // Règles `validator: { fn, args }` des attributs, appliquées aux champs fournis.
  // fn est une fonction de la bibliothèque validator (isEmail, isLength…), qui
  // reçoit la valeur en chaîne et args en options.
  _validate() {
    const errors = [];
    const attrs = this.def.attributes;
    for (const fieldName of this._meta.validatableFields) {
      const value = this.data[fieldName];
      if (value === undefined || value === null) continue;
      const { fn, args } = attrs[fieldName].validator;
      if (typeof validator[fn] !== "function") {
        throw new Error(`${this.modelname}.${fieldName} : validator "${fn}" inconnu`);
      }
      if (!validator[fn](String(value), args)) {
        errors.push({ field: fieldName, error: fn, args, value });
      }
    }
    return errors;
  }

  _throwIfInvalid() {
    const errors = this._validate();
    if (!errors.length) return;
    const list = errors.map((e) => `${e.field} (${e.error})`).join(", ");
    const err = new Error(`${this.modelname} : validation refusée pour ${list}`);
    err.code = "E_VALIDATION";
    err.errors = errors;
    throw err;
  }

  async exec(returnCompleteRow = this.returnCompleteRow) {
    if (this.command == "REPLACE") {
      let w = "1=0", // PostgreSQL refuse `WHERE 0`
        wData = [];
      if (this.data[this.primary]) {
        w = this.primary + "=?";
        wData.push(this.data[this.primary]);
      }
      let query = "SELECT " + this.primary + " FROM " + this.def.tableName + " WHERE " + w;
      const rows = (await this.connection.query(query, wData)) || [];
      if (rows.length) {
        this.command = "UPDATE";
        this.onlyOne = true; // une ligne, comme dans le cas INSERT
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
        this._throwIfInvalid();
        this._preTreatment();
        query = await this._createInsertQuery();
        break;
      case "UPDATE":
        this._throwIfInvalid();
        this._preTreatment();
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
    const rows = await this.connection.query(query, this.whereData);
    if (this.command == "TRUNCATE" && this.MorphineDb.config.type == "sqlite3") {
      // remet à zéro l'autoincrement, comme le TRUNCATE de MySQL
      try {
        await this.connection.query("DELETE FROM sqlite_sequence WHERE name=?", [
          this.def.tableName,
        ]);
      } catch {
        /* pas de table sqlite_sequence : aucun AUTOINCREMENT dans la base */
      }
    }
    let data = await this.postTreatmentMain(rows, returnCompleteRow);
    return data;
    // }
  }
  async postTreatmentMain(rows, returnCompleteRow) {
    let res;
    if (!rows) {
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
        case "TRUNCATE":
          res = [];
          break;
        case "DROP":
          res = null;
          break;
        default:
          // findone() et count() rendent null, find() un tableau vide
          res = this.onlyOne || this.iscount ? null : [];
          break;
      }
      return res;
    }
    switch (this.command) {
      case "QUERY":
        res = rows;
        break;
      case "UPDATE":
      case "DELETE":
      case "TRUNCATE":
      case "DROP":
        res = rows.affectedRows;
        break;
      case "INSERT":
        if (this.MorphineDb.config.type == "sqlite3") {
          res = rows.insertId;
        } else if (this.MorphineDb.config.type == "pg") {
          res = rows[0][this.primary];
        } else {
          res = rows.insertId;
        }
        if (res) this.data[this.primary] = res;
        break;
      default:
        if (this.iscount)
          res = Number(rows[0].cmpt); // PostgreSQL rend COUNT() en bigint, donc en chaîne
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
      this.originalPopulate.forEach((fieldJoin) => tableToExec.populate(fieldJoin));
      let rows2 = await tableToExec.exec();
      return this.onlyOne && this.command === "UPDATE" ? rows2[0] : rows2;
    }
    return res;
  }
}

module.exports = MorphineTableExec;
