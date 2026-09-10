import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("./migrations/0001_parties.sql", import.meta.url), "utf8");

// Execute production SQL with real transactions, not a SQL mock/parser.
export class D1Database {
  constructor(migrate = true) {
    this.sqlite = new DatabaseSync(":memory:");
    if (migrate) this.sqlite.exec(migration);
    this.batches = [];
    this.sessions = [];
  }
  withSession(constraint) {
    this.sessions.push(constraint);
    return this;
  }
  prepare(sql) {
    const sqlite = this.sqlite;
    function statement(values = []) {
      return {
        sql, values,
        bind: (...bound) => statement(bound),
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      };
    }
    return statement();
  }
  async batch(statements) {
    this.batches.push(statements.map(({ sql }) => sql));
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(({ sql, values }) => {
        const statement = this.sqlite.prepare(sql);
        if (statement.columns().length) {
          return { success: true, results: statement.all(...values), meta: { changes: 0 } };
        }
        const result = statement.run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
