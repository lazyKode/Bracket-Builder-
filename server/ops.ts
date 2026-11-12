// The server's instance of the shared tournament operations:
// database (or file) storage + live update streams.
import { createOps } from "@shared/ops";
import { storage } from "./storage";
import { notify } from "./live";

export { OpError, LEGACY_BRACKET_MESSAGE } from "@shared/ops";
export const ops = createOps({ storage, notify });
