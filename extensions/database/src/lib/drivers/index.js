import { sqlite } from "./sqlite.js";
import { postgres } from "./postgres.js";
import { mysql, mariadb } from "./mysql.js";

const registry = { sqlite, postgres, mysql, mariadb };

export function getDriver(engine) {
    const driver = registry[engine];
    if (!driver)
        throw new Error(`Unsupported engine: ${engine}`);
    return driver;
}
