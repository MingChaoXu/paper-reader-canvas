if (!Map.prototype.getOrInsertComputed) {
    Object.defineProperty(Map.prototype, "getOrInsertComputed", {
        configurable: true,
        writable: true,
        value(key, callback) {
            if (!this.has(key)) this.set(key, callback(key));
            return this.get(key);
        },
    });
}
