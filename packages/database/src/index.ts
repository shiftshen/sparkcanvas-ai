import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workGraphWorkspaces = sqliteTable("wgos_workspaces", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  activeBrandId: text("active_brand_id").notNull(),
  activeModelId: text("active_model_id").notNull(),
  prompt: text("prompt").notNull(),
  activeMaterialId: text("active_material_id").notNull(),
  updatedAt: text("updated_at").notNull(),
  payloadJson: text("payload_json").notNull()
});

export const workGraphObjects = sqliteTable("wgos_objects", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  source: text("source").notNull(),
  updatedAt: text("updated_at").notNull(),
  payloadJson: text("payload_json").notNull()
});

export const workGraphEdges = sqliteTable("wgos_edges", {
  id: text("id").primaryKey(),
  fromObjectId: text("from_object_id").notNull(),
  toObjectId: text("to_object_id").notNull(),
  relation: text("relation").notNull(),
  updatedAt: text("updated_at").notNull(),
  payloadJson: text("payload_json").notNull()
});

export const workGraphHistory = sqliteTable("wgos_history", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  reason: text("reason").notNull(),
  prompt: text("prompt").notNull(),
  countsJson: text("counts_json").notNull(),
  objectIdsJson: text("object_ids_json").notNull(),
  objectsJson: text("objects_json").notNull()
});

export const workGraphExecutionLogs = sqliteTable("wgos_execution_logs", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull(),
  step: text("step").notNull(),
  status: text("status").notNull(),
  nodeId: text("node_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
  payloadJson: text("payload_json").notNull()
});

export type WorkGraphTableName =
  | "wgos_workspaces"
  | "wgos_objects"
  | "wgos_edges"
  | "wgos_history"
  | "wgos_execution_logs";

export type WorkGraphSqliteTableDefinition = {
  name: WorkGraphTableName;
  createSql: string;
};

export const workGraphSqliteTableDefinitions: WorkGraphSqliteTableDefinition[] = [
  {
    name: "wgos_workspaces",
    createSql: "CREATE TABLE IF NOT EXISTS wgos_workspaces (id TEXT PRIMARY KEY, version INTEGER NOT NULL, active_brand_id TEXT NOT NULL, active_model_id TEXT NOT NULL, prompt TEXT NOT NULL, active_material_id TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL);"
  },
  {
    name: "wgos_objects",
    createSql: "CREATE TABLE IF NOT EXISTS wgos_objects (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL);"
  },
  {
    name: "wgos_edges",
    createSql: "CREATE TABLE IF NOT EXISTS wgos_edges (id TEXT PRIMARY KEY, from_object_id TEXT NOT NULL, to_object_id TEXT NOT NULL, relation TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL);"
  },
  {
    name: "wgos_history",
    createSql: "CREATE TABLE IF NOT EXISTS wgos_history (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, reason TEXT NOT NULL, prompt TEXT NOT NULL, counts_json TEXT NOT NULL, object_ids_json TEXT NOT NULL, objects_json TEXT NOT NULL);"
  },
  {
    name: "wgos_execution_logs",
    createSql: "CREATE TABLE IF NOT EXISTS wgos_execution_logs (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL, node_id TEXT NOT NULL, workflow_id TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);"
  }
];

export const workGraphSqliteTableNames = workGraphSqliteTableDefinitions.map((table) => table.name);

export function workGraphCreateSql(name: WorkGraphTableName) {
  const table = workGraphSqliteTableDefinitions.find((item) => item.name === name);
  if (!table) throw new Error(`Unknown WorkGraph SQLite table: ${name}`);
  return table.createSql;
}
