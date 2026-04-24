export type TrafficEvent = {
  id: string;
  iconId: string | null;
  message: string | null;
  severity: string | null;
  roadNumber: string | null;
  countyNo: number | null;
  lng: number;
  lat: number;
  firstSeen: string;
  lastSeen: string;
  modifiedTime: string | null;
};

export type EventRow = {
  id: string;
  icon_id: string | null;
  message: string | null;
  severity: string | null;
  road_number: string | null;
  county_no: number | null;
  geom: string;
  last_seen: string;
  modified_time: string | null;
  raw: unknown;
};
