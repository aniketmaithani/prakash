export type Category =
  | "world"
  | "politics"
  | "conflict"
  | "business"
  | "technology"
  | "science"
  | "health"
  | "climate"
  | "sports"
  | "entertainment";

export interface Article {
  id: string;
  title: string;
  snippet: string;
  url: string;
  source: string;
  host: string;
  publishedAt: number;
  image?: string;
  country: string;
  category: Category;
  mentions: string[];
}

export interface Country {
  code: string;
  name: string;
  query: string;
  lat: number;
  lng: number;
  news: boolean;
  aliases: string[];
  size: number;
}

export interface NewsStatus {
  version: number;
  refreshing: boolean;
  progress: { done: number; total: number };
  updatedAt: number | null;
  countries: number;
  nextRefreshAt: number | null;
}

export type TimeRange = "1h" | "6h" | "24h" | "72h" | "all";

export interface Settings {
  autoRotate: boolean;
  clouds: boolean;
  borders: boolean;
  beacons: boolean;
  arcs: boolean;
  heat: boolean;
  realSun: boolean;
  ticker: boolean;
  ultra: boolean;
  labels: boolean;
}
