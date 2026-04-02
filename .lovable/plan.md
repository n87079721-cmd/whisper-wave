

# Delete Account: Clean Up All User Data

## Problem
When deleting a user account from the admin panel, the delete handler misses two tables: `custom_sounds` and `prompts`. These tables have `ON DELETE CASCADE` foreign keys, but the explicit deletes before the user row deletion make the cleanup order-dependent. Adding explicit deletes ensures completeness regardless of CASCADE behavior.

## Changes

### `backend/src/api.js` (~line 1807-1814)
Add two missing DELETE statements before the existing ones:
- `DELETE FROM custom_sounds WHERE user_id = ?`
- `DELETE FROM prompts WHERE user_id = ?`

Also wrap all the deletes in a transaction for atomicity — if one fails, nothing is partially deleted.

| File | Change |
|------|--------|
| `backend/src/api.js` | Add `custom_sounds` and `prompts` cleanup to the delete handler, wrap in transaction |

