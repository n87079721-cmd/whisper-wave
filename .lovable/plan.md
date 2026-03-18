

## Plan: Navigate to Chat from Contacts Page

**Problem**: Tapping a contact on the Contacts page does nothing. Users expect to open that contact's conversation.

**Solution**: Pass the page navigation function into `ContactsPage`, so clicking a contact switches to the Conversations page with that contact pre-selected.

### Changes

1. **Index.tsx** — Add shared state for `selectedContactId`. Pass `onPageChange` and `setSelectedContactId` to `ContactsPage`, and pass `selectedContactId` to `ConversationsPage`.

2. **ContactsPage.tsx** — Accept `onOpenChat` callback prop. On contact row click, call `onOpenChat(contact)` which sets the selected contact ID and navigates to conversations.

3. **ConversationsPage.tsx** — Accept optional `initialContactId` prop. On mount (or when prop changes), if an `initialContactId` is provided, auto-select that contact by fetching conversations, finding the match, and setting it as `selectedContact`. Add a `MessageSquare` icon on each contact row to make the action visually clear.

### Flow
- User taps contact → `ContactsPage` calls `onOpenChat(contact)` → Index stores `contactId`, switches to `conversations` page → `ConversationsPage` receives `initialContactId`, auto-selects that contact, loads their messages.

