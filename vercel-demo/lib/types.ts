export type EventType = "MEETING" | "MISSION" | "APPOINTMENT" | "OTHER";

export interface BusyBlock {
  startsAt: string;
  endsAt: string;
}

export interface AppointmentRequestInput {
  requestedBy: string;
  eventType: EventType;
  title: string;
  note?: string;
  startsAt: string;
  endsAt: string;
}
