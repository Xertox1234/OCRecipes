export type CatalogSearchResult = {
  id: number;
  title: string;
  image?: string;
  readyInMinutes?: number;
};

export type CatalogSearchResponse = {
  results: CatalogSearchResult[];
  offset: number;
  number: number;
  totalResults: number;
};

export interface CatalogSearchParams {
  query: string;
  cuisine?: string;
  diet?: string;
  type?: string;
  maxReadyTime?: number;
  offset?: number;
  number?: number;
}
