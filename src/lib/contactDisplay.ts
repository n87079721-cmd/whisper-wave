import type { Contact } from '@/lib/api';

const PLACEHOLDER_PREFIX = 'whatsapp contact';

export function cleanContactPhone(value?: string | null) {
  return String(value || '').replace(/@.*$/, '').trim();
}

function derivePhoneFromJid(jid?: string | null) {
  const raw = String(jid || '').trim();
  if (!raw.endsWith('@s.whatsapp.net')) return '';

  const digits = raw.replace(/@.*$/, '').replace(/\D/g, '');
  return digits.length >= 7 ? `+${digits}` : '';
}

function derivePlaceholderSuffix(contact: Contact) {
  const nameMatch = String(contact.name || '').match(/•\s*([0-9A-Za-z-]{2,})$/);
  if (nameMatch?.[1]) return nameMatch[1];

  const jid = String(contact.jid || '');
  if (jid.endsWith('@lid')) {
    const raw = jid.replace('@lid', '');
    return raw.slice(-4);
  }

  return '';
}

export function hasRealContactName(contact: Contact) {
  const value = String(contact.name || '').trim();
  return (
    !!value
    && !value.includes('@')
    && !value.toLowerCase().startsWith(PLACEHOLDER_PREFIX)
    && value.toLowerCase() !== 'unknown contact'
    && !/^\+?\d{7,}$/.test(value.replace(/\s+/g, ''))
  );
}

export function getContactPhoneLabel(contact: Contact) {
  return cleanContactPhone(contact.phone) || derivePhoneFromJid(contact.jid);
}

export function getContactDisplayName(contact: Contact) {
  if (hasRealContactName(contact)) return String(contact.name).trim();

  const phone = getContactPhoneLabel(contact);
  if (phone) return phone;

  const suffix = derivePlaceholderSuffix(contact);
  if (suffix) return `Contact • ${suffix}`;

  return 'Unknown contact';
}

export function getContactDisplayMeta(contact: Contact) {
  return hasRealContactName(contact) ? getContactPhoneLabel(contact) : '';
}

export function getContactInitials(contact: Contact) {
  if (hasRealContactName(contact)) {
    return String(contact.name)
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  const phone = getContactPhoneLabel(contact).replace(/\D/g, '');
  if (phone) return phone.slice(-2);

  const suffix = derivePlaceholderSuffix(contact);
  if (suffix) return suffix.slice(-2).toUpperCase();

  return '??';
}