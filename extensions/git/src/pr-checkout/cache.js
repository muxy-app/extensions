const CACHE_VERSION = 1;

export function prListCacheKey(scope) {
    let hash = 2166136261;
    for (let index = 0; index < scope.length; index += 1) {
        hash ^= scope.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `pr-picker-list-${CACHE_VERSION}-${(hash >>> 0).toString(36)}`;
}

export class PrCache {
    list = null;
    details = new Map();
    scope = "";
    storage;
    constructor(storage = globalThis.muxy?.storage) {
        this.storage = storage;
    }
    async restore(scope) {
        this.scope = scope;
        this.list = null;
        if (!scope || !this.storage?.get)
            return false;
        try {
            const value = await this.storage.get(prListCacheKey(scope));
            if (value?.version !== CACHE_VERSION || value.scope !== scope || !Array.isArray(value.list))
                return false;
            this.list = value.list;
            return true;
        }
        catch {
            return false;
        }
    }
    setList(prs) {
        this.list = prs;
        return this.persistList();
    }
    async persistList() {
        if (!this.scope || !this.storage?.set || !this.list)
            return false;
        try {
            await this.storage.set(prListCacheKey(this.scope), {
                version: CACHE_VERSION,
                scope: this.scope,
                savedAt: Date.now(),
                list: this.list,
            });
            return true;
        }
        catch {
            return false;
        }
    }
    getDetails(number) {
        return this.details.get(number);
    }
    setDetails(number, detail) {
        this.details.set(number, detail);
    }
    deleteDetails(number) {
        this.details.delete(number);
    }
    deleteListItem(number) {
        if (!this.list)
            return;
        this.list = this.list.filter((pr) => pr.number !== number);
        return this.persistList();
    }
    updateListItem(detail) {
        if (!this.list)
            return;
        this.list = this.list.map((pr) => pr.number === detail.number ? { ...pr, ...detail, checks: pr.checks } : pr);
        return this.persistList();
    }
}
