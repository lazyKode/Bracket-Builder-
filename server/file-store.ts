// Storage for running the server without a database: the shared in-memory
// store, saved to one JSON file shortly after every change and reloaded at
// start-up. Fine for a single organiser's laptop; use PostgreSQL
// (DATABASE_URL) for anything bigger.
//
//   DATA_FILE=path/to/file.json   where to save (default ./data/bracket-builder.json)
//   DATA_FILE=:memory:            do not save at all (tests)
import fs from "fs";
import path from "path";
import { MemStorage } from "@shared/storage";

export function createFileStorage(): MemStorage {
  const setting = process.env.DATA_FILE || path.resolve(process.cwd(), "data", "bracket-builder.json");
  if (setting === ":memory:") return new MemStorage();
  const file = path.resolve(setting);

  let timer: NodeJS.Timeout | null = null;
  let dirty = false;

  const writeNow = () => {
    if (!dirty) return;
    dirty = false;
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store.dump()));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`Could not save data to ${file}:`, err);
    }
  };
  const schedule = () => {
    dirty = true;
    if (!timer) timer = setTimeout(writeNow, 250);
  };

  const store: MemStorage = new MemStorage({
    usersChanged: schedule, tournamentsChanged: schedule, participantsChanged: schedule,
    matchesChanged: schedule, eventSaved: schedule, eventsDeleted: schedule,
    tournamentDeleted: schedule, replaced: schedule,
  });

  if (fs.existsSync(file)) {
    try {
      store.load(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (err) {
      // Never start empty on top of a file we could not read: keep it for inspection.
      const kept = `${file}.unreadable-${Date.now()}`;
      fs.copyFileSync(file, kept);
      console.error(`Could not read ${file}; it was copied to ${kept} and the server started empty.`, err);
    }
  }

  process.on("exit", writeNow);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => { writeNow(); process.exit(0); });
  }

  console.log(`No DATABASE_URL: data is kept in ${file}`);
  return store;
}
