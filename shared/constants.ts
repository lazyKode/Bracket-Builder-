// Plain constants with no database imports, so the browser bundle can use
// them without pulling in the ORM. Re-exported from schema.ts for the server.
export const MAX_TABLES = 12;
export const SCOPE_DEFAULT = "__default";
export const SCOPE_COC = "__coc";
