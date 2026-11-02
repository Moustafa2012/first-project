/**
 * How a reminder could reach a person. Today there is one channel, the in-app reminders centre (and the number on the bell):
 * it needs no provider, because the page reads the feed itself. E-mail and SMS need a provider (an account with a mail or SMS
 * service, the recipient's address or number, consent, a delivery log) that this project does not have, so they are
 * deliberately not offered and nothing pretends to send.
 *
 * A provider would be added as another entry here: it reads the same feed (public.care_reminder_feed through the service
 * role, per account), sends, and records the delivery. Nothing else in the reminders code would change.
 */
export interface ReminderChannel {
  id: "in_app" | "email" | "sms";
  /** true when the channel can really deliver (a provider is configured) */
  available: boolean;
  label: { ar: string; en: string };
}

export const CHANNELS: ReminderChannel[] = [
  { id: "in_app", available: true, label: { ar: "داخل التطبيق", en: "In the app" } },
  { id: "email", available: false, label: { ar: "البريد الإلكتروني", en: "E-mail" } },
  { id: "sms", available: false, label: { ar: "رسالة نصية", en: "SMS" } },
];

export const availableChannels = () => CHANNELS.filter((c) => c.available);
export const unavailableChannels = () => CHANNELS.filter((c) => !c.available);
