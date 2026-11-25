const path = require("path");
const clc = require("cli-color");
const fs = require("fs");
const MorphineTable = require("./MorphineTable.js");
// const { Config } = require("./Config.js");

const MorphineDb = new (class {
  constructor() {
    this.models = {};
  }
  async init(config) {
    this.config = config;
    this.config.migrate ??= "safe";
    this.config.debug ??= false;
    this.config.type ??= "mysql2";
    this.config.catchError ??= false;

    if (this.config.type == "sqlite3") {
      const sqlite3 = require("sqlite3").verbose();
      const db = new sqlite3.Database(this.config.database + ".sqlite");
      this.connection = {
        db: db,
        catchError: this.config.catchError,
        query: async function (sql, sqlData = []) {
          return new Promise((resolve, reject) => {
            this.db.all(sql, sqlData, (err, rows) => {
              // console.log("🚀 ~ file: MorphineDb.js:61 ~ rows:", sql, sqlData, rows)
              if (err) {
                if (this.catchError) reject(err);
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
      const { Client, types } = require("pg");
      const client = new Client({
        ...config,
        // Comme l'option dateStrings de mysql2 : DATE, TIMESTAMP et TIMESTAMPTZ
        // restent des chaînes au lieu de devenir des objets Date.
        ...(this.config.dateStrings && {
          types: {
            getTypeParser: (oid, format) =>
              [1082, 1114, 1184].includes(oid) ? (v) => v : types.getTypeParser(oid, format),
          },
        }),
        host: this.config.host || "localhost",
        user: this.config.user || "root",
        password: this.config.password || "",
        database: this.config.database || "test",
        port: this.config.port || 5432,
      });
      await client.connect();
      this.connection = {
        client: client,
        catchError: this.config.catchError,
        query: async function (sql, sqlData = []) {
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
            if (this.catchError) throw error;
            console.warn(clc.red("sql-error"), error, sql, sqlData);
            return null;
          }
        },
      };
    } else {
      const mysql = require("mysql2/promise");
      const con = { ...config };
      delete con.migrate;
      delete con.type;
      delete con.catchError;
      delete con.engine;
      delete con.collation;
      delete con.debug;
      delete con.quietMigration;
      const pool = mysql.createPool({
        ...con,
        host: this.config.host || "localhost",
        user: this.config.user || "root",
        password: this.config.password || "",
        database: this.config.database || "test",
        port: this.config.port || 3306,
        charset: "utf8mb4", //this.config.charset ||
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
      pool.on("connection", (conn) => {
        conn.query("SET SESSION sql_mode = ''");
        conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_general_ci");
      });

      this.connection = {
        pool,
        connection: null,
        catchError: this.config.catchError,
        query: async function (sql, sqlData = []) {
          // let connection;
          // if (!this.connection) {
          // 	console.log("---------------get new connection from pool---------------");
          // 	try {
          // 		this.connection = await this.pool.getConnection();
          // 	} catch (error) {
          // 		console.warn("connection-error", error);
          // 		return null;
          // 	}
          // }
          try {
            let results = await this.pool.query(sql, sqlData);
            return results[0];
          } catch (error) {
            if (error.code === "ER_NO_SUCH_TABLE") {
              const match = /Table '(?:[^.']+\.)?([^']+)' doesn't exist/.exec(
                error.sqlMessage || "",
              );
              const tableName = match ? match[1] : "inconnue";
              console.warn(clc.yellow(`Création de la table ${tableName}`));
            } else {
              console.warn(clc.red("sql-error"), error, sql, sqlData);
            }
            if (this.catchError) throw error;
            return null;
          }
        },
      };
    }
  }

  async query(sql, sqlData = []) {
    return await this.connection.query(sql, sqlData);
  }

  // Ferme la connexion (ou le pool) : sans cela, un script ne se termine jamais.
  async close() {
    const c = this.connection;
    if (!c) return;
    if (c.pool) await c.pool.end();
    else if (c.client) await c.client.end();
    else if (c.db) await new Promise((resolve, reject) => c.db.close((e) => (e ? reject(e) : resolve())));
    this.connection = null;
    this._referentialConstraints = null;
  }

  // information_schema.referential_constraints oblige le serveur à ouvrir la
  // définition de TOUTES les tables de l'instance : le WHERE d'origine ne
  // filtrait que sur UNIQUE_CONSTRAINT_SCHEMA, que MariaDB n'exploite pas pour
  // élaguer les bases. Sur un poste qui en héberge plusieurs dizaines (bascules
  // de mise en ligne, préprod…), une seule de ces requêtes coûte une quinzaine
  // de secondes à froid — et le démarrage en lançait une par (contrainte
  // existante × clé étrangère de modèle), soit plusieurs centaines. On lit donc
  // toutes les contraintes de la base courante en une fois.
  //
  // Le cache vaut pour la durée de la synchronisation : chaque table n'est
  // traitée qu'une fois, et la boucle de constraints() compare aux contraintes
  // relevées avant de modifier quoi que ce soit.
  async referentialConstraints() {
    if (!this._referentialConstraints) {
      const q = `select * from information_schema.referential_constraints where CONSTRAINT_SCHEMA='${this.config.database}' AND UNIQUE_CONSTRAINT_SCHEMA='${this.config.database}'`;
      const rows = (await this.connection.query(q)) || [];
      const byTableAndName = {};
      for (const row of rows) {
        byTableAndName[`${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`] = row;
      }
      this._referentialConstraints = byTableAndName;
    }
    return this._referentialConstraints;
  }

  // Clés étrangères existantes de la table, sous une forme commune aux bases :
  // [{ name, column, refTable, updateRule, deleteRule }].
  async _existingForeignKeys(tableName) {
    if (this.config.type == "pg") {
      // PostgreSQL range les noms non cités en minuscules.
      const rows =
        (await this.connection.query(
          `SELECT kcu.constraint_name, kcu.column_name, ccu.table_name AS ref_table, rc.update_rule, rc.delete_rule
          FROM information_schema.referential_constraints rc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
          JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.constraint_name AND ccu.constraint_schema = rc.constraint_schema
          WHERE kcu.table_schema = current_schema() AND kcu.table_name = ?`,
          [tableName.toLowerCase()],
        )) || [];
      return rows.map((r) => ({
        name: r.constraint_name,
        column: r.column_name,
        refTable: r.ref_table,
        updateRule: r.update_rule,
        deleteRule: r.delete_rule,
      }));
    }
    const q = `select * from information_schema.KEY_COLUMN_USAGE where TABLE_NAME='${tableName}' && TABLE_SCHEMA='${this.config.database}'`;
    const rows = (await this.connection.query(q)) || [];
    const referentialConstraints = await this.referentialConstraints();
    const res = [];
    for (const row of rows) {
      // Recherche par nom exact, là où le `LIKE` d'origine traitait les `_`
      // des noms de contraintes comme des jokers.
      const rc = referentialConstraints[`${tableName}.${row.CONSTRAINT_NAME}`];
      if (!rc) continue; // clé primaire ou index unique, pas une clé étrangère
      res.push({
        name: row.CONSTRAINT_NAME,
        column: row.COLUMN_NAME,
        refTable: row.REFERENCED_TABLE_NAME,
        updateRule: rc.UPDATE_RULE,
        deleteRule: rc.DELETE_RULE,
      });
    }
    return res;
  }

  async constraints(model) {
    // SQLite n'a ni information_schema ni ALTER TABLE … ADD CONSTRAINT.
    if (this.config.type == "sqlite3") return;
    const isPg = this.config.type == "pg";
    // Identifiants cités à la MySQL ; laissés nus en PostgreSQL, où les tables et
    // colonnes sont créées sans guillemets (donc en minuscules).
    const id = (name) => (isPg ? name : `\`${name}\``);
    const same = (a, b) => String(a).toLowerCase() == String(b).toLowerCase();

    const toLink = [];
    for (const [fieldName, field] of Object.entries(model.def.attributes)) {
      if (field.model) toLink.push({ key: fieldName, val: field });
    }
    if (!toLink.length) return;

    const tableName = model.def.tableName;
    const existing = await this._existingForeignKeys(tableName);
    for (const link of toLink) {
      const target = this.models[link.val.model];
      if (!target) {
        console.warn(`Model not found : ${link.val.model}`);
        continue;
      }
      let tocreate = true,
        todelete = false;
      for (const fk of existing) {
        if (!same(fk.column, link.key) || !same(fk.refTable, target.def.tableName)) continue;
        if (fk.updateRule == link.val.onUpdate && fk.deleteRule == link.val.onDelete) {
          tocreate = false;
        } else {
          todelete = fk.name;
          tocreate = true;
        }
      }
      if (todelete) {
        const q = `ALTER TABLE ${id(tableName)} DROP ${isPg ? "CONSTRAINT" : "FOREIGN KEY"} ${id(todelete)}`;
        this._logMigration(q);
        await this.connection.query(q);
      }
      if (tocreate && (link.val.onDelete || link.val.onUpdate)) {
        // warning remet à null les valeurs qui ne sont pas dans la table liée
        await this.connection.query(
          `UPDATE ${id(tableName)} SET ${id(link.key)} = NULL WHERE ${id(link.key)} NOT IN (SELECT ${id(target.primary)} FROM ${id(target.def.tableName)})`,
        );
        let q = `ALTER TABLE ${id(tableName)} ADD CONSTRAINT ${id(`${tableName}_${target.def.tableName}_${link.key}_fk`)} FOREIGN KEY (${id(link.key)}) REFERENCES ${id(target.def.tableName)} (${id(target.primary)})`;
        if (link.val.onDelete) q += ` ON DELETE ${link.val.onDelete}`;
        if (link.val.onUpdate) q += ` ON UPDATE ${link.val.onUpdate}`;
        this._logMigration(q);
        await this.connection.query(q);
      }
    }
  }

  async createTable(def) {
    let what = [];
    for (const [fieldName, field] of Object.entries(def.attributes)) {
      if (field.model) {
        let f = this._getJoinedModel(field);
        if (f)
          what.push(
            fieldName + " " + this._ormTypeToDatabaseType(f, "ismodel") + this._getNotnull(field),
          );
      } else {
        what.push(
          fieldName +
            " " +
            this._ormTypeToDatabaseType(field) +
            this._getNotnull(field) +
            this._getIndex(field, false) +
            this._getDefault(field, fieldName),
        );
      }
    }
    const engine = def.engine ? def.engine : this.config.engine ? this.config.engine : "InnoDB";
    const collation = def.collation
      ? def.collation
      : this.config.collation
        ? this.config.collation
        : "utf8mb4_general_ci";
    const charset = collation.split("_")[0];
    let q = `CREATE TABLE IF NOT EXISTS ${def.tableName} (${what.join(", ")})`;
    // ENGINE, CHARSET et COLLATE n'existent qu'en MySQL / MariaDB.
    if (this.config.type == "mysql2")
      q += ` ENGINE=${engine} DEFAULT CHARSET=${charset} COLLATE=${collation}`;
    this._logMigration(q);
    await this.connection.query(q, [], true);
  }
  async updateTable(def) {
    let describe;
    if (this.config.type == "sqlite3")
      describe = await this.connection.query(`PRAGMA table_info(${def.tableName})`);
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
            if (type2 == "int") type2 = "int(11)";
            if (type2 == "tinyint") type2 = "tinyint(4)";
            def2 = row.Default;
          }
        }
      }
      // console.log("nullChanged", nullChanged, def.tableName, fieldName);
      if (type1) {
        // type1 = type1.replace(/\(.*\)/, "");
        // if (type1.indexOf("(") <0) type1 = type1.substring(0, type1.indexOf("("));
        if (type1.toLowerCase() == "int") type1 = "int(11)";
      }
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
          this._getIndex(field, true) +
          this._getDefault(field, fieldName);
        this._logMigration(q);
        await this.connection.query(q);
      } else if (
        type1 &&
        type2 &&
        (type1.toLowerCase() != type2.toLowerCase() ||
          (def2 != field.defaultsTo && type1.toLowerCase() != "text"))
      ) {
        console.log(type1, type2, def2);
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
          this._getIndex(field, true) +
          this._getDefault(field, fieldName);
        if (this.config.type == "sqlite3") {
          console.warn(
            clc.yellow(
              `info: Field ${def.tableName}.${fieldName} has changed but impossible to modify field in sqlite3`,
            ),
            q,
          );
        } else {
          this._logMigration(q);
          await this.connection.query(q);
        }
      } else if (nullChanged) {
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
          this._getIndex(field, true) +
          this._getDefault(field, fieldName);
        if (this.config.type == "sqlite3") {
          console.warn(
            clc.yellow(
              `info: Field ${def.tableName}.${fieldName} has changed but impossible to modify field in sqlite3`,
            ),
            q,
          );
        } else {
          this._logMigration(q);
          await this.connection.query(q);
        }
      }
    }
  }
  async updateIndexes(def) {
    let rows2;
    if (this.config.type == "sqlite3")
      rows2 = await this.connection.query(
        `SELECT * from sqlite_master WHERE type='index' AND tbl_name='${def.tableName}'`,
      );
    else if (this.config.type == "pg")
      rows2 = await this.connection.query(
        `SELECT * FROM pg_indexes WHERE tablename='${def.tableName.toLowerCase()}'`,
      );
    else rows2 = await this.connection.query(`SHOW INDEX FROM ${def.tableName}`);
    // console.log("🚀 ~ file: MorphineDb.js:306 ~ updateIndexes ~ rows2:", `SELECT * FROM pg_indexes WHERE tablename='${def.tableName}'`, rows2);
    for (const [fieldName, field] of Object.entries(def.attributes)) {
      let createIndex = false;
      //let createUnique = false;
      if (field.model || field.index) {
        createIndex = true;
        for (let iRows = 0; iRows < rows2.length; iRows++) {
          const row2 = rows2[iRows];
          if (this.config.type == "sqlite3" && row2.name == `${def.tableName}_${fieldName}_idx`)
            createIndex = false;
          else if (
            this.config.type == "pg" &&
            row2.indexname == `${def.tableName}_${fieldName}_idx`.toLowerCase()
          )
            createIndex = false;
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
        let q;
        if (this.config.type == "sqlite3")
          q = `CREATE INDEX ${def.tableName}_${fieldName}_idx ON ${def.tableName} (${fieldName})`;
        else if (this.config.type == "pg")
          q = `CREATE INDEX IF NOT EXISTS ${def.tableName}_${fieldName}_idx ON ${def.tableName} (${fieldName})`;
        else q = `ALTER TABLE ${def.tableName} ADD INDEX (${fieldName})`;
        this._logMigration(q);
        await this.connection.query(q);
      }
      // if (createUnique) {
      // 	let q = "ALTER TABLE " + def.tableName + " ADD UNIQUE (" + fieldName + ")";
      // 	console.warn("q", q);
      // 	await this.connection.query(q);
      // }
    }
  }

  /**
   * Trace une requête de migration de schéma (CREATE TABLE, ALTER TABLE, index,
   * contraintes). Utile au démarrage d'un serveur, où ces lignes signalent une
   * évolution du schéma ; assourdissant en revanche quand un script recrée une
   * base entière, où elles noient la progression de l'import. D'où l'option
   * `quietMigration` de la configuration de connexion.
   */
  _logMigration(q) {
    if (this.config && this.config.quietMigration) return;
    console.warn(clc.yellow("info:"), q);
  }

  async synchronize(def) {
    let exists = true;
    try {
      let rows1 = await this.connection.query(`SELECT * FROM ${def.tableName} LIMIT 0,1`, [], true);
      if (rows1 && this.config.migrate == "recreate")
        await this.connection.query(`DROP TABLE IF EXISTS ${def.tableName}`);
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
    if (
      this.config.type == "pg" &&
      field.primary &&
      !field.model &&
      ormtype == "integer" &&
      info == "type"
    ) {
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
  _getIndex(field, isAlter = false) {
    let res = [];
    if (!isAlter && field.primary) {
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
    let res;
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
      // PostgreSQL lit "…" comme un nom de colonne : il lui faut des apostrophes.
      const quote = (v) =>
        this.config.type == "pg" ? `'${String(v).replace(/'/g, "''")}'` : `"${v}"`;
      defaultsTo = ` DEFAULT ${quote(field.defaultsTo)}`;
      if (field.type == "boolean" && (field.defaultsTo === true || field.defaultsTo === "true"))
        defaultsTo = " DEFAULT 1";
      if (field.type == "boolean" && (field.defaultsTo === false || field.defaultsTo === "false"))
        defaultsTo = " DEFAULT 0";
      if (field.type == "json") {
        try {
          if (typeof field.defaultsTo == "object") {
            const json = JSON.stringify(field.defaultsTo);
            defaultsTo =
              this.config.type == "pg"
                ? ` DEFAULT ${quote(json)}`
                : ` DEFAULT "${json.replace(/"/g, '\\"')}"`;
          } else {
            const json = JSON.stringify(JSON.parse(field.defaultsTo));
            defaultsTo =
              this.config.type == "pg"
                ? ` DEFAULT ${quote(json)}`
                : ` DEFAULT "${json.replace(/"/g, '\\"')}"`;
          }
        } catch (error) {
          defaultsTo = "";
          console.warn(clc.red(`defaultsTo '${fieldName}' must be a valid Json object`));
        }
      }
      if (this.config.type == "pg") {
        if (!field.defaultsTo) defaultsTo = "";
        if (field.defaultsTo == "0000-00-00" || field.defaultsTo == "0000-00-00 00:00:00")
          defaultsTo = "";
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

// Les *.model.js de `dir` et de ses sous-dossiers, en chemins absolus. Le tri fixe
// l'ordre de chargement, donc de création des tables : c'est celui que rendait globule.
// Un dossier absent ne rend rien, comme globule (loadModels() sans argument vise
// `<cwd>/models`, qui n'existe pas dans myvelvet).
function findModelFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith(".model.js"))
    .map((f) => path.join(dir, f))
    .sort();
}

async function loadModels(dir, silently = false) {
  // let d = new Date();
  // let where = "/models";
  // if (Config.app.mode == "production") where = "/lib";
  // console.log("process.cwd() + where", process.cwd() + where);
  let files = findModelFiles(dir ? path.resolve(dir) : path.join(process.cwd(), "models"));
  // console.log(dir, files)
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
  // Une clé étrangère (`model:`) n'a pas de `type` : elle prend celui de la clé
  // primaire du modèle visé, une fois tous les modèles chargés. updateTable() le
  // faisait déjà, mais seulement en `migrate: "alter"` — en "safe",
  // createEmpty() plantait sur ces colonnes.
  for (const model of Object.values(MorphineDb.models)) {
    for (const field of Object.values(model.def.attributes)) {
      if (!field.model || field.type) continue;
      const target = MorphineDb.models[field.model];
      if (!target || !target.primaryField) continue;
      field.type = target.primaryField.type;
      field.length = target.primaryField.length || 11;
    }
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
