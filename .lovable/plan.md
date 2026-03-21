

## Fix: Remove `makeInMemoryStore` import

**Problem**: Baileys v6.7.16 no longer exports `makeInMemoryStore`. This crashes the backend on startup.

**Solution**: Remove the import and all usage of `makeInMemoryStore`. The in-memory store is not essential — your app already uses SQLite for persistence.

### Changes to `backend/src/whatsapp.js`

1. **Remove `makeInMemoryStore` from the import** on line 6.

2. **Remove store creation** around line 269-271 (`inst.store = makeInMemoryStore(...)`) and the `inst.store.bind(...)` call.

3. **Remove any other `inst.store` references** throughout the file (likely store reads for message history, etc.) — replace with direct DB queries where needed.

After the fix, redeploy and restart:
```bash
cd /root/wass && git pull
sudo supervisorctl restart wa-controller
```

